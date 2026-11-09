import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCanvasDocument, exportPayload } from "../canvas/document";
import type { Checker } from "./check";
import { controlVocabulary } from "./controls";
import {
  canAppend,
  FEEDBACK_ACTIONS,
  foldFeedback,
  formatRequestMessage,
  observeRequest,
  phaseMessage,
  regenerateGate,
  requestFeedback,
  requestPhase,
  settlementOf,
} from "./machines";
import { prefRows, readPrefs, type UiPrefs, type UiPrefsPatch } from "./prefs";
import { repoAt } from "./projectName";
import { appearanceProp, classifyOverrides, parseAppearanceValue, resolveProps } from "./props";
import { exportFileName } from "./fileName";
import { bakeDefaults, carryOver, forkTitle, VARY_MAX, varyNames } from "./fork";
import {
  Store,
  type FeedbackRecord,
  type IterationBlock,
  type IterationProposed,
  type SessionSystem,
  type StoredContent,
  type StoredFork,
  type StoredIteration,
  type StoredProposedContent,
} from "./store";
import { blockConformance, compiledForConformance, proposedConformance, proposedImports } from "./system/conform";
import { tierFolder } from "./system/source";
import type { CheckEnv } from "./check";
import { Systems, componentChanges, renderChanges } from "./systems";
import {
  blockIdOf,
  framesOf,
  issue,
  isError,
  isPendingThread,
  pendingThreadOf,
  splitBlockId,
  type AgentBridge,
  type AgentContext,
  type Attachment,
  type AttachResult,
  type BlockDraft,
  type BlockId,
  type BlockView,
  type CommitResult,
  type ContentHash,
  type ExportResult,
  type Failure,
  type Feedback,
  type FeedbackAction,
  type FeedbackId,
  type FileMap,
  type ForkInput,
  type ForkLink,
  type HistoryEntry,
  type Issue,
  type IterationContents,
  type IterationN,
  type IterationOrigin,
  type IterationSummary,
  type IterationView,
  type NewSessionResult,
  type OpenPhase,
  type Override,
  type PartName,
  type ProjectId,
  type ProjectListing,
  type SystemChoice,
  type ProposedDraft,
  type ProposedName,
  type ProposedView,
  type SessionSystemView,
  type SystemVersionN,
  type UpgradeCheck,
  type SystemId,
  type CanvasSystem,
  type ThemeExport,
  type ThemeState,
  type PropsSchema,
  type PullResult,
  type Request,
  type RequestBody,
  type RequestN,
  type Result,
  type RobAction,
  type SessionId,
  type SessionListing,
  type SessionPreview,
  type SessionSummary,
  type SessionView,
  type SlotId,
  type SlotView,
  type SnapshotResult,
  type ThreadId,
  type ThreadInfo,
  type ThreadSnapshot,
  type ValidateResult,
  type VaryScope,
  type WorkingCopyDraft,
} from "./types";
import { blockFile, emitWorkingCopy, proposedFile, readStoredBlock, readStoredProposed, scanWorkingCopy } from "./workingCopy";

const SNAPSHOT_MESSAGES = 30;
const UNREACHABLE_TTL_MS = 10_000;
/** A retried fork looks for its thread among the project's threads made from a minute before its request on. */
const FORK_LOOKBACK_MS = 60_000;
const FORK_LOOKUP_THREADS = 10;

export type BrainstormOptions = {
  readonly dbPath: string;
  readonly exportsDir: string;
  readonly bridge: AgentBridge;
  readonly checker: Checker;
  readonly now?: () => string;
  readonly newSessionId?: () => SessionId;
  /** Monotonic milliseconds, for the snapshot cache's TTL. */
  readonly clockMs?: () => number;
  /** The app's home when it isn't the default, which a fork's new thread must be told, since T3 gives agents its own environment. */
  readonly agentHome?: string | null;
};

export type CommitInput = {
  readonly session: SessionId;
  readonly thread: ThreadId;
  readonly files: FileMap;
  readonly addresses: readonly FeedbackId[];
  readonly note: string | null;
};

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (error: Failure): { ok: false; error: Failure } => ({ ok: false, error });

const randomSessionId = (): SessionId => {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  return `s_${[...randomBytes(8)].map((b) => alphabet[b % 36]).join("")}` as SessionId;
};

const notFound = (entity: Extract<Failure, { code: "not_found" }>["entity"], message: string): Failure => ({
  code: "not_found",
  entity,
  message,
});

/** A prepared commit: everything decided before the write, so validate and commit share one path. */
type Prepared =
  | { readonly kind: "replay"; readonly latest: StoredIteration }
  | {
      readonly kind: "create";
      readonly latest: StoredIteration | null;
      readonly draft: WorkingCopyDraft;
      readonly contents: readonly StoredContent[];
      readonly proposed: readonly IterationProposed[];
      readonly proposedContents: readonly StoredProposedContent[];
      readonly addresses: readonly FeedbackId[];
      readonly changed: readonly BlockId[];
      readonly removed: readonly BlockId[];
      readonly warnings: readonly Issue[];
    };

/** The part of a parsed block that depends only on its content, so it can be shared by every block with that hash. */
type Loaded = { readonly draft: Pick<BlockDraft, "title" | "props" | "controls">; readonly content: StoredContent };

type Seen = { readonly snapshot: ThreadSnapshot | null; readonly checkedAt: number };

const summaryOf = ({ id, projectId, title, brief, createdAt }: SessionSummary): SessionSummary => ({ id, projectId, title, brief, createdAt });

export class Brainstorm {
  readonly #store: Store;
  readonly #bridge: AgentBridge;
  readonly #checker: Checker;
  readonly #exportsDir: string;
  readonly #now: () => string;
  readonly #newSessionId: () => SessionId;
  readonly #clockMs: () => number;
  readonly #agentHome: string | null;
  readonly #seen = new Map<ThreadId, Seen>();
  readonly #loaded = new Map<ContentHash, Loaded>();
  readonly #listeners = new Set<(session: SessionId) => void>();
  readonly #emitting = new Set<SessionId>();
  readonly #systems: Systems;
  /** Background checks of each session's latest iteration against its system's newest version (ADR 008). */
  readonly #upgradeChecks = new Map<string, UpgradeCheck>();
  #ticking = false;

  private constructor(options: BrainstormOptions) {
    this.#store = new Store(options.dbPath);
    this.#bridge = options.bridge;
    this.#checker = options.checker;
    this.#exportsDir = options.exportsDir;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newSessionId = options.newSessionId ?? randomSessionId;
    this.#clockMs = options.clockMs ?? (() => performance.now());
    this.#agentHome = options.agentHome ?? null;
    this.#systems = new Systems({
      store: this.#store,
      checker: this.#checker,
      bridge: this.#bridge,
      now: this.#now,
      onVersion: (id) => this.#store.sessionsOn(id).forEach((s) => this.#emit(s)),
    });
  }

  /** Design systems themselves: add, sync, list, the kit a canvas loads. */
  get systems(): Systems {
    return this.#systems;
  }

  /** Opens the database and reconciles requests a previous run left in `sending`. */
  static async open(options: BrainstormOptions): Promise<Brainstorm> {
    const service = new Brainstorm(options);
    await service.#reconcile();
    return service;
  }

  close(): void {
    this.#store.close();
  }

  /** The window's own layout, kept across launches. */
  prefs(): Result<UiPrefs> {
    return ok(readPrefs(this.#store.uiPrefRows()));
  }

  setPrefs(patch: UiPrefsPatch): Result<UiPrefs> {
    this.#store.setUiPrefs(prefRows(patch));
    return this.prefs();
  }

  subscribe(listener: (session: SessionId) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(session: SessionId): void {
    if (this.#emitting.has(session)) return;
    this.#emitting.add(session);
    queueMicrotask(() => {
      this.#emitting.delete(session);
      for (const listener of this.#listeners) listener(session);
    });
  }

  async newSession(input: {
    title: string;
    brief: string;
    thread: ThreadId;
    projectPath: string | null;
    /** The project's design system unless the agent names one or asks for none; it builds with the newest version. */
    system?: SystemChoice;
  }): Promise<Result<NewSessionResult>> {
    const thread = await this.#resolveThread(input.thread);
    if (!thread.ok) return thread;
    const chosen = this.#systems.forNewSession(thread.data.projectId, input.system ?? { kind: "project" });
    if (!chosen.ok) return chosen;
    const system = chosen.data;
    const repo = input.projectPath === null ? null : await repoAt(input.projectPath);
    const session: SessionSummary = {
      id: this.#newSessionId(),
      projectId: thread.data.projectId,
      title: input.title,
      brief: input.brief,
      createdAt: this.#now(),
    };
    this.#store.tx(() => {
      this.#store.ensureProject(session.projectId, input.projectPath, session.createdAt, repo?.git ?? null);
      if (repo?.name != null) this.#store.nameProject(session.projectId, repo.name);
      this.#store.createSession(session, input.thread, system === null ? null : { id: system.id, n: system.n });
    });
    this.#emit(session.id);
    return ok({ session, attachment: this.#store.attachment(session.id), system });
  }

  /** The design system of the thread's project (ADR 009). */
  async projectSystem(thread: ThreadId): Promise<Result<ProjectListing>> {
    const info = await this.#resolveThread(thread);
    return info.ok ? ok(this.#systems.project(info.data.projectId)) : info;
  }

  /**
   * Sets the design system of the thread's project, or clears it with null. `projectPath` is the agent's folder, which
   * names a project Brainstorm hasn't seen yet so the window can list it.
   */
  async setProjectSystem(input: { thread: ThreadId; projectPath: string | null; system: string | null }): Promise<Result<ProjectListing>> {
    const info = await this.#resolveThread(input.thread);
    if (!info.ok) return info;
    const project = info.data.projectId;
    // A system Brainstorm doesn't have changes nothing, not even which projects it knows.
    if (input.system !== null) {
      const found = this.#systems.find(input.system);
      if (!found.ok) return found;
    }
    const repo = input.projectPath === null ? null : await repoAt(input.projectPath);
    this.#store.tx(() => {
      this.#store.ensureProject(project, input.projectPath, this.#now(), repo?.git ?? null);
      if (repo?.name != null) this.#store.nameProject(project, repo.name);
    });
    return this.#systems.setProjectSystem(project, input.system);
  }

  /** The sessions in the thread's project, or every session when `thread` is null. */
  async listSessions(thread: ThreadId | null): Promise<Result<SessionListing[]>> {
    let project: ProjectId | null = null;
    if (thread !== null) {
      const info = await this.#resolveThread(thread);
      if (!info.ok) return info;
      project = info.data.projectId;
    }
    return ok(this.#listings(project));
  }

  #listings(project: ProjectId | null): SessionListing[] {
    return this.#store.sessions(project).map(({ openRequest, settledAt, unsettledAt, woken, ...listing }) => ({
      ...listing,
      request: openRequest ? this.#openPhase(listing.id) : null,
      settlement: settlementOf({ settledAt, unsettledAt, woken, openRequest }),
    }));
  }

  /**
   * Settles a brainstorm, or brings it back with `settled: false`. Nothing else changes: its iterations, feedback and
   * working copy stay as they are. Settling one that is already settled keeps when it was settled, as T3 does.
   */
  settle(id: SessionId, settled: boolean): Result<SessionListing> {
    const listing = () => this.#listings(null).find((s) => s.id === id);
    const before = listing();
    if (before === undefined) return fail(notFound("session", `no session ${id}`));
    const active = before.settlement.state === "active";
    if (settled && active) this.#store.settle(id, this.#now());
    else if (!settled && !active) this.#store.unsettle(id, this.#now());
    this.#emit(id);
    return ok(listing() ?? before);
  }

  /** The open request's phase from the thread as last seen, so a list shows what the brainstorm is waiting on. */
  #openPhase(id: SessionId): OpenPhase | null {
    const request = this.#store.openRequest(id);
    if (request === null) return null;
    const snapshot = this.#seen.get(request.threadId)?.snapshot ?? null;
    const { phase } = requestPhase(request, this.#store.attachment(id), snapshot === null ? null : observeRequest(id, request.n, snapshot));
    return phase === "fulfilled" || phase === "withdrawn" ? null : phase;
  }

  async attach(input: { ref: string; thread: ThreadId }): Promise<Result<AttachResult>> {
    const info = await this.#resolveThread(input.thread);
    if (!info.ok) return info;
    const matched = this.#match(input.ref, info.data.projectId);
    if (!matched.ok) return matched;
    const session = matched.data;
    if (session.projectId !== info.data.projectId) {
      return fail({
        code: "wrong_project",
        message: `session ${session.id} ("${session.title}") belongs to project ${session.projectId}, but thread ${input.thread} is in project ${info.data.projectId}`,
        sessionProject: session.projectId,
        threadProject: info.data.projectId,
      });
    }
    const current = this.#store.attachment(session.id);
    const pending = isPendingThread(current.threadId);
    if (current.threadId === input.thread) {
      if (current.lostAt !== null) this.#store.setLost(session.id, null);
    } else if (pending) {
      // A fork's new agent got here before the app heard back from T3, or the app never did.
      this.#adopt(session.id, input.thread);
    } else {
      this.#store.reattach(session.id, input.thread, this.#now());
    }
    this.#emit(session.id);
    return ok({
      session,
      attachment: this.#store.attachment(session.id),
      previous: current.threadId === input.thread || pending ? null : current.threadId,
    });
  }

  #match(ref: string, project: ProjectId): Result<SessionSummary> {
    const all = this.#store.sessions(null);
    const byId = all.find((s) => s.id === ref);
    if (byId !== undefined) return ok(summaryOf(byId));
    const wanted = ref.toLowerCase();
    const tests = [(s: SessionSummary) => s.title.toLowerCase() === wanted, (s: SessionSummary) => s.title.toLowerCase().includes(wanted)];
    for (const pool of [all.filter((s) => s.projectId === project), all]) {
      for (const test of tests) {
        const [first, ...more] = pool.filter(test);
        if (first === undefined) continue;
        if (more.length === 0) return ok(summaryOf(first));
        const candidates = [first, ...more].map((s) => ({ id: s.id, title: s.title }));
        return fail({
          code: "ambiguous_title",
          message: `"${ref}" matches ${candidates.length} sessions; attach by id`,
          candidates,
        });
      }
    }
    return fail(notFound("session", `no session has the id or title "${ref}"`));
  }

  async context(id: SessionId, thread: ThreadId | null): Promise<Result<AgentContext>> {
    const session = this.#store.session(id);
    if (session === null) return fail(notFound("session", `no session ${id}`));
    const attachment = this.#store.attachment(id);
    const latest = this.#store.latestIteration(id);
    const blocks = latest === null ? [] : this.#store.iterationBlocks(id, latest.n);
    const schemas = this.#schemas(blocks);
    const { applicable } = classifyOverrides(schemas, this.#store.overrides(id));
    const feedback = this.#feedback(id);
    const open = this.#store.openRequest(id);
    // A vary's new variants start from the block they copy, as Rob sees it, so its settings are in scope.
    const inScope = (block: BlockId) =>
      open === null ||
      (open.scope.kind === "blocks" ? open.scope.blocks.includes(block) : open.scope.kind === "vary" ? open.scope.target.blockId === block : true);
    const attached = thread !== null && thread === attachment.threadId;
    const addresses = open?.feedbackIds ?? [];
    const fork = this.#store.fork(id);
    return ok({
      session: { id, title: session.title, brief: session.brief },
      fork:
        fork === null
          ? null
          : { parent: { id: fork.parent, title: this.#store.sessionName(fork.parent)?.title ?? fork.parent }, from: fork.from, baked: fork.baked },
      latest: latest === null ? null : this.#summary(id, latest, blocks),
      attached,
      attachedThread: attachment.threadId,
      request:
        open === null
          ? null
          : {
              ...requestBody(open),
              n: open.n,
              base: open.base,
              feedback: feedback.filter((f) => open.feedbackIds.includes(f.id)),
              overrides: applicable.filter((o) => inScope(o.blockId)),
            },
      feedback: {
        open: feedback.filter((f) => f.status.state === "open"),
        addressed: feedback.filter((f) => f.status.state === "addressed"),
      },
      controlVocabulary: controlVocabulary(),
      system: this.#agentSystem(id),
      next: [
        ...(attached ? [] : [`brainstorm session attach ${id}`]),
        `brainstorm pull ${id}`,
        `brainstorm validate ${id}`,
        `brainstorm commit ${id}${addresses.length > 0 ? ` --addresses ${addresses.join(",")}` : ""}`,
      ],
    });
  }

  async pull(id: SessionId): Promise<Result<PullResult>> {
    if (this.#store.session(id) === null) return fail(notFound("session", `no session ${id}`));
    const latest = this.#store.latestIteration(id);
    const contents: IterationContents | null =
      latest === null
        ? null
        : {
            n: latest.n,
            slots: latest.slots,
            blocks: this.#store.iterationBlocks(id, latest.n).map((b) => ({ id: b.id, files: this.#store.content(b.hash).files })),
            proposed: this.#store.iterationProposed(id, latest.n).map((p) => ({ name: p.name, files: this.#store.proposedContent(p.hash).files })),
          };
    const system = this.#store.sessionSystem(id);
    return ok({ files: emitWorkingCopy(id, contents, system === null ? null : this.#systems.docs(system)), iteration: latest?.n ?? null });
  }

  async validate(input: Omit<CommitInput, "note">): Promise<Result<ValidateResult>> {
    const prepared = await this.#prepare(input);
    if (!prepared.ok) return prepared;
    const p = prepared.data;
    return ok(
      p.kind === "replay"
        ? { changed: [], removed: [], wouldCreate: false, warnings: [] }
        : { changed: p.changed, removed: p.removed, wouldCreate: true, warnings: p.warnings },
    );
  }

  async commit(input: CommitInput): Promise<Result<CommitResult>> {
    const prepared = await this.#prepare(input);
    if (!prepared.ok) return prepared;
    const p = prepared.data;
    if (p.kind === "replay") return ok({ iteration: this.#summary(input.session, p.latest), created: false, warnings: [] });

    // The check awaited the worker, so another commit or an attach may have landed meanwhile.
    const written = this.#store.tx((): Result<StoredIteration> => {
      const owner = this.#ownerFailure(input.session, input.thread);
      if (owner !== null) return fail(owner);
      const latest = this.#store.latestIteration(input.session);
      if (latest?.n !== p.latest?.n && latest !== null) return fail(stale(p.draft.manifest.base, latest.n));
      const iteration: StoredIteration = {
        n: ((latest?.n ?? 0) + 1) as IterationN,
        threadId: input.thread,
        note: input.note,
        slots: p.draft.manifest.slots,
        createdAt: this.#now(),
      };
      this.#store.insertIteration({
        session: input.session,
        iteration,
        blocks: p.draft.blocks.map((b) => ({ id: b.id, hash: b.hash })),
        contents: p.contents,
        proposed: p.proposed,
        proposedContents: p.proposedContents,
        addresses: p.addresses,
      });
      if (this.#store.attachment(input.session).lostAt !== null) this.#store.setLost(input.session, null);
      return ok(iteration);
    });
    if (!written.ok) return written;
    this.#emit(input.session);
    return ok({ iteration: this.#summary(input.session, written.data), created: true, warnings: p.warnings });
  }

  #ownerFailure(session: SessionId, thread: ThreadId): Failure | null {
    const owner = this.#store.attachment(session).threadId;
    return owner === thread
      ? null
      : {
          code: "thread_not_attached",
          message: `session ${session} is attached to thread ${owner}, not ${thread}; run brainstorm session attach ${session} from this thread to take it over`,
          owner,
        };
  }

  async #prepare(input: Omit<CommitInput, "note">): Promise<Result<Prepared>> {
    const { session } = input;
    if (this.#store.session(session) === null) return fail(notFound("session", `no session ${session}`));
    const owner = this.#ownerFailure(session, input.thread);
    if (owner !== null) return fail(owner);

    const overrides = this.#store.overrides(session);
    const system = this.#store.sessionSystem(session);
    const scanned = scanWorkingCopy(input.files);
    const parsed = scanned.parsed;
    if (!parsed.ok) {
      // Proposed components didn't all parse; their raw sources still let blocks that import them load.
      const raw = Object.entries(input.files).flatMap(([path, text]) => {
        const m = /^proposed\/([A-Z][A-Za-z0-9]*)\/component\.tsx$/.exec(path);
        return m === null ? [] : [[`proposed/${m[1]}`, text] as const];
      });
      const checked = await this.#check(scanned.blocks, overrides, { system, proposed: [], rawProposed: Object.fromEntries(raw), previous: [] });
      return fail(validationFailed([...parsed.issues, ...checked.issues]));
    }
    const draft = parsed.value;
    if (draft.manifest.session !== session) {
      return fail({
        code: "session_mismatch",
        message: `the working copy belongs to ${draft.manifest.session}, not ${session}`,
        expected: session,
        found: draft.manifest.session,
      });
    }

    const feedback = this.#feedback(session);
    const byId = new Map(feedback.map((f) => [f.id, f]));
    const unknown = input.addresses.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return fail(notFound("feedback", `no feedback ${unknown.map((id) => `#${id}`).join(", ")} in ${session}`));
    }
    const addressable = input.addresses.filter((id) => {
      const f = byId.get(id);
      return f !== undefined && canAppend(f.status, "address");
    });
    const adding = addressable.filter((id) => byId.get(id)?.status.state === "open");

    const latest = this.#store.latestIteration(session);
    const previous = latest === null ? [] : this.#store.iterationBlocks(session, latest.n);
    const previousHash = new Map(previous.map((b) => [b.id, b.hash]));
    const drafted = new Set<BlockId>(draft.blocks.map((b) => b.id));
    const changed = draft.blocks
      .filter((b) => previousHash.get(b.id) !== b.hash)
      .map((b) => b.id)
      .sort();
    const removed = previous.filter((b) => !drafted.has(b.id)).map((b) => b.id);
    const sameSlots = latest !== null && JSON.stringify(latest.slots) === JSON.stringify(draft.manifest.slots);
    const previousProposed = latest === null ? [] : this.#store.iterationProposed(session, latest.n);
    const proposedKey = (list: readonly { name: string; hash: string }[]) => list.map((x) => `${x.name}=${x.hash}`).join(",");
    const sameProposed = proposedKey(previousProposed) === proposedKey(draft.proposed);
    if (latest !== null && changed.length === 0 && removed.length === 0 && sameSlots && sameProposed && adding.length === 0) {
      return ok({ kind: "replay", latest });
    }

    if (latest !== null && draft.manifest.base !== latest.n) return fail(stale(draft.manifest.base, latest.n));
    if (latest === null && draft.manifest.base !== null) {
      return fail(
        validationFailed([
          issue("invalid_manifest", `base is ${draft.manifest.base}, but ${session} has no iterations yet; it must be null`, {
            file: "brainstorm.json",
            pointer: "/base",
          }),
        ]),
      );
    }

    const settled = new Set(previousProposed.map((x) => `${x.name}=${x.hash}`));
    const { issues: checkIssues, contents, proposedContents } = await this.#check(draft.blocks, overrides, {
      system,
      proposed: draft.proposed,
      rawProposed: {},
      previous,
      changedProposed: new Set(draft.proposed.filter((x) => !settled.has(`${x.name}=${x.hash}`)).map((x) => x.name)),
    });
    if (checkIssues.some(isError)) return fail(validationFailed([...parsed.warnings, ...checkIssues]));

    const partsOf = (b: IterationBlock) => contents.get(b.hash)?.parts ?? this.#load(b).content.parts;
    const before = { schemas: this.#schemas(previous), parts: new Map(previous.map((b) => [b.id, partsOf(b)])) };
    const after = {
      schemas: new Map(draft.blocks.map((b) => [b.id, b.props])),
      parts: new Map(draft.blocks.map((b) => [b.id, partsOf(b)])),
    };
    const request = this.#store.openRequest(session);
    const drawn = { titles: new Map(draft.blocks.map((b) => [b.id, b.title])), parts: after.parts };
    const warnings = [
      ...parsed.warnings,
      ...checkIssues,
      ...droppedOverrides(overrides, before.schemas, after.schemas),
      ...lostPins(feedback, before.parts, after.parts),
      ...(request === null ? [] : requestWarnings(request, [...changed, ...removed], input.addresses, byId, drawn)),
    ];
    return ok({
      kind: "create",
      latest,
      draft,
      contents: [...contents.values()],
      proposed: draft.proposed.map((x) => ({ name: x.name, hash: x.hash })),
      proposedContents,
      addresses: addressable,
      changed,
      removed,
      warnings,
    });
  }

  /**
   * Checks blocks, and a session's proposed components. In a freeform session a stored hash passed when it was
   * committed, so only new hashes are checked. With a design system a block's check depends on the kit version and
   * the session's proposed components too, so every block that isn't unchanged from the session's last iteration is
   * checked, as is every block that imports a proposed component; and every block is held to the kit (ADR 007).
   */
  async #check(
    blocks: readonly BlockDraft[],
    overrides: readonly Override[],
    ctx: {
      readonly system: SessionSystem | null;
      readonly proposed: readonly ProposedDraft[];
      /** Sources of proposed components that didn't parse, so blocks importing them can still load. */
      readonly rawProposed: Readonly<Record<string, string>>;
      readonly previous: readonly IterationBlock[];
      /** Proposed components new or changed in this commit, which must declare a tier (ADR 008). */
      readonly changedProposed?: ReadonlySet<string>;
    } = { system: null, proposed: [], rawProposed: {}, previous: [] },
  ): Promise<{ issues: Issue[]; contents: Map<ContentHash, StoredContent>; proposedContents: StoredProposedContent[] }> {
    const overridesByBlock = new Map<BlockId, Override[]>();
    for (const o of overrides) overridesByBlock.set(o.blockId, [...(overridesByBlock.get(o.blockId) ?? []), o]);
    const { system } = ctx;
    const issues: Issue[] = [];
    const contents = new Map<ContentHash, StoredContent>();
    const proposedContents: StoredProposedContent[] = [];

    if (system === null) {
      for (const p of ctx.proposed) {
        issues.push(
          issue("invalid_proposed", "proposed components are for sessions with a design system; this session is freeform, so write the component inside a block", {
            file: proposedFile(p.name, "tsx"),
          }),
        );
      }
      const fresh = blocks.filter((b) => !this.#store.hasContent(b.hash));
      const results = await this.#checker.checkBlocks(fresh, overridesByBlock);
      for (const [hash, result] of results) {
        const block = fresh.find((b) => b.hash === hash);
        if (block === undefined) continue;
        if (result.kind === "failed") issues.push(...result.issues);
        else {
          issues.push(...result.warnings);
          contents.set(hash, { hash, files: block.files, compiled: result.compiled, parts: result.parts });
        }
      }
      return { issues, contents, proposedContents };
    }

    const version = this.#systems.version(system);
    const exports = new Set(version.manifest.exports.map((e) => e.name));
    const sources: Record<string, string> = { ...ctx.rawProposed, ...Object.fromEntries(ctx.proposed.map((p) => [`proposed/${p.name}`, p.files.tsx])) };
    const names = new Set(Object.keys(sources).map((spec) => spec.slice("proposed/".length)));
    const env: CheckEnv = this.#systems.env(system, sources);
    const unchanged = new Set(ctx.previous.map((b) => `${b.id}@${b.hash}`));
    const importsProposed = (b: BlockDraft) => /["']proposed\//.test(b.files.tsx);
    const fresh = blocks.filter((b) => !unchanged.has(`${b.id}@${b.hash}`) || importsProposed(b));
    const results = await this.#checker.checkBlocks(fresh, overridesByBlock, env);
    for (const [hash, result] of results) {
      const block = fresh.find((b) => b.hash === hash);
      if (block === undefined) continue;
      if (result.kind === "failed") issues.push(...result.issues);
      else {
        issues.push(...result.warnings);
        if (!this.#store.hasContent(hash)) contents.set(hash, { hash, files: block.files, compiled: result.compiled, parts: result.parts });
      }
    }
    // Conformance reads every block, including one that failed to render, so Rob's agent sees every rule it broke at once.
    const used = new Set<string>();
    for (const b of blocks) {
      const compiled = compiledForConformance(b.files.tsx);
      if (compiled === null) continue;
      proposedImports(compiled).forEach((n) => used.add(n));
      issues.push(
        ...blockConformance({
          compiled,
          file: blockFile(b.id, "tsx"),
          cssFile: b.files.css === null ? null : blockFile(b.id, "css"),
          exports,
          proposed: names,
        }),
      );
    }

    const checked = await Promise.all(
      ctx.proposed.map(async (p) => {
        const file = proposedFile(p.name, "tsx");
        const result = await this.#checker.checkSource({
          source: p.files.tsx,
          file,
          props: p.example,
          env: this.#systems.env(system, sources, `proposed/${p.name}`),
        });
        return { p, file, result };
      }),
    );
    for (const { p, file, result } of checked) {
      const compiled = result.kind === "ok" ? result.compiled : compiledForConformance(p.files.tsx);
      if (result.kind === "failed") issues.push(...result.issues);
      else issues.push(...result.warnings);
      if (compiled === null) continue;
      proposedImports(compiled).forEach((n) => n !== p.name && used.add(n));
      if (p.tier === null && ctx.changedProposed?.has(p.name) === true) {
        issues.push(
          issue(
            "missing_tier",
            `component.json has no "tier"; say whether ${p.name} is a "primitive" (a basic element, which may write HTML), a "composite" (built from other components) or a "layout" (arranges content around slots)`,
            { file: proposedFile(p.name, "json"), pointer: "/tier" },
          ),
        );
      }
      const tier = p.tier ?? "primitive";
      issues.push(
        ...(tier === "primitive"
          ? proposedConformance({
              compiled,
              css: p.files.css,
              file,
              cssFile: proposedFile(p.name, "css"),
              styles: version.manifest.styles,
              exports,
              proposed: names,
            })
          : blockConformance({ compiled, file, cssFile: p.files.css === null ? null : proposedFile(p.name, "css"), exports, proposed: names, tier })),
      );
      if (result.kind === "ok") proposedContents.push({ hash: p.hash, files: p.files, compiled: result.compiled });
    }
    for (const p of ctx.proposed) {
      if (exports.has(p.name)) {
        issues.push(
          issue("proposed_in_kit", `the kit exports ${p.name} now, so blocks get the kit's; import it from "kit" and delete proposed/${p.name}`, { file: proposedFile(p.name, "tsx") }),
        );
      }
      if (!used.has(p.name)) {
        issues.push(issue("unused_proposed", `no block imports proposed/${p.name}; import it, or delete the folder`, { file: proposedFile(p.name, "tsx") }));
      }
    }
    return { issues, contents, proposedContents };
  }

  async view(id: SessionId): Promise<Result<SessionView>> {
    const session = this.#store.session(id);
    if (session === null) return fail(notFound("session", `no session ${id}`));
    const known = this.#store.attachment(id);
    const attachment = this.#shouldPoll(known.threadId) ? await this.#poll(id) : known;
    const latest = this.#store.latestIteration(id);
    const { iteration, overrides } = this.#current(id, latest);
    const request = this.#store.latestRequest(id);
    const fork = this.#store.fork(id);
    return ok({
      session,
      fork: fork === null ? null : { parent: this.#parentOf(session, fork.parent), from: fork.from },
      lineage: this.#lineage(fork),
      history: { iterations: this.#history(id, fork), forks: this.#store.forksOf(id) },
      attachment,
      thread: this.#seen.get(attachment.threadId)?.snapshot?.thread ?? null,
      iteration,
      overrides,
      feedback: this.#feedback(id),
      request: request === null ? null : this.#requestView(session, request, attachment, iteration),
      regenerate: regenerateGate({ hasIteration: latest !== null, open: this.#store.openRequest(id), attachment }),
      system: this.#sessionSystemView(id, iteration),
    });
  }

/** The kit version, theme and proposed components a canvas frame loads for this session's iteration. */
  #canvasSystem(id: SessionId, iteration: IterationView | null): CanvasSystem | null {
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return null;
    const proposed = (iteration?.proposed ?? []).map(({ name, hash, compiled, css }) => ({ name, hash, compiled, css }));
    return { id: ref.id, n: ref.n, theme: this.#themeState(id), proposed };
  }

  #agentSystem(id: SessionId): AgentContext["system"] {
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return null;
    const docs = this.#systems.docs(ref);
    return { id: ref.id, name: docs.name, n: ref.n, catalog: docs.catalog };
  }

  #themeState(id: SessionId): ThemeState {
    const axes: Record<string, string> = {};
    const tokens: Record<string, string> = {};
    for (const { key, value } of this.#store.sessionTheme(id)) {
      if (key.startsWith("axis:")) axes[key.slice(5)] = value;
      else if (key.startsWith("token:")) tokens[key.slice(6)] = value;
    }
    return { axes, tokens };
  }

  #sessionSystemView(id: SessionId, iteration: IterationView | null): SessionSystemView | null {
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return null;
    const system = this.#store.system(ref.id);
    const version = this.#systems.version(ref);
    const newest = this.#store.latestSystemVersion(ref.id) ?? version;
    const promotions = new Map(this.#store.promotions(id).map((p) => [p.name, p]));
    const newestExports = new Set(newest.manifest.exports.map((e) => e.name));
    const ownExports = new Set(version.manifest.exports.map((e) => e.name));
    const proposed: ProposedView[] = (iteration?.proposed ?? []).map((p) => {
      const promotion = promotions.get(p.name);
      const { name: _n, ...state } = promotion ?? { name: p.name };
      return {
        name: p.name,
        title: p.title,
        description: p.description,
        tier: p.tier,
        usedBy: p.usedBy,
        promotion: promotion === undefined ? null : (state as NonNullable<ProposedView["promotion"]>),
        inSystem: newestExports.has(p.name) ? newest.n : null,
        fromKit: ownExports.has(p.name),
      };
    });
    return {
      id: ref.id,
      name: system?.name ?? ref.id,
      n: ref.n,
      latest: newest.n,
      kitHash: version.hash,
      axes: version.manifest.styles.axes,
      tokens: version.manifest.styles.tokens,
      theme: this.#themeState(id),
      themes: this.#store.themes(ref.id),
      proposed,
      canPromote: system?.projectId != null,
      upgrade: {
        ...componentChanges(version.manifest, newest.manifest),
        ...(newest.n > ref.n
          ? (({ changed, tokens }) => ({ changed: changed.map((c) => c.name), tokens }))(renderChanges(version.manifest, newest.manifest))
          : { changed: [], tokens: [] }),
        check: newest.n > ref.n ? this.#upgradeCheck(id, ref, newest.n) : null,
      },
    };
  }

  /**
   * Whether moving to version `n` would break the session's design, checked once per iteration and version in the
   * background, so the Inspector can say so before Rob upgrades. The session re-renders when the check finishes.
   */
  #upgradeCheck(id: SessionId, ref: SessionSystem, n: SystemVersionN): UpgradeCheck {
    const latest = this.#store.latestIteration(id);
    const key = `${id}@${latest?.n ?? 0}>${ref.id}@${n}`;
    const known = this.#upgradeChecks.get(key);
    if (known !== undefined) return known;
    const checking: UpgradeCheck = { state: "checking" };
    this.#upgradeChecks.set(key, checking);
    void this.#upgradeIssues(id, { id: ref.id, n })
      .then((errors) => {
        const where = [...new Set(errors.map((e) => placeOf(e.file)))];
        const issues = errors.slice(0, 3).map((e) => ({ where: placeOf(e.file), message: e.message }));
        this.#upgradeChecks.set(key, errors.length === 0 ? { state: "clean" } : { state: "breaks", errors: errors.length, where, issues });
      })
      .catch((e: unknown) => this.#upgradeChecks.set(key, { state: "breaks", errors: 1, where: [], issues: [{ where: "the design", message: String(e) }] }))
      .finally(() => this.#emit(id));
    return checking;
  }

  /** The errors the session's latest iteration would have on another version of its system. */
  async #upgradeIssues(id: SessionId, next: SessionSystem): Promise<Issue[]> {
    const latest = this.#store.latestIteration(id);
    if (latest === null) return [];
    const blocks = this.#store.iterationBlocks(id, latest.n).flatMap((b) => {
      const draft = readStoredBlock({ id: b.id, files: this.#store.content(b.hash).files });
      return draft === null ? [] : [draft];
    });
    const proposed = this.#store.iterationProposed(id, latest.n).flatMap((p) => {
      const draft = readStoredProposed(p.name, this.#store.proposedContent(p.hash).files);
      return draft === null ? [] : [draft];
    });
    const { issues } = await this.#check(blocks, this.#store.overrides(id), { system: next, proposed, rawProposed: {}, previous: [] });
    return issues.filter(isError);
  }

  #parentOf(session: SessionSummary, parent: SessionId): ForkLink["parent"] {
    const name = this.#store.sessionName(parent);
    if (name === null || name.gone) return { id: parent, title: name?.title ?? parent, state: "gone" };
    const listing = this.#listings(session.projectId).find((s) => s.id === parent);
    return { id: parent, title: name.title, state: listing?.settlement.state === "active" ? "active" : "settled" };
  }

  #lineage(fork: StoredFork | null): SessionView["lineage"] {
    const out: { id: SessionId; title: string; gone: boolean }[] = [];
    for (let at = fork; at !== null && out.length < 64; at = this.#store.fork(at.parent)) {
      const name = this.#store.sessionName(at.parent);
      out.unshift({ id: at.parent, title: name?.title ?? at.parent, gone: name?.gone ?? true });
    }
    return out;
  }

  #history(id: SessionId, fork: StoredFork | null): HistoryEntry[] {
    const byIteration = new Map(this.#store.requests(id).flatMap((r) => (r.state.state === "fulfilled" ? [[r.state.iteration, r]] : [])));
    return this.#store.iterations(id).map((i): HistoryEntry => {
      const request = byIteration.get(i.n);
      const origin: IterationOrigin =
        request !== undefined
          ? { kind: "request", n: request.n, body: requestBody(request), changed: request.freetext === null ? this.#changedTitles(id, i.n) : [] }
          : i.n === 1 && fork !== null
            ? { kind: "fork", parent: this.#store.sessionName(fork.parent)?.title ?? fork.parent, from: fork.from }
            : i.n === 1
              ? { kind: "brief" }
              : { kind: "agent", note: i.note };
      return { n: i.n, createdAt: i.createdAt, origin };
    });
  }

  #current(id: SessionId, latest: StoredIteration | null): { iteration: IterationView | null; overrides: SessionView["overrides"] } {
    const blocks = latest === null ? [] : this.#store.iterationBlocks(id, latest.n);
    const overrides = classifyOverrides(this.#schemas(blocks), this.#store.overrides(id));
    return { iteration: latest === null ? null : this.#iterationView(id, latest, blocks, overrides.applicable, true), overrides };
  }

  /**
   * Any iteration, with Rob's settings that apply to it. Only the latest has new variants: a past iteration is history,
   * and nothing in it waits to be seen.
   */
  #iterationView(id: SessionId, latest: StoredIteration, blocks: readonly IterationBlock[], applicable: readonly Override[], isLatest: boolean): IterationView {
    const choices = this.#store.slotChoices(id);
    const introduced = isLatest ? this.#store.introducedIn(id) : new Map<BlockId, IterationN>();
    const seen = isLatest ? this.#store.seen(id) : new Set<BlockId>();
    const { slots: _slots, blocks: _blocks, ...summary } = this.#summary(id, latest, blocks);
    const loaded = blocks.map((b) => ({ id: b.id, ...splitBlockId(b.id), ...this.#load(b) }));
    const slots: SlotView[] = latest.slots.flatMap((s) => {
      const [first, ...rest] = loaded.filter((l) => l.slot === s.id).map((l) => l.variant);
      if (first === undefined) return [];
      const chosen = choices.get(s.id);
      const variants = [first, ...rest] as const;
      return [{ ...s, variants, active: chosen !== undefined && variants.includes(chosen) ? chosen : first }];
    });
    const views: BlockView[] = loaded.map(({ id: blockId, slot, variant, draft, content }) => ({
      id: blockId,
      slot,
      variant,
      title: draft.title,
      hash: content.hash,
      compiled: content.compiled,
      css: content.files.css,
      props: draft.props,
      controls: draft.controls,
      parts: content.parts,
      effectiveProps: resolveProps(
        draft.props,
        applicable.filter((o) => o.blockId === blockId),
      ),
      isNew: (introduced.get(blockId) ?? 1) > 1 && !seen.has(blockId),
    }));
    const proposed = this.#store.iterationProposed(id, latest.n).map((p) => {
      const stored = this.#store.proposedContent(p.hash);
      const draft = readStoredProposed(p.name, stored.files);
      return {
        name: p.name,
        hash: p.hash,
        compiled: stored.compiled,
        css: stored.files.css,
        title: draft?.title ?? p.name,
        description: draft?.description ?? "",
        tier: draft?.tier ?? null,
        usedBy: views.filter((v) => proposedImports(v.compiled).includes(p.name)).map((v) => v.id),
      };
    });
    return { ...summary, slots, blocks: views, proposed };
  }

  /** A past iteration as the canvas shows it, read-only: its own blocks, with Rob's settings that still apply to them. */
  iteration(id: SessionId, n: IterationN): Result<IterationView> {
    if (this.#store.session(id) === null) return fail(notFound("session", `no session ${id}`));
    const it = this.#store.iteration(id, n);
    if (it === null) return fail(notFound("iteration", `${id} has no iteration ${n}`));
    const blocks = this.#store.iterationBlocks(id, n);
    const { applicable } = classifyOverrides(this.#schemas(blocks), this.#store.overrides(id));
    return ok(this.#iterationView(id, it, blocks, applicable, false));
  }

  /** `latest` is the latest iteration when the caller already has it, so a request it fulfilled needs no second read. */
  #requestView(
    session: SessionSummary,
    request: Request,
    attachment: Attachment,
    latest: Pick<IterationSummary, "n" | "changed"> | null,
  ): NonNullable<SessionView["request"]> {
    const snapshot = this.#seen.get(request.threadId)?.snapshot ?? null;
    const observation = snapshot === null ? null : observeRequest(session.id, request.n, snapshot);
    const phase = requestPhase(request, attachment, observation);
    if (phase.phase !== "fulfilled") return { request, phase, message: phaseMessage(phase, { title: session.title, changed: [] }) };
    const changed = phase.iteration === latest?.n ? latest.changed : this.#changedIn(session.id, phase.iteration);
    // Rob reads blocks by the titles the canvas shows, not by their ids.
    const titles = new Map(this.#store.iterationBlocks(session.id, phase.iteration).map((b) => [b.id, this.#load(b).draft.title]));
    return { request, phase, message: phaseMessage(phase, { title: session.title, changed: changed.map((id) => titles.get(id) ?? id), scope: request.scope }) };
  }

  async act(id: SessionId, action: RobAction): Promise<Result<SessionView>> {
    const session = this.#store.session(id);
    if (session === null) return fail(notFound("session", `no session ${id}`));
    const failure = await this.#apply(session, action);
    if (failure !== null) return fail(failure);
    this.#emit(id);
    return this.view(id);
  }

  async #apply(session: SessionSummary, action: RobAction): Promise<Failure | null> {
    const id = session.id;
    const latest = this.#store.latestIteration(id);
    const blockIds = latest === null ? [] : this.#store.iterationBlocks(id, latest.n);
    const block = (blockId: BlockId) => blockIds.find((b) => b.id === blockId);
    const feedback = (fid: FeedbackId) => this.#feedback(id).find((f) => f.id === fid);
    const noBlock = (blockId: BlockId) => notFound("block", `${blockId} is not in the latest iteration of ${id}`);
    const noFeedback = (fid: FeedbackId) => notFound("feedback", `no feedback #${fid} in ${id}`);

    switch (action.kind) {
      case "set_override": {
        const b = block(action.blockId);
        if (b === undefined) return noBlock(action.blockId);
        const prop = appearanceProp(this.#load(b).draft.props, action.prop);
        if (prop === undefined) return invalid(`${action.prop} is not an appearance prop of ${action.blockId}`);
        const value = parseAppearanceValue(prop, action.value);
        if (!value.ok) return invalid(`${JSON.stringify(action.value)} doesn't fit ${action.prop} (${value.reason})`);
        this.#store.setOverride(id, { blockId: action.blockId, prop: action.prop, value: value.value, setAt: this.#now() });
        return null;
      }
      case "clear_override":
      case "dismiss_inapplicable":
        this.#store.deleteOverride(id, action.blockId, action.prop);
        return null;
      case "select_variant": {
        const blockId = blockIdOf(action.slot, action.variant);
        if (block(blockId) === undefined) return noBlock(blockId);
        this.#store.setSlotChoice(id, action.slot, action.variant);
        return null;
      }
      case "add_feedback": {
        if (latest === null || block(action.pin.blockId) === undefined) return noBlock(action.pin.blockId);
        this.#store.insertFeedback(id, { pin: action.pin, text: action.text, createdIn: latest.n, at: this.#now() });
        return null;
      }
      case "edit_feedback":
      case "delete_feedback":
      case "confirm_feedback":
      case "reopen_feedback": {
        const f = feedback(action.id);
        if (f === undefined) return noFeedback(action.id);
        const verb = FEEDBACK_VERB[action.kind];
        if (!FEEDBACK_ACTIONS[f.status.state].includes(verb.action)) {
          return invalid(`feedback #${action.id} is ${f.status.state}, so it can't be ${verb.past}`);
        }
        switch (action.kind) {
          case "edit_feedback":
            this.#store.editFeedback(id, action.id, action.text);
            break;
          case "delete_feedback":
            this.#store.deleteFeedback(id, action.id, this.#now());
            break;
          case "confirm_feedback":
            this.#store.appendFeedbackEvent(id, action.id, { kind: "confirm", at: this.#now() });
            break;
          case "reopen_feedback":
            this.#store.appendFeedbackEvent(id, action.id, { kind: "reopen", at: this.#now() });
            break;
        }
        return null;
      }
      case "regenerate":
        return this.#request(id, action, latest, blockIds);
      case "vary": {
        const b = block(action.target.blockId);
        if (b === undefined) return noBlock(action.target.blockId);
        if (!Number.isInteger(action.count) || action.count < 1 || action.count > VARY_MAX) return invalid(`vary asks for 1 to ${VARY_MAX} variants`);
        const { slot, variant } = splitBlockId(b.id);
        const taken = blockIds.map((x) => splitBlockId(x.id)).filter((x) => x.slot === slot).map((x) => x.variant);
        const variants = varyNames({ variant, title: this.#load(b).draft.title }, action.target.part, taken, action.count);
        return this.#request(id, { scope: { kind: "vary", target: action.target, variants }, freetext: action.direction }, latest, blockIds);
      }
      case "mark_seen": {
        const missing = action.blocks.find((b) => block(b) === undefined);
        if (missing !== undefined) return noBlock(missing);
        this.#store.markSeen(id, action.blocks);
        return null;
      }
      case "retry_request":
        return this.#retry(session);
      case "withdraw_request": {
        const open = this.#store.openRequest(id);
        if (open === null) return invalid(`${id} has no open request to withdraw`);
        if (isPendingThread(open.threadId)) return invalid(`${id} is a fork whose thread hasn't started; retry or discard it`);
        this.#store.setRequestState(id, open.n, { state: "withdrawn" });
        return null;
      }
      case "check_thread":
        await this.#poll(id);
        return null;
      case "set_theme_axis":
      case "set_theme_token":
      case "clear_theme_token":
      case "reset_theme":
      case "apply_theme":
      case "save_theme":
        return this.#theme(id, action);
      case "upgrade_system":
        return this.#upgrade(id);
      case "promote":
        return this.#promote(session, action.name);
    }
  }

  /** Theme tweaks belong to the session; a saved theme belongs to the system (ADR 007). */
  #theme(id: SessionId, action: Extract<RobAction, { kind: `${string}_theme${string}` }>): Failure | null {
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return invalid(`${id} has no design system, so it has no theme`);
    const styles = this.#systems.version(ref).manifest.styles;
    const at = this.#now();
    switch (action.kind) {
      case "set_theme_axis": {
        const axis = styles.axes.find((a) => a.attribute === action.axis);
        if (axis === undefined) return notFound("theme", `the system has no theme axis ${action.axis}`);
        if (action.value !== null && !axis.values.includes(action.value)) return invalid(`${action.axis} is one of ${axis.values.join(", ")}`);
        this.#store.setSessionTheme(id, `axis:${action.axis}`, action.value, at);
        return null;
      }
      case "set_theme_token": {
        if (!styles.tokens.some((t) => t.name === action.token)) return notFound("theme", `the system has no token ${action.token}`);
        const value = action.value.trim();
        if (value === "" || value.length > 200 || /[;{}<>]/.test(value)) return invalid(`"${action.value}" isn't a CSS value`);
        this.#store.setSessionTheme(id, `token:${action.token}`, value, at);
        return null;
      }
      case "clear_theme_token":
        this.#store.setSessionTheme(id, `token:${action.token}`, null, at);
        return null;
      case "reset_theme":
        this.#store.clearSessionTheme(id);
        return null;
      case "apply_theme": {
        const theme = this.#store.themes(ref.id).find((t) => t.name === action.name);
        if (theme === undefined) return notFound("theme", `the system has no saved theme "${action.name}"`);
        this.#store.tx(() => {
          this.#store.clearSessionTheme(id);
          for (const [axis, value] of Object.entries(theme.axes)) this.#store.setSessionTheme(id, `axis:${axis}`, value, at);
          for (const [token, value] of Object.entries(theme.tokens)) this.#store.setSessionTheme(id, `token:${token}`, value, at);
        });
        return null;
      }
      case "save_theme": {
        const name = action.name.trim();
        if (name === "" || name.length > 60) return invalid("a theme's name is 1 to 60 characters");
        const state = this.#themeState(id);
        if (Object.keys(state.axes).length === 0 && Object.keys(state.tokens).length === 0) return invalid("this session's theme has no tweaks to save");
        this.#store.saveTheme(ref.id, { name, axes: state.axes, tokens: state.tokens, createdAt: at });
        return null;
      }
    }
  }

  /**
   * Moves the session to its system's newest version, after checking every block and proposed component of its latest
   * iteration against it. A version that breaks the design leaves the session where it was, and says what breaks.
   */
  async #upgrade(id: SessionId): Promise<Failure | null> {
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return invalid(`${id} has no design system`);
    const newest = this.#store.latestSystemVersion(ref.id);
    if (newest === null || newest.n <= ref.n) return invalid(`${id} already uses the newest version of its design system`);
    const errors = await this.#upgradeIssues(id, { id: ref.id, n: newest.n });
    if (errors.length > 0) {
      return {
        code: "validation_failed",
        message: `version ${newest.n} breaks this design in ${errors.length} place${errors.length === 1 ? "" : "s"}, so the session stays on version ${ref.n}`,
        issues: errors,
      };
    }
    const styles = newest.manifest.styles;
    this.#store.tx(() => {
      this.#store.setSessionSystemVersion(id, newest.n);
      for (const { key } of this.#store.sessionTheme(id)) {
        const keep = key.startsWith("axis:") ? styles.axes.some((a) => a.attribute === key.slice(5)) : styles.tokens.some((t) => t.name === key.slice(6));
        if (!keep) this.#store.setSessionTheme(id, key, null, this.#now());
      }
    });
    return null;
  }

  /** Starts a T3 thread on the system's own project that adds a proposed component to the library. */
  async #promote(session: SessionSummary, name: ProposedName): Promise<Failure | null> {
    const id = session.id;
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return invalid(`${id} has no design system to promote into`);
    const system = this.#store.system(ref.id);
    const latest = this.#store.latestIteration(id);
    const stored = latest === null ? undefined : this.#store.iterationProposed(id, latest.n).find((p) => p.name === name);
    if (system === null || stored === undefined) return notFound("proposed", `${id} has no proposed component ${name}`);
    if (system.projectId === null) {
      return invalid(`Brainstorm doesn't know which T3 project holds ${system.source.root}; start a brainstorm from that project once, or add the system from a thread there`);
    }
    const files = this.#store.proposedContent(stored.hash).files;
    const draft = readStoredProposed(name, files);
    this.#store.setPromotion(id, name, { state: "starting" }, this.#now());
    this.#emit(id);
    const result = await this.#bridge.start({
      project: system.projectId,
      title: `Promote ${name} into ${system.name}`,
      message: promoteMessage({
        session,
        system: { id: system.id, name: system.name, root: system.source.root, entry: system.source.entry, folder: tierFolder(system.source, draft?.tier ?? "primitive") },
        name,
        files,
        draft,
        generated: this.#systems.version(ref).manifest.catalog.filter((e) => e.generated).map((e) => e.name),
      }),
    });
    if (result.kind === "failed") {
      this.#store.setPromotion(id, name, { state: "failed", error: result.error }, this.#now());
      return null;
    }
    // `thread start` gives only the id; the thread's own view has the link Rob opens it with.
    const shown = await this.#bridge.snapshot(result.thread, { messages: 0 });
    this.#store.setPromotion(id, name, { state: "started", thread: result.thread, link: shown.kind === "found" ? shown.snapshot.thread.link : null }, this.#now());
    return null;
  }

  /** Writes the session's theme as CSS custom properties and as design tokens (DTCG JSON) to the exports folder. */
  exportTheme(id: SessionId): Result<ThemeExport> {
    const session = this.#store.session(id);
    if (session === null) return fail(notFound("session", `no session ${id}`));
    const ref = this.#store.sessionSystem(id);
    if (ref === null) return fail(invalid(`${id} has no design system, so it has no theme`));
    const name = this.#store.system(ref.id)?.name ?? ref.id;
    const version = this.#systems.version(ref);
    const theme = this.#themeState(id);
    const base = exportFileName(`${session.title} theme`, id, ref.n as number as IterationN, new Date(this.#now())).replace(/\.html$/, "");
    mkdirSync(this.#exportsDir, { recursive: true });
    const write = (file: string, text: string) => {
      const path = join(this.#exportsDir, file);
      writeFileSync(path, text);
      return { path, file };
    };
    return ok({
      css: write(`${base}.css`, themeCss(name, session.title, theme)),
      json: write(`${base}.tokens.json`, `${JSON.stringify(themeTokens(name, theme, version.manifest.styles.tokens), null, 2)}\n`),
    });
  }

  /** Regenerate and vary: one gate, one insert, one send, so both share every phase. */
  async #request(
    id: SessionId,
    body: RequestBody,
    latest: StoredIteration | null,
    blocks: readonly IterationBlock[],
  ): Promise<Failure | null> {
    const open = this.#store.openRequest(id);
    const attachment = this.#store.attachment(id);
    const gate = regenerateGate({ hasIteration: latest !== null, open, attachment });
    if (!gate.ok) {
      switch (gate.reason) {
        case "no_iteration":
          return notFound("iteration", `${id} has no iteration to regenerate yet`);
        case "request_open": {
          const n = open!.n;
          return { code: "request_open", message: `request ${n} is still open; withdraw it first`, n };
        }
        case "thread_lost":
          return {
            code: "thread_lost",
            message: `thread ${attachment.threadId} is gone; take the session over from a T3 thread on this project first`,
            thread: attachment.threadId,
          };
      }
    }
    if (body.scope.kind === "blocks") {
      const missing = body.scope.blocks.find((b) => !blocks.some((x) => x.id === b));
      if (missing !== undefined) return notFound("block", `${missing} is not in the latest iteration of ${id}`);
    }
    const feedbackIds = requestFeedback(this.#feedback(id), body.scope).map((f) => f.id);
    const thread = attachment.threadId;
    const n = this.#store.insertRequest(id, { body, feedbackIds, base: latest?.n ?? null, threadId: thread, at: this.#now() });
    this.#emit(id);
    await this.#send(id, n, thread);
    return null;
  }

  /** Retry and resend: first look for the marker in the attached thread, so a request that arrived is never sent twice. */
  async #retry(session: SessionSummary): Promise<Failure | null> {
    const id = session.id;
    const open = this.#store.openRequest(id);
    if (open === null) return invalid(`${id} has no open request to retry`);
    const { phase, actions } = this.#requestView(session, open, this.#store.attachment(id), null).phase;
    if (!actions.includes("retry") && !actions.includes("resend")) return invalid(`request ${open.n} is ${phase}, so it can't be retried`);

    const thread = this.#store.attachment(id).threadId;
    this.#store.setRequestState(id, open.n, { state: "sending" }, { threadId: thread });
    this.#emit(id);
    if (isPendingThread(thread)) {
      await this.#start(id, true);
      return null;
    }
    const result = await this.#snapshot(id, thread);
    if (result.kind !== "found") {
      const error = result.kind === "missing" ? "the thread is gone" : `couldn't check whether it already arrived: ${result.error}`;
      this.#store.setRequestState(id, open.n, { state: "send_failed", error });
      return null;
    }
    const seen = observeRequest(id, open.n, result.snapshot).kind;
    if (seen === "queued" || seen === "running") {
      this.#store.setRequestState(id, open.n, { state: "sent" }, { sentAt: this.#now() });
      return null;
    }
    await this.#send(id, open.n, thread);
    return null;
  }

  async #send(id: SessionId, n: RequestN, thread: ThreadId): Promise<void> {
    const request = this.#store.openRequest(id);
    if (request === null || request.n !== n) return;
    const result = await this.#bridge.send(thread, this.#messageFor(request));
    // The cached snapshot predates the message, so the next view must look again.
    this.#seen.delete(thread);
    this.#store.setRequestState(
      id,
      n,
      result.kind === "sent" ? { state: "sent" } : { state: "send_failed", error: result.error },
      result.kind === "sent" ? { sentAt: this.#now() } : {},
    );
  }

  /**
   * A fork's first request says where it came from, and a resend of it later says so again. It goes to a thread the
   * app started, so it also names a home other than the default; a thread that made its own brainstorm already knows.
   */
  #messageFor(request: Request): string {
    const fork = request.n === 1 ? this.#store.fork(request.session) : null;
    return formatRequestMessage(request, fork === null ? {} : { fork: { parent: fork.parent, from: fork.from }, home: this.#agentHome });
  }

  /**
   * Makes a new brainstorm from one iteration of `parentId`: each slot narrowed to its picked variant, Rob's settings
   * baked in as that variant's defaults, and his open pins on it carried. Then it starts the fork's T3 thread, whose
   * first message is the fork's request 1. A start that fails leaves the fork saved, with Retry and Discard.
   */
  async fork(parentId: SessionId, input: ForkInput): Promise<Result<{ readonly fork: SessionId }>> {
    const parent = this.#store.session(parentId);
    if (parent === null) return fail(notFound("session", `no session ${parentId}`));
    const source = this.#store.iteration(parentId, input.from);
    if (source === null) return fail(notFound("iteration", `${parentId} has no iteration ${input.from}`));
    const blocks = this.#store.iterationBlocks(parentId, source.n);
    const { applicable } = classifyOverrides(this.#schemas(blocks), this.#store.overrides(parentId));
    const view = this.#iterationView(parentId, source, blocks, applicable, false);
    const carried = carryOver({ slots: view.slots, blocks: view.blocks, picks: input.picks, applicable, feedback: this.#feedback(parentId) });
    if (!carried.ok) return fail(notFound("block", carried.message));
    const { slots, settings, pins } = carried.value;

    const baked = slots.map(({ blockId, title }) => {
      const stored = blocks.find((b) => b.id === blockId)!;
      const mine = settings.filter((s) => s.blockId === blockId);
      if (mine.length === 0) return { id: blockId, title, hash: stored.hash, draft: null };
      const files = this.#load(stored).content.files;
      const draft = readStoredBlock({ id: blockId, files: { ...files, json: bakeDefaults(files.json, mine) } });
      if (draft === null) throw new Error(`${blockId} no longer parses with Rob's settings baked in`);
      return { id: blockId, title, hash: draft.hash, draft };
    });
    const system = this.#store.sessionSystem(parentId);
    const parentProposed = this.#store.iterationProposed(parentId, source.n);
    const proposedDrafts = parentProposed.flatMap((p) => {
      const draft = readStoredProposed(p.name, this.#store.proposedContent(p.hash).files);
      return draft === null ? [] : [draft];
    });
    const { issues, contents } = await this.#check(
      baked.flatMap((b) => (b.draft === null ? [] : [b.draft])),
      [],
      // Unbaked blocks are as the parent committed them, against the same kit, so only the baked ones are checked.
      { system, proposed: [], rawProposed: Object.fromEntries(proposedDrafts.map((p) => [`proposed/${p.name}`, p.files.tsx])), previous: [] },
    );
    const broken = issues.find(isError);
    if (broken !== undefined) {
      const title = baked.find((b) => broken.file?.startsWith(`slots/${b.id}/`))?.title ?? "A picked variant";
      return fail(invalid(`${title} doesn't render with your settings as its defaults (${broken.message}). Reset the setting that breaks it, or pick another variant.`));
    }

    const id = this.#newSessionId();
    const at = this.#now();
    const instruction = input.instruction.trim();
    this.#store.createFork(
      {
        session: { id, projectId: parent.projectId, title: forkTitle(instruction), brief: parent.brief, createdAt: at },
        fork: { parent: parentId, from: source.n, baked: settings.map(({ blockId, prop, value }) => ({ blockId, prop, value })), createdAt: at },
        // The parent's thread wrote these blocks; the fork's own thread writes the next iteration.
        iteration: { n: 1 as IterationN, threadId: source.threadId, note: null, slots: slots.map(({ slot }) => ({ id: slot.id, title: slot.title, frame: slot.frame })), createdAt: at },
        blocks: baked.map((b) => ({ id: b.id, hash: b.hash })),
        contents: [...contents.values()],
        proposed: parentProposed,
        feedback: pins.map((f) => ({ pin: f.pin, text: f.text })),
        system,
        theme: this.#store.sessionTheme(parentId),
        request: { body: { scope: { kind: "all" }, freetext: instruction }, at },
      },
      pendingThreadOf(id),
    );
    this.#emit(id);
    this.#emit(parentId);
    await this.#start(id, false);
    return ok({ fork: id });
  }

  /**
   * Starts a fork's thread with its request 1 as the first message. `lookFirst` is for a retry or a restart: T3 may
   * have started the thread while its reply was lost, so the project's newer threads are searched for the request's
   * marker first, and a failed search starts nothing.
   */
  async #start(id: SessionId, lookFirst: boolean): Promise<void> {
    const session = this.#store.session(id);
    const request = this.#store.openRequest(id);
    if (session === null || request === null || !isPendingThread(this.#store.attachment(id).threadId)) return;
    if (lookFirst) {
      const found = await this.#findStarted(session.projectId, request);
      if (found.kind === "failed") {
        this.#store.setRequestState(id, request.n, { state: "send_failed", error: `couldn't check whether its thread already started: ${found.error}` });
        this.#emit(id);
        return;
      }
      if (found.kind === "found") return this.#adopt(id, found.thread);
    }
    const result = await this.#bridge.start({ project: session.projectId, title: session.title, message: this.#messageFor(request) });
    if (result.kind === "started") return this.#adopt(id, result.thread);
    this.#store.setRequestState(id, request.n, { state: "send_failed", error: result.error });
    this.#emit(id);
  }

  async #findStarted(project: ProjectId, request: Request): Promise<{ kind: "found"; thread: ThreadId } | { kind: "none" } | { kind: "failed"; error: string }> {
    const listed = await this.#bridge.list(project);
    if (listed.kind === "failed") return listed;
    const since = new Date(Date.parse(request.createdAt) - FORK_LOOKBACK_MS).toISOString();
    const recent = listed.threads.filter((t) => t.createdAt >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const t of recent.slice(0, FORK_LOOKUP_THREADS)) {
      const shown = await this.#bridge.snapshot(t.threadId, { messages: SNAPSHOT_MESSAGES });
      if (shown.kind === "found" && observeRequest(request.session, request.n, shown.snapshot).kind !== "not_seen") return { kind: "found", thread: t.threadId };
    }
    return { kind: "none" };
  }

  /**
   * The fork's thread is `thread` from now on. The app's start and the new agent's attach both land here, and the
   * second one changes nothing.
   */
  #adopt(id: SessionId, thread: ThreadId): void {
    this.#store.tx(() => {
      if (isPendingThread(this.#store.attachment(id).threadId)) this.#store.reattach(id, thread, this.#now());
      const open = this.#store.openRequest(id);
      if (open !== null && isPendingThread(open.threadId)) {
        this.#store.setRequestState(id, open.n, { state: "sent" }, { threadId: this.#store.attachment(id).threadId, sentAt: this.#now() });
      }
    });
    this.#seen.delete(thread);
    this.#emit(id);
  }

  /** Throws away a fork whose thread never started. Once it has one, Rob settles it like any other brainstorm. */
  discard(id: SessionId): Result<{ readonly parent: SessionId | null }> {
    if (this.#store.session(id) === null) return fail(notFound("session", `no session ${id}`));
    if (!isPendingThread(this.#store.attachment(id).threadId)) return fail(invalid(`${id}'s thread has started; settle it instead`));
    const parent = this.#store.fork(id)?.parent ?? null;
    this.#store.tx(() => {
      const open = this.#store.openRequest(id);
      if (open !== null) this.#store.setRequestState(id, open.n, { state: "withdrawn" });
      this.#store.archive(id, this.#now());
    });
    this.#emit(id);
    if (parent !== null) this.#emit(parent);
    return ok({ parent });
  }

  /** A still: the slot `at.slot` (else the first) of iteration `at.n` (else the latest), showing its selected variant. */
  preview(id: SessionId, at: { readonly n?: IterationN; readonly slot?: SlotId } = {}): Result<SessionPreview | null> {
    if (this.#store.session(id) === null) return fail(notFound("session", `no session ${id}`));
    let iteration: IterationView | null;
    if (at.n === undefined) iteration = this.#current(id, this.#store.latestIteration(id)).iteration;
    else {
      const past = this.iteration(id, at.n);
      if (!past.ok) return past;
      iteration = past.data;
    }
    const frames = iteration === null ? [] : framesOf(iteration.slots);
    const frame = frames.find((f) => f.slot === at.slot) ?? frames[0];
    const block = frame === undefined ? undefined : iteration?.blocks.find((b) => b.id === frame.blockId);
    if (frame === undefined || block === undefined) return ok(null);
    return ok({
      frame,
      module: { blockId: block.id, hash: block.hash, compiled: block.compiled, css: block.css },
      props: block.effectiveProps,
      system: this.#canvasSystem(id, iteration),
    });
  }

  async exportHtml(id: SessionId): Promise<Result<ExportResult>> {
    const session = this.#store.session(id);
    if (session === null) return fail(notFound("session", `no session ${id}`));
    const latest = this.#store.latestIteration(id);
    const { iteration } = this.#current(id, latest);
    if (latest === null || iteration === null) return fail(notFound("iteration", `${id} has no iteration to export yet`));
    const file = exportFileName(session.title, id, latest.n, new Date(this.#now()));
    const path = join(this.#exportsDir, file);
    mkdirSync(this.#exportsDir, { recursive: true });
    const system = this.#canvasSystem(id, iteration);
    const kit = system === null ? null : this.#systems.kit(system.id, system.n);
    if (kit !== null && !kit.ok) return kit;
    writeFileSync(path, buildCanvasDocument(exportPayload(iteration, kit === null || system === null ? null : { kit: kit.data, theme: system.theme }), "export"));
    return ok({ path, file });
  }

  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      for (const request of this.#store.requestsIn(["sent"])) await this.#poll(request.session);
    } finally {
      this.#ticking = false;
    }
  }

  #shouldPoll(thread: ThreadId): boolean {
    if (isPendingThread(thread)) return false;
    const seen = this.#seen.get(thread);
    return seen === undefined || (seen.snapshot === null && this.#clockMs() - seen.checkedAt >= UNREACHABLE_TTL_MS);
  }

  async #poll(id: SessionId): Promise<Attachment> {
    const before = this.#store.attachment(id);
    const snapshotBefore = JSON.stringify(this.#seen.get(before.threadId)?.snapshot ?? null);
    await this.#snapshot(id, before.threadId);
    const after = this.#store.attachment(id);
    const snapshotAfter = JSON.stringify(this.#seen.get(after.threadId)?.snapshot ?? null);
    if (snapshotBefore !== snapshotAfter || (before.lostAt !== null) !== (after.lostAt !== null)) this.#emit(id);
    return after;
  }

  /** Keeps the last snapshot that was found, so a failed check doesn't blank what Rob already sees. */
  #remember(thread: ThreadId, result: SnapshotResult): void {
    const snapshot = result.kind === "found" ? result.snapshot : (this.#seen.get(thread)?.snapshot ?? null);
    this.#seen.set(thread, { snapshot, checkedAt: this.#clockMs() });
  }

  async #snapshot(id: SessionId, thread: ThreadId): Promise<SnapshotResult> {
    if (isPendingThread(thread)) return { kind: "failed", error: "the fork's thread hasn't started" };
    const result = await this.#bridge.snapshot(thread, { messages: SNAPSHOT_MESSAGES });
    const attachment = this.#store.attachment(id);
    this.#remember(thread, result);
    if (attachment.threadId === thread) {
      if (result.kind === "found" && attachment.lostAt !== null) this.#store.setLost(id, null);
      if (result.kind === "missing" && attachment.lostAt === null) this.#store.setLost(id, this.#now());
    }
    return result;
  }

  async #reconcile(): Promise<void> {
    for (const request of this.#store.requestsIn(["sending"])) {
      if (isPendingThread(request.threadId)) {
        await this.#reconcileFork(request);
        continue;
      }
      const result = await this.#snapshot(request.session, request.threadId);
      const arrived = result.kind === "found" && observeRequest(request.session, request.n, result.snapshot).kind !== "not_seen";
      this.#store.setRequestState(
        request.session,
        request.n,
        arrived
          ? { state: "sent" }
          : {
              state: "send_failed",
              error:
                result.kind === "missing"
                  ? "the thread is gone"
                  : result.kind === "failed"
                    ? `couldn't check the thread after a restart: ${result.error}`
                    : "Brainstorm stopped before the send finished",
            },
        arrived ? { sentAt: this.#now() } : {},
      );
      this.#emit(request.session);
    }
  }

  /** A fork that was starting when Brainstorm stopped: adopt its thread if T3 made one, and never start one unasked. */
  async #reconcileFork(request: Request): Promise<void> {
    const session = this.#store.session(request.session);
    if (session === null) return;
    const found = await this.#findStarted(session.projectId, request);
    if (found.kind === "found") return this.#adopt(request.session, found.thread);
    const error = found.kind === "failed" ? `couldn't check T3 after a restart: ${found.error}` : "Brainstorm stopped before its thread started";
    this.#store.setRequestState(request.session, request.n, { state: "send_failed", error });
    this.#emit(request.session);
  }

  async #resolveThread(thread: ThreadId): Promise<Result<ThreadInfo>> {
    const result = await this.#bridge.snapshot(thread, { messages: SNAPSHOT_MESSAGES });
    this.#remember(thread, result);
    switch (result.kind) {
      case "found":
        return ok(result.snapshot.thread);
      case "missing":
        return fail({ code: "thread_missing", message: `T3 has no thread ${thread}`, thread });
      case "failed":
        return fail({ code: "unavailable", message: `couldn't reach T3: ${result.error}` });
    }
  }

  #feedback(id: SessionId): Feedback[] {
    return this.#store
      .feedback(id)
      .filter((f) => f.deletedAt === null)
      .map(({ deletedAt: _deleted, ...f }: FeedbackRecord) => ({ ...f, status: foldFeedback(f.history) }));
  }

  /** Stored content never changes, so its row and its parse are read once per hash for the life of the service. */
  #load(block: IterationBlock): Loaded {
    const cached = this.#loaded.get(block.hash);
    if (cached !== undefined) return cached;
    const content = this.#store.content(block.hash);
    const draft = readStoredBlock({ id: block.id, files: content.files });
    if (draft === null) throw new Error(`stored block ${block.id} (${block.hash}) no longer parses`);
    const loaded: Loaded = { draft: { title: draft.title, props: draft.props, controls: draft.controls }, content };
    this.#loaded.set(block.hash, loaded);
    return loaded;
  }

  #schemas(blocks: readonly IterationBlock[]): Map<BlockId, PropsSchema> {
    return new Map(blocks.map((b) => [b.id, this.#load(b).draft.props]));
  }

  /** The titles of the blocks iteration `n` changed, as the canvas names them. */
  #changedTitles(id: SessionId, n: IterationN): readonly string[] {
    const titles = new Map(this.#store.iterationBlocks(id, n).map((b) => [b.id, this.#load(b).draft.title]));
    return this.#changedIn(id, n).map((b) => titles.get(b) ?? b);
  }

  #changedIn(id: SessionId, n: IterationN): readonly BlockId[] {
    const iteration = this.#store.iteration(id, n);
    return iteration === null ? [] : this.#summary(id, iteration).changed;
  }

  #summary(id: SessionId, iteration: StoredIteration, blocks: readonly IterationBlock[] = this.#store.iterationBlocks(id, iteration.n)): IterationSummary {
    const previous = new Map(
      iteration.n > 1 ? this.#store.iterationBlocks(id, (iteration.n - 1) as IterationN).map((b) => [b.id, b.hash]) : [],
    );
    return {
      n: iteration.n,
      threadId: iteration.threadId,
      note: iteration.note,
      createdAt: iteration.createdAt,
      slots: iteration.slots,
      blocks: blocks.map((b) => b.id),
      changed: blocks.filter((b) => previous.get(b.id) !== b.hash).map((b) => b.id),
    };
  }
}

const invalid = (message: string): Failure => ({ code: "invalid_action", message });

const FEEDBACK_VERB: Record<
  "edit_feedback" | "delete_feedback" | "confirm_feedback" | "reopen_feedback",
  { readonly action: FeedbackAction; readonly past: string }
> = {
  edit_feedback: { action: "edit", past: "edited" },
  delete_feedback: { action: "delete", past: "deleted" },
  confirm_feedback: { action: "confirm", past: "confirmed" },
  reopen_feedback: { action: "reopen", past: "reopened" },
};

const requestBody = (request: Request): RequestBody =>
  request.scope.kind === "described"
    ? { scope: request.scope, freetext: request.freetext ?? "" }
    : { scope: request.scope, freetext: request.freetext };

function validationFailed(issues: readonly Issue[]): Failure {
  const errors = issues.filter(isError).length;
  return { code: "validation_failed", message: `${errors} error${errors === 1 ? "" : "s"}; nothing was saved`, issues };
}

function stale(base: IterationN | null, latest: IterationN): Failure {
  return {
    code: "stale_working_copy",
    message: `the working copy is based on ${base === null ? "no iteration" : `iteration ${base}`}, but iteration ${latest} is the latest; pull again and reapply your edits`,
    base,
    latest,
  };
}

function droppedOverrides(
  overrides: readonly Override[],
  before: ReadonlyMap<BlockId, PropsSchema>,
  after: ReadonlyMap<BlockId, PropsSchema>,
): Issue[] {
  const key = (o: Override) => `${o.blockId}\u0000${o.prop}`;
  const applied = new Set(classifyOverrides(before, overrides).applicable.map(key));
  return classifyOverrides(after, overrides)
    .inapplicable.filter(({ override }) => applied.has(key(override)))
    .map(({ override: o, reason }) =>
      issue(
        "override_dropped",
        `Rob set ${o.prop} = ${JSON.stringify(o.value)} on ${o.blockId}, and it no longer applies (${reason}); he'll see it flagged`,
        { file: blockFile(o.blockId, "json") },
      ),
    );
}

function lostPins(
  feedback: readonly Feedback[],
  before: ReadonlyMap<BlockId, readonly PartName[]>,
  after: ReadonlyMap<BlockId, readonly PartName[]>,
): Issue[] {
  const placed = (parts: ReadonlyMap<BlockId, readonly PartName[]>, f: Feedback) => {
    const rendered = parts.get(f.pin.blockId);
    return rendered !== undefined && (f.pin.part === null || rendered.includes(f.pin.part));
  };
  return feedback
    .filter((f) => f.status.state !== "confirmed" && placed(before, f) && !placed(after, f))
    .map((f) =>
      issue(
        "pin_lost",
        `feedback #${f.id} ("${f.text}") is pinned to ${f.pin.part === null ? "" : `data-part "${f.pin.part}" in `}${f.pin.blockId}, which this commit no longer renders`,
        { file: blockFile(f.pin.blockId, "tsx") },
      ),
    );
}

type Drawn = { readonly titles: ReadonlyMap<BlockId, string>; readonly parts: ReadonlyMap<BlockId, readonly PartName[]> };

function requestWarnings(
  request: Request,
  touched: readonly BlockId[],
  addresses: readonly FeedbackId[],
  feedback: ReadonlyMap<FeedbackId, Feedback>,
  drawn: Drawn,
): Issue[] {
  const scope = request.scope;
  const allowed: readonly BlockId[] | null =
    scope.kind === "blocks"
      ? scope.blocks
      : scope.kind === "vary"
        ? scope.variants.map((v) => blockIdOf(splitBlockId(scope.target.blockId).slot, v.key))
        : null;
  const asked = scope.kind === "vary" ? `new variants of ${scope.target.blockId}: ${allowed?.join(", ")}` : allowed?.join(", ");
  const outOfScope =
    allowed === null
      ? []
      : touched
          .filter((b) => !allowed.includes(b))
          .map((b) => issue("out_of_scope", `${b} changed, but request ${request.n} asked only for ${asked}`, { file: blockFile(b, "tsx") }));
  const notAddressed = request.feedbackIds
    .filter((fid) => feedback.get(fid)?.status.state === "open" && !addresses.includes(fid))
    .map((fid) =>
      issue(
        "not_addressed",
        `request ${request.n} asked about feedback #${fid}, and this commit doesn't address it; pass --addresses ${fid} if it does`,
      ),
    );
  return [...outOfScope, ...(scope.kind === "vary" ? varyMismatches(request.n, scope, drawn) : []), ...notAddressed];
}

/** Each variant a vary asked for exists under its key and title, and still renders the element it varies. */
function varyMismatches(n: RequestN, scope: VaryScope, drawn: Drawn): Issue[] {
  const { slot } = splitBlockId(scope.target.blockId);
  const part = scope.target.part;
  return scope.variants.flatMap((v) => {
    const id = blockIdOf(slot, v.key);
    const title = drawn.titles.get(id);
    if (title === undefined) {
      return [issue("vary_mismatch", `request ${n} asked for ${id} titled "${v.title}", and this commit has no such block`, { file: "brainstorm.json" })];
    }
    const out: Issue[] = [];
    if (title !== v.title) out.push(issue("vary_mismatch", `${id} is titled "${title}"; request ${n} named it "${v.title}"`, { file: blockFile(id, "json") }));
    if (part !== null && !(drawn.parts.get(id) ?? []).includes(part)) {
      out.push(issue("vary_mismatch", `${id} doesn't render data-part "${part}", the element request ${n} asked to vary`, { file: blockFile(id, "tsx") }));
    }
    return out;
  });
}

/** `slots/home/a/block.tsx` → `home/a`; `proposed/WeekStrip/component.tsx` → `proposed/WeekStrip`. */
function placeOf(file: string | null): string {
  if (file === null) return "the design";
  const block = /^slots\/([^/]+)\/([^/]+)\//.exec(file);
  if (block !== null) return `${block[1]}/${block[2]}`;
  const proposed = /^proposed\/([^/]+)\//.exec(file);
  return proposed !== null ? `proposed/${proposed[1]}` : file;
}

function promoteMessage(input: {
  session: SessionSummary;
  system: { id: SystemId; name: string; root: string; entry: string | null; folder: string | null };
  name: ProposedName;
  files: { tsx: string; json: string; css: string | null };
  draft: ProposedDraft | null;
  /** The primitives Brainstorm generated because the library has none. */
  generated: readonly string[];
}): string {
  const { session, system, name, files, draft } = input;
  const fromKit = [...files.tsx.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']kit["']/g)].flatMap((m) =>
    (m[1] ?? "").split(",").map((n) => n.trim().split(/\s+as\s+/)[0] ?? ""),
  );
  const standIns = fromKit.filter((n) => input.generated.includes(n));
  const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text.trimEnd()}\n\`\`\``;
  return [
    `[brainstorm] promote ${name} from session ${session.id} ("${session.title}")`,
    "",
    `A Brainstorm design built with the ${system.name} design system needed a component the library doesn't have, so it proposed ${name}. Add it to the library at ${system.root}, so designs and the app can use it from the kit.`,
    "",
    draft === null ? "" : `What it's for: ${draft.description}`,
    "",
    "- Write it the way the library writes its components: the same file layout, the same styling approach and variants, and its tokens. Keep its look; the design was built against it.",
    system.entry === null
      ? `- The proposed files import from "kit", Brainstorm's name for the components .brainstorm/system.json lists; import each from its own file instead.`
      : `- The proposed files import from "kit", Brainstorm's name for this library's entry (${system.entry}); import from the library's own modules instead.`,
    ...(draft?.tier == null
      ? []
      : [
          `- It is a ${draft.tier}${system.folder === null ? "" : `, so it belongs in ${system.folder} with the system's other ${draft.tier}s`}.${draft.tier === "primitive" ? "" : " It composes other components and writes no HTML of its own; keep it that way."}`,
        ]),
    ...(standIns.length === 0
      ? []
      : [
          `- ${standIns.join(", ")} ${standIns.length === 1 ? "is a primitive" : "are primitives"} Brainstorm generated because the library has none. Write it the way the library's own components do, such as with its utility classes.`,
        ]),
    system.entry === null
      ? `- Write a story for it in .brainstorm/stories/${draft === null ? "" : " that renders component.json's example"}${draft?.tier == null || draft.tier === "primitive" ? "" : `, with \`tags: ["${draft.tier}"]\` in its meta if its file isn't under the adapter's ${draft.tier}s`}.`
      : `- Export it from the library's entry, and write a story for it${draft === null ? "" : " that renders component.json's example"}.`,
    `- Then run \`brainstorm system sync ${system.id}\`, so the design system's next version has it. Brainstorm then offers the upgrade in the session, and after it the design uses the library's component.`,
    "- End with a short report: where you departed from the proposed files, and why, then a last line saying what you added and which version the sync made. Brainstorm shows that last line beside the promotion.",
    "",
    "The proposed files:",
    "",
    "component.tsx",
    fence("tsx", files.tsx),
    "",
    "component.json",
    fence("json", files.json),
    ...(files.css === null ? [] : ["", "component.css", fence("css", files.css)]),
  ].join("\n");
}

function themeCss(system: string, session: string, theme: ThemeState): string {
  const axes = Object.entries(theme.axes);
  const tokens = Object.entries(theme.tokens);
  const lines = [`/* ${system} theme, from the Brainstorm session "${session.replace(/\*\//g, "")}". */`];
  if (axes.length > 0) {
    lines.push(`/* Set on <html>: ${axes.map(([a, v]) => (a === "class" ? `class="${v}"` : `${a}="${v}"`)).join(" ")} */`);
  }
  lines.push(":root {", ...tokens.map(([name, value]) => `  ${name}: ${value};`), "}", "");
  return lines.join("\n");
}

const DTCG_TYPE: Record<string, string | null> = { color: "color", length: "dimension", font: "fontFamily", number: "number", other: null };

function themeTokens(system: string, theme: ThemeState, tokens: readonly { name: string; kind: string }[]): Record<string, unknown> {
  const kinds = new Map(tokens.map((t) => [t.name, t.kind]));
  const out: Record<string, unknown> = {
    $description: `${system} theme from Brainstorm`,
    $extensions: { "brainstorm.axes": theme.axes },
  };
  for (const [name, value] of Object.entries(theme.tokens)) {
    const type = DTCG_TYPE[kinds.get(name) ?? "other"] ?? null;
    out[name.replace(/^--/, "")] = type === null ? { $value: value } : { $type: type, $value: value };
  }
  return out;
}
