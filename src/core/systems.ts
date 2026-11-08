import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { PLAIN_ENV, type CheckEnv, type Checker } from "./check";
import type { Store, SessionSystem, StoredSystem, StoredSystemVersion } from "./store";
import { catalogMarkdown } from "./system/catalog";
import { fingerprint, inputsOf } from "./system/inputs";
import { importMessage } from "./system/importBrief";
import { ADAPTER_FILE, detectSource, projectRootOf, tiersOf, type SourceOverrides, type SystemSource } from "./system/source";
import { syncSystem } from "./system/sync";
import {
  isError,
  type AgentBridge,
  type Failure,
  type Issue,
  type IssueCode,
  type KitPayload,
  type ProjectId,
  type Result,
  type SystemCheck,
  type SystemId,
  type SystemImport,
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

/** How often auto-sync looks for changes while Brainstorm runs (ADR 008). */
export const AUTO_SYNC_MS = 5000;

/** The warnings each gate of `system check` fails on (ADR 008). Errors fail "builds". */
const GATE_CODES: Readonly<Record<"boundary" | "stories" | "theme", readonly IssueCode[]>> = {
  boundary: ["outside_boundary"],
  stories: ["no_story", "story_failed", "story_empty"],
  theme: ["no_tokens"],
};

/**
 * Design systems (ADR 007, ADR 008): a library synced from its package folder, or a project's components synced
 * through `.brainstorm/system.json`, into immutable versions. This owns the systems, their imports and auto-sync; the
 * Brainstorm service owns how a session uses one.
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
  readonly #listeners = new Set<() => void>();

  /** `onVersion` hears of each version a sync creates, so the sessions on the system can offer the upgrade. */
  constructor(input: { store: Store; checker: Checker; bridge: AgentBridge; now: () => string; newId?: () => SystemId; onVersion?: (id: SystemId) => void }) {
    this.#store = input.store;
    this.#checker = input.checker;
    this.#bridge = input.bridge;
    this.#now = input.now;
    this.#newId = input.newId ?? randomSystemId;
    this.#onVersion = input.onVersion ?? (() => {});
  }

  /** Hears of any change to the systems or their imports, so the window can refresh its page. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
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
      syncError: s.syncError,
      adapter: typeof s.source.adapter === "string",
    };
  }

  view(id: SystemId): Result<SystemView> {
    const s = this.#store.system(id);
    if (s === null) return fail(noSystem(id));
    const latest = this.#store.latestSystemVersion(id);
    const { storyFiles: _files, ...manifest } = latest?.manifest ?? { storyFiles: null };
    return ok({
      ...this.#listing(s),
      source: {
        root: s.source.root,
        entry: s.source.entry,
        css: s.source.css,
        stories: s.source.stories,
        frame: s.source.frame,
        stubs: s.source.stubs,
        adapter: s.source.adapter ?? null,
        tiers: tiersOf(s.source),
      },
      versions: (() => {
        const using = this.#store.sessionsByVersion(id);
        const all = this.#store.systemVersions(id);
        return all.map((v) => {
          const { warnings: _w, ...rest } = summary({ ...v, system: id, warnings: [] });
          const before = all.find((o) => o.n === v.n - 1);
          const changes = before === undefined ? { added: [], removed: [], changed: [], tokens: [] } : { ...componentChanges(before.manifest, v.manifest), ...renderChanges(before.manifest, v.manifest) };
          return { ...rest, sessions: using.get(v.n) ?? [], ...changes };
        });
      })(),
      manifest: latest === null ? null : (manifest as NonNullable<SystemView["manifest"]>),
      themes: this.#store.themes(id),
    });
  }

  /**
   * Finds the system in `path`, syncs its first version and saves it. A system that fails its first sync isn't saved.
   * A folder with no package and no adapter fails with `no_system`, which the window answers with an import.
   */
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
      this.#store.insertSystem({ id, name: source.value.name, source: source.value, projectId, createdAt: at, inputs: null, syncError: null });
      this.#store.setSystemInputs(id, inputsOf(source.value, synced.value.inputs));
      this.#store.insertSystemVersion({ system: id, n: 1 as SystemVersionN, ...synced.value, syncedAt: at });
      // The import an agent ran for this folder is done once the system it wrote is added.
      for (const imp of this.#store.imports()) if (samePath(imp.root, root)) this.#store.deleteImport(imp.root);
    });
    this.#changed();
    const view = this.view(id);
    if (!view.ok) return view;
    return ok({ system: view.data, created: true, warnings: synced.value.warnings });
  }

  /** Builds the system again. Nothing changed means no new version, so syncing twice is harmless. */
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
    // An adapter holds its own frame and stubs, so the agent's edits to it win over what `system add` was given.
    const overrides: SourceOverrides = existsSync(resolve(s.source.root, ADAPTER_FILE)) ? { name: s.name } : { name: s.name, frame: s.source.frame, stubs: s.source.stubs };
    const source = detectSource(s.source.root, overrides);
    const synced = source.ok ? await syncSystem(source.value, this.#checker) : source;
    if (!synced.ok) {
      const failure = syncFailed(synced.issues);
      this.#store.tx(() => {
        this.#store.setSyncError(id, { message: failure.message, issues: synced.issues, at: this.#now() });
        // Auto-sync waits for the project to change again rather than failing the same way every few seconds.
        if (s.inputs !== null) this.#store.setSystemInputs(id, { ...s.inputs, fingerprint: fingerprint(s.source.root, s.inputs.files, s.inputs.globs) });
      });
      this.#changed();
      return fail(failure);
    }
    const resolved = source.ok ? source.value : s.source;
    const latest = this.#store.latestSystemVersion(id);
    const created = latest?.hash !== synced.value.hash;
    this.#store.tx(() => {
      this.#store.updateSystem(id, { source: resolved, name: s.name, projectId: s.projectId ?? this.#store.projectsHolding(s.source.root)[0] ?? null });
      this.#store.setSystemInputs(id, inputsOf(resolved, synced.value.inputs));
      this.#store.setSyncError(id, null);
      if (created) {
        this.#store.insertSystemVersion({ system: id, n: ((latest?.n ?? 0) + 1) as SystemVersionN, ...synced.value, syncedAt: this.#now() });
      }
    });
    if (created) this.#onVersion(id);
    if (created || s.syncError !== null) this.#changed();
    const view = this.view(id);
    if (!view.ok) return view;
    return ok({ system: view.data, created, warnings: synced.value.warnings });
  }

  /**
   * Syncs every system whose inputs changed since its last sync, one at a time, and returns the ones it synced. A
   * system synced before ADR 008 has no inputs yet, so it syncs once to record them.
   */
  async syncChanged(): Promise<SystemId[]> {
    const synced: SystemId[] = [];
    for (const s of this.#store.systems()) {
      if (this.#syncing.has(s.id) || !existsSync(s.source.root)) continue;
      if (s.inputs !== null && fingerprint(s.source.root, s.inputs.files, s.inputs.globs) === s.inputs.fingerprint) continue;
      await this.sync(s.id);
      synced.push(s.id);
    }
    return synced;
  }

  /** Runs `syncChanged` every `intervalMs` until the returned stop is called. A pass never overlaps the one before. */
  startAutoSync(intervalMs: number = AUTO_SYNC_MS): () => void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void this.syncChanged()
        .catch(() => [])
        .finally(() => {
          running = false;
        });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  /**
   * What an import agent loops on (ADR 008): syncs the folder without saving anything, and reports each gate. Nothing
   * is written, so it can run as often as the agent likes.
   */
  async check(path: string): Promise<Result<SystemCheck>> {
    const root = resolve(path);
    if (!existsSync(root) || !statSync(root).isDirectory()) return fail({ code: "usage", message: `${root} isn't a folder` });
    const source = detectSource(root);
    const synced = source.ok ? await syncSystem(source.value, this.#checker) : source;
    if (!synced.ok) {
      return ok({ root, passed: false, gates: [{ gate: "builds", passed: false, issues: synced.issues }], warnings: [], components: [] });
    }
    const all = [...(source.ok ? source.warnings : []), ...synced.value.warnings];
    const gates = (["boundary", "stories", "theme"] as const).map((gate) => {
      const issues = all.filter((w) => GATE_CODES[gate].includes(w.code));
      return { gate, passed: issues.length === 0, issues };
    });
    const gated = new Set<IssueCode>(Object.values(GATE_CODES).flat());
    const components = synced.value.manifest.catalog
      .filter((e) => !e.generated)
      .map((e) => ({ name: e.name, tier: e.tier ?? "primitive", stories: e.stories.length }));
    return ok({
      root,
      passed: gates.every((g) => g.passed),
      gates: [{ gate: "builds", passed: true, issues: [] }, ...gates],
      warnings: all.filter((w) => !gated.has(w.code)),
      components,
    });
  }

  imports(): SystemImport[] {
    return this.#store.imports();
  }

  /**
   * Starts an agent in a T3 thread on the project that holds `path`, to write the project's adapter and stories and add
   * the system (ADR 008). For a system that stopped syncing, `repair` names it, and the agent fixes its adapter.
   */
  async importProject(input: { path: string; repair?: SystemId | null }): Promise<Result<SystemImport>> {
    const chosen = resolve(input.path);
    const repairing = input.repair == null ? null : this.#store.system(input.repair);
    if (input.repair != null && repairing === null) return fail(noSystem(input.repair));
    const root = repairing?.source.root ?? projectRootOf(chosen);
    if (repairing === null) {
      const existing = this.#store.systems().find((s) => samePath(s.source.root, root));
      if (existing !== undefined) {
        return fail({ code: "invalid_action", message: `${root} is already the design system "${existing.name}" (${existing.id}); sync it instead` });
      }
    }
    const projectId = repairing?.projectId ?? this.#store.projectsHolding(root)[0] ?? null;
    if (projectId === null) {
      return fail({
        code: "invalid_action",
        message: `Brainstorm doesn't know which T3 project holds ${root}, so it can't start the agent there; start a brainstorm from that project once, then try again`,
      });
    }
    const at = this.#now();
    this.#store.setImport(root, projectId, { state: "starting" }, at);
    this.#changed();
    const result = await this.#bridge.start({
      project: projectId,
      title: repairing === null ? `Import the design system from ${basename(root)}` : `Repair the ${repairing.name} design system`,
      message: importMessage({
        root,
        chosen: relative(root, chosen).split("\\").join("/"),
        repair: repairing === null ? null : { id: repairing.id, name: repairing.name, issues: repairing.syncError?.issues ?? [] },
      }),
    });
    if (result.kind === "failed") {
      this.#store.setImport(root, projectId, { state: "failed", error: result.error }, this.#now());
    } else {
      const shown = await this.#bridge.snapshot(result.thread, { messages: 0 });
      this.#store.setImport(root, projectId, { state: "started", thread: result.thread, link: shown.kind === "found" ? shown.snapshot.thread.link : null }, this.#now());
    }
    this.#changed();
    const stored = this.#store.imports().find((i) => samePath(i.root, root));
    return stored === undefined ? fail(noSystem(root)) : ok(stored);
  }

  /** Forgets an import, such as one whose thread Rob abandoned. */
  dismissImport(root: string): Result<null> {
    this.#store.deleteImport(resolve(root));
    this.#changed();
    return ok(null);
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

/**
 * What renders differently from one version to the next (ADR 008): components with a story whose HTML changed, and
 * tokens whose value changed. Versions synced before ADR 008 have no story hashes, so only their tokens compare.
 */
export function renderChanges(
  before: Pick<SystemManifest, "catalog" | "stories" | "styles">,
  after: Pick<SystemManifest, "catalog" | "stories" | "styles">,
): { changed: { name: string; stories: number }[]; tokens: { name: string; before: string; after: string }[] } {
  const old = new Map(before.stories.map((s) => [s.id, s.htmlHash]));
  const changed = after.catalog
    .filter((e) => !e.generated)
    .map((e) => ({
      name: e.name,
      stories: e.stories.filter((id) => {
        const was = old.get(id);
        const now = after.stories.find((s) => s.id === id)?.htmlHash;
        return typeof was === "string" && typeof now === "string" && was !== now;
      }).length,
    }))
    .filter((c) => c.stories > 0);
  type T = SystemManifest["styles"]["tokens"][number];
  const key = (t: T) => `${t.value}|${JSON.stringify(t.byAxis)}`;
  // The base value, or the first themed one for a token only a theme sets.
  const shown = (t: T) => t.value || Object.values(t.byAxis)[0] || "";
  const was = new Map(before.styles.tokens.filter((t) => t.origin === "system").map((t) => [t.name, t]));
  const tokens = after.styles.tokens
    .filter((t) => {
      const w = was.get(t.name);
      return t.origin === "system" && w !== undefined && key(w) !== key(t);
    })
    .map((t) => {
      const w = was.get(t.name) as T;
      // When the base value is the same, the change is in a theme, so show that theme's values.
      const axis = shown(w) === shown(t) ? Object.keys({ ...w.byAxis, ...t.byAxis }).find((k) => w.byAxis[k] !== t.byAxis[k]) : undefined;
      return axis === undefined
        ? { name: t.name, before: shown(w), after: shown(t) }
        : { name: `${t.name} [${axis}]`, before: w.byAxis[axis] ?? "unset", after: t.byAxis[axis] ?? "unset" };
    });
  return { changed, tokens };
}
