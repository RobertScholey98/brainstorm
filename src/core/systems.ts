import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PLAIN_ENV, type CheckEnv, type Checker } from "./check";
import type { Store, SessionSystem, StoredSystem, StoredSystemVersion } from "./store";
import { catalogMarkdown } from "./system/catalog";
import { detectSource, type SourceOverrides } from "./system/source";
import { syncSystem } from "./system/sync";
import {
  isError,
  type AgentBridge,
  type Failure,
  type Issue,
  type KitPayload,
  type ProjectId,
  type Result,
  type SystemId,
  type SystemListing,
  type SystemVersionN,
  type SystemVersionSummary,
  type SystemView,
  type ThreadId,
} from "./types";
import type { SystemDocs } from "./workingCopy";
import type { SystemManifest } from "./system/model";

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: Failure): { ok: false; error: Failure } => ({ ok: false, error });
const noSystem = (id: string): Failure => ({ code: "not_found", entity: "system", message: `no design system ${id}` });

const randomSystemId = (): SystemId => {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  return `ds_${[...randomBytes(8)].map((b) => alphabet[b % 36]).join("")}` as SystemId;
};

export type SyncOutcome = { readonly system: SystemView; readonly created: boolean; readonly warnings: readonly Issue[] };

/**
 * Design systems (ADR 007): a library synced from its package folder into immutable versions. This owns the systems
 * themselves; the Brainstorm service owns how a session uses one.
 */
export class Systems {
  readonly #store: Store;
  readonly #checker: Checker;
  readonly #bridge: AgentBridge;
  readonly #now: () => string;
  readonly #newId: () => SystemId;
  readonly #onVersion: (id: SystemId) => void;
  readonly #syncing = new Map<SystemId, Promise<Result<SyncOutcome>>>();
  readonly #docs = new Map<string, SystemDocs>();

  /** `onVersion` hears of each version a sync creates, so the sessions on the system can offer the upgrade. */
  constructor(input: { store: Store; checker: Checker; bridge: AgentBridge; now: () => string; newId?: () => SystemId; onVersion?: (id: SystemId) => void }) {
    this.#store = input.store;
    this.#checker = input.checker;
    this.#bridge = input.bridge;
    this.#now = input.now;
    this.#newId = input.newId ?? randomSystemId;
    this.#onVersion = input.onVersion ?? (() => {});
  }

  list(): SystemListing[] {
    return this.#store.systems().map((s) => this.#listing(s));
  }

  #listing(s: StoredSystem): SystemListing {
    const latest = this.#store.latestSystemVersion(s.id);
    return {
      id: s.id,
      name: s.name,
      root: s.source.root,
      projectId: s.projectId,
      latest: latest === null ? null : summary(latest),
      sessions: this.#store.sessionsUsing(s.id),
    };
  }

  view(id: SystemId): Result<SystemView> {
    const s = this.#store.system(id);
    if (s === null) return fail(noSystem(id));
    const latest = this.#store.latestSystemVersion(id);
    const { storyFiles: _files, ...manifest } = latest?.manifest ?? { storyFiles: null };
    return ok({
      ...this.#listing(s),
      source: { root: s.source.root, entry: s.source.entry, css: s.source.css, stories: s.source.stories, frame: s.source.frame, stubs: s.source.stubs },
      versions: (() => {
        const using = this.#store.sessionsByVersion(id);
        const all = this.#store.systemVersions(id);
        return all.map((v) => {
          const { warnings: _w, ...rest } = summary({ ...v, system: id, warnings: [] });
          const before = all.find((o) => o.n === v.n - 1);
          const changes = before === undefined ? { added: [], removed: [] } : componentChanges(before.manifest, v.manifest);
          return { ...rest, sessions: using.get(v.n) ?? [], ...changes };
        });
      })(),
      manifest: latest === null ? null : (manifest as NonNullable<SystemView["manifest"]>),
      themes: this.#store.themes(id),
    });
  }

  /** Finds the library in `path`, syncs its first version and saves it. A library that fails its first sync isn't saved. */
  async add(input: { path: string; name?: string | null; frame?: string | null; stubs?: Record<string, string>; thread?: ThreadId | null }): Promise<Result<SyncOutcome>> {
    const root = resolve(input.path);
    if (!existsSync(root) || !statSync(root).isDirectory()) return fail({ code: "usage", message: `${root} isn't a folder` });
    const existing = this.#store.systems().find((s) => samePath(s.source.root, root));
    if (existing !== undefined) {
      return fail({ code: "invalid_action", message: `${root} is already the design system "${existing.name}" (${existing.id}); sync it instead` });
    }
    const overrides: SourceOverrides = { name: input.name ?? null, frame: input.frame ?? null, ...(input.stubs === undefined ? {} : { stubs: input.stubs }) };
    const source = detectSource(root, overrides);
    if (!source.ok) return fail(syncFailed(source.issues));
    const projectId = await this.#projectOf(root, input.thread ?? null);
    const synced = await syncSystem(source.value, this.#checker);
    if (!synced.ok) return fail(syncFailed(synced.issues));
    const id = this.#newId();
    const at = this.#now();
    this.#store.tx(() => {
      this.#store.insertSystem({ id, name: source.value.name, source: source.value, projectId, createdAt: at });
      this.#store.insertSystemVersion({ system: id, n: 1 as SystemVersionN, ...synced.value, syncedAt: at });
    });
    const view = this.view(id);
    if (!view.ok) return view;
    return ok({ system: view.data, created: true, warnings: synced.value.warnings });
  }

  /** Builds the library again. Nothing changed means no new version, so syncing twice is harmless. */
  sync(id: SystemId): Promise<Result<SyncOutcome>> {
    const running = this.#syncing.get(id);
    if (running !== undefined) return running;
    const job = this.#sync(id).finally(() => this.#syncing.delete(id));
    this.#syncing.set(id, job);
    return job;
  }

  async #sync(id: SystemId): Promise<Result<SyncOutcome>> {
    const s = this.#store.system(id);
    if (s === null) return fail(noSystem(id));
    const source = detectSource(s.source.root, { name: s.name, frame: s.source.frame, stubs: s.source.stubs });
    if (!source.ok) return fail(syncFailed(source.issues));
    const synced = await syncSystem(source.value, this.#checker);
    if (!synced.ok) return fail(syncFailed(synced.issues));
    const latest = this.#store.latestSystemVersion(id);
    const created = latest?.hash !== synced.value.hash;
    this.#store.tx(() => {
      this.#store.updateSystem(id, { source: source.value, name: s.name, projectId: s.projectId ?? this.#store.projectsHolding(s.source.root)[0] ?? null });
      if (created) {
        this.#store.insertSystemVersion({ system: id, n: ((latest?.n ?? 0) + 1) as SystemVersionN, ...synced.value, syncedAt: this.#now() });
      }
    });
    if (created) this.#onVersion(id);
    const view = this.view(id);
    if (!view.ok) return view;
    return ok({ system: view.data, created, warnings: synced.value.warnings });
  }

  async #projectOf(root: string, thread: ThreadId | null): Promise<ProjectId | null> {
    const known = this.#store.projectsHolding(root)[0];
    if (known !== undefined) return known;
    if (thread === null) return null;
    const shown = await this.#bridge.snapshot(thread, { messages: 1 });
    return shown.kind === "found" ? shown.snapshot.thread.projectId : null;
  }

  /** A system by id or name, at its newest version, for a new session. */
  find(ref: string): Result<SessionSystem> {
    const wanted = ref.trim().toLowerCase();
    const all = this.#store.systems();
    const s = all.find((x) => x.id === ref) ?? all.find((x) => x.name.toLowerCase() === wanted);
    if (s === undefined) return fail(noSystem(ref));
    const latest = this.#store.latestSystemVersion(s.id);
    if (latest === null) return fail(noSystem(`${ref} (it has no synced version)`));
    return ok({ id: s.id, n: latest.n });
  }

  version(ref: SessionSystem): StoredSystemVersion {
    const v = this.#store.systemVersion(ref.id, ref.n);
    if (v === null) throw new Error(`design system ${ref.id} has no version ${ref.n}`);
    return v;
  }

  kit(id: SystemId, n: SystemVersionN): Result<KitPayload> {
    const files = this.#store.kitFiles(id, n);
    const v = this.#store.systemVersion(id, n);
    if (files === null || v === null) return fail(noSystem(`${id} version ${n}`));
    return ok({ hash: v.hash, bundle: files.bundle, css: files.css, frame: v.manifest.frame, surface: v.manifest.styles.surface });
  }

  /** What a session's working copy gets for its system on pull. Versions never change, so each is built once. */
  docs(ref: SessionSystem): SystemDocs {
    const key = `${ref.id}@${ref.n}`;
    const cached = this.#docs.get(key);
    if (cached !== undefined) return cached;
    const s = this.#store.system(ref.id);
    const v = this.version(ref);
    const docs: SystemDocs = { name: s?.name ?? ref.id, catalog: catalogMarkdown(s?.name ?? ref.id, ref.n, v.manifest), storyFiles: v.manifest.storyFiles };
    this.#docs.set(key, docs);
    return docs;
  }

  /** What a session's blocks and proposed components may reach in the check. */
  env(ref: SessionSystem | null, proposed: Readonly<Record<string, string>>, exclude: string | null = null): CheckEnv {
    if (ref === null) return PLAIN_ENV;
    const files = this.#store.kitFiles(ref.id, ref.n);
    const v = this.version(ref);
    if (files === null) throw new Error(`design system ${ref.id} has no version ${ref.n}`);
    // Once the version exports a component by a proposed one's name, `proposed/<Name>` is the kit's, as on the canvas.
    const exported = new Set(v.manifest.exports.map((e) => e.name));
    const others = Object.fromEntries(
      Object.entries(proposed)
        .filter(([spec]) => spec !== exclude)
        .map(([spec, source]) => {
          const name = spec.slice("proposed/".length);
          return [spec, exported.has(name) ? `export { ${name} as default } from "kit";
` : source];
        }),
    );
    return {
      kit: { hash: v.hash, bundle: files.bundle },
      proposed: others,
      allowed: [...PLAIN_ENV.allowed, "kit", ...Object.keys(others)],
    };
  }
}

function summary(v: StoredSystemVersion): SystemVersionSummary {
  return {
    n: v.n,
    hash: v.hash,
    syncedAt: v.syncedAt,
    components: v.manifest.catalog.filter((e) => !e.generated).length,
    stories: v.manifest.stories.length,
    failedStories: v.manifest.stories.filter((s) => s.error !== null).length,
    warnings: v.warnings,
  };
}

const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

function syncFailed(issues: readonly Issue[]): Failure {
  const errors = issues.filter(isError).length;
  return { code: "validation_failed", message: `the design system didn't sync (${errors} error${errors === 1 ? "" : "s"}); nothing was saved`, issues };
}

/**
 * The components the library exports in one version and not the other. Exports, not catalog entries: a story keeps its
 * catalog entry after the component it shows stops being exported.
 */
export function componentChanges(
  before: Pick<SystemManifest, "exports" | "generated">,
  after: Pick<SystemManifest, "exports" | "generated">,
): { added: string[]; removed: string[] } {
  const own = (m: Pick<SystemManifest, "exports" | "generated">) =>
    new Set(m.exports.filter((e) => e.type === "component" && !m.generated.includes(e.name)).map((e) => e.name));
  const [a, b] = [own(before), own(after)];
  return { added: [...b].filter((n) => !a.has(n)).sort(), removed: [...a].filter((n) => !b.has(n)).sort() };
}
