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
} from "./machines";
import { appearanceProp, classifyOverrides, parseAppearanceValue, resolveProps } from "./props";
import { Store, type FeedbackRecord, type IterationBlock, type StoredContent, type StoredIteration } from "./store";
import {
  blockIdOf,
  issue,
  isError,
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
  type Issue,
  type IterationContents,
  type IterationN,
  type IterationSummary,
  type IterationView,
  type NewSessionResult,
  type Override,
  type PartName,
  type ProjectId,
  type PropsSchema,
  type PullResult,
  type Request,
  type RequestBody,
  type RequestN,
  type Result,
  type RobAction,
  type SessionId,
  type SessionListing,
  type SessionSummary,
  type SessionView,
  type SlotView,
  type SnapshotResult,
  type ThreadId,
  type ThreadInfo,
  type ThreadSnapshot,
  type ValidateResult,
  type WorkingCopyDraft,
} from "./types";
import { blockFile, emitWorkingCopy, readStoredBlock, scanWorkingCopy } from "./workingCopy";

const SNAPSHOT_MESSAGES = 30;
/** How long view() trusts a failed or missing snapshot before asking T3 again. */
const UNREACHABLE_TTL_MS = 10_000;

export type BrainstormOptions = {
  readonly dbPath: string;
  readonly exportsDir: string;
  readonly bridge: AgentBridge;
  readonly checker: Checker;
  readonly now?: () => string;
  readonly newSessionId?: () => SessionId;
  /** Monotonic milliseconds, for the snapshot cache's TTL. */
  readonly clockMs?: () => number;
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
      readonly addresses: readonly FeedbackId[];
      readonly changed: readonly BlockId[];
      readonly removed: readonly BlockId[];
      readonly warnings: readonly Issue[];
    };

/** The part of a parsed block that depends only on its content, so it can be shared by every block with that hash. */
type Loaded = { readonly draft: Pick<BlockDraft, "title" | "props" | "controls">; readonly content: StoredContent };

/** The last snapshot T3 gave for a thread, and when we last asked. */
type Seen = { readonly snapshot: ThreadSnapshot | null; readonly checkedAt: number };

const summaryOf = ({ id, projectId, projectName, title, brief, createdAt }: SessionSummary): SessionSummary => ({ id, projectId, projectName, title, brief, createdAt });

/** The one facade over Brainstorm's rules. The store owns SQL, the bridge owns T3, and this class owns policy. */
export class Brainstorm {
  readonly #store: Store;
  readonly #bridge: AgentBridge;
  readonly #checker: Checker;
  readonly #exportsDir: string;
  readonly #now: () => string;
  readonly #newSessionId: () => SessionId;
  readonly #clockMs: () => number;
  readonly #seen = new Map<ThreadId, Seen>();
  readonly #loaded = new Map<ContentHash, Loaded>();
  readonly #listeners = new Set<(session: SessionId) => void>();
  readonly #emitting = new Set<SessionId>();
  #ticking = false;

  private constructor(options: BrainstormOptions) {
    this.#store = new Store(options.dbPath);
    this.#bridge = options.bridge;
    this.#checker = options.checker;
    this.#exportsDir = options.exportsDir;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newSessionId = options.newSessionId ?? randomSessionId;
    this.#clockMs = options.clockMs ?? (() => performance.now());
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

  subscribe(listener: (session: SessionId) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Tells listeners once per session per microtask, however many writes the current step made. */
  #emit(session: SessionId): void {
    if (this.#emitting.has(session)) return;
    this.#emitting.add(session);
    queueMicrotask(() => {
      this.#emitting.delete(session);
      for (const listener of this.#listeners) listener(session);
    });
  }

  // ---- agent commands

  async newSession(input: {
    title: string;
    brief: string;
    thread: ThreadId;
    projectPath: string | null;
    projectName: string | null;
  }): Promise<Result<NewSessionResult>> {
    const thread = await this.#resolveThread(input.thread);
    if (!thread.ok) return thread;
    const session: SessionSummary = {
      id: this.#newSessionId(),
      projectId: thread.data.projectId,
      projectName: input.projectName,
      title: input.title,
      brief: input.brief,
      createdAt: this.#now(),
    };
    this.#store.tx(() => {
      this.#store.ensureProject(session.projectId, input.projectPath, session.createdAt);
      this.#store.createSession(session, input.thread);
    });
    this.#emit(session.id);
    return ok({ session, attachment: this.#store.attachment(session.id) });
  }

  /** The sessions in the thread's project, or every session when `thread` is null. */
  async listSessions(thread: ThreadId | null): Promise<Result<SessionListing[]>> {
    let project: ProjectId | null = null;
    if (thread !== null) {
      const info = await this.#resolveThread(thread);
      if (!info.ok) return info;
      project = info.data.projectId;
    }
    return ok(this.#store.sessions(project));
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
    if (current.threadId === input.thread) {
      if (current.lostAt !== null) this.#store.setLost(session.id, null);
    } else {
      this.#store.reattach(session.id, input.thread, this.#now());
    }
    this.#emit(session.id);
    return ok({
      session,
      attachment: this.#store.attachment(session.id),
      previous: current.threadId === input.thread ? null : current.threadId,
    });
  }

  /** An exact id, then a case-insensitive exact title, then a unique case-insensitive substring, in the caller's project first. */
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
    const inScope = (block: BlockId) => open === null || open.scope.kind !== "blocks" || open.scope.blocks.includes(block);
    const attached = thread !== null && thread === attachment.threadId;
    const addresses = open?.feedbackIds ?? [];
    return ok({
      session: { id, title: session.title, brief: session.brief },
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
          };
    return ok({ files: emitWorkingCopy(id, contents), iteration: latest?.n ?? null });
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
    const scanned = scanWorkingCopy(input.files);
    const parsed = scanned.parsed;
    if (!parsed.ok) {
      const checked = await this.#check(scanned.blocks, overrides);
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
    if (latest !== null && changed.length === 0 && removed.length === 0 && sameSlots && adding.length === 0) {
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

    const { issues: checkIssues, contents } = await this.#check(draft.blocks, overrides);
    if (checkIssues.some(isError)) return fail(validationFailed([...parsed.warnings, ...checkIssues]));

    const partsOf = (b: IterationBlock) => contents.get(b.hash)?.parts ?? this.#load(b).content.parts;
    const before = { schemas: this.#schemas(previous), parts: new Map(previous.map((b) => [b.id, partsOf(b)])) };
    const after = {
      schemas: new Map(draft.blocks.map((b) => [b.id, b.props])),
      parts: new Map(draft.blocks.map((b) => [b.id, partsOf(b)])),
    };
    const request = this.#store.openRequest(session);
    const warnings = [
      ...parsed.warnings,
      ...checkIssues,
      ...droppedOverrides(overrides, before.schemas, after.schemas),
      ...lostPins(feedback, before.parts, after.parts),
      ...(request === null ? [] : requestWarnings(request, [...changed, ...removed], input.addresses, byId)),
    ];
    return ok({ kind: "create", latest, draft, contents: [...contents.values()], addresses: addressable, changed, removed, warnings });
  }

  /** Checks every content hash the store doesn't already hold. Stored hashes passed when they were committed. */
  async #check(
    blocks: readonly BlockDraft[],
    overrides: readonly Override[],
  ): Promise<{ issues: Issue[]; contents: Map<ContentHash, StoredContent> }> {
    const overridesByBlock = new Map<BlockId, Override[]>();
    for (const o of overrides) overridesByBlock.set(o.blockId, [...(overridesByBlock.get(o.blockId) ?? []), o]);
    const fresh = blocks.filter((b) => !this.#store.hasContent(b.hash));
    const results = await this.#checker.checkBlocks(fresh, overridesByBlock);
    const issues: Issue[] = [];
    const contents = new Map<ContentHash, StoredContent>();
    for (const [hash, result] of results) {
      const block = fresh.find((b) => b.hash === hash);
      if (block === undefined) continue;
      if (result.kind === "failed") issues.push(...result.issues);
      else {
        issues.push(...result.warnings);
        contents.set(hash, { hash, files: block.files, compiled: result.compiled, parts: result.parts });
      }
    }
    return { issues, contents };
  }

  // ---- Rob's side

  async view(id: SessionId): Promise<Result<SessionView>> {
    const session = this.#store.session(id);
    if (session === null) return fail(notFound("session", `no session ${id}`));
    const known = this.#store.attachment(id);
    const attachment = this.#shouldPoll(known.threadId) ? await this.#poll(id) : known;
    const latest = this.#store.latestIteration(id);
    const { iteration, overrides } = this.#current(id, latest);
    const request = this.#store.latestRequest(id);
    return ok({
      session,
      attachment,
      thread: this.#seen.get(attachment.threadId)?.snapshot?.thread ?? null,
      iteration,
      overrides,
      feedback: this.#feedback(id),
      request: request === null ? null : this.#requestView(session, request, attachment, iteration),
      regenerate: regenerateGate({ hasIteration: latest !== null, open: this.#store.openRequest(id), attachment }),
    });
  }

  /** The latest iteration as Rob sees it, with every override classified against its schemas. */
  #current(id: SessionId, latest: StoredIteration | null): { iteration: IterationView | null; overrides: SessionView["overrides"] } {
    const blocks = latest === null ? [] : this.#store.iterationBlocks(id, latest.n);
    const overrides = classifyOverrides(this.#schemas(blocks), this.#store.overrides(id));
    return { iteration: latest === null ? null : this.#iterationView(id, latest, blocks, overrides.applicable), overrides };
  }

  #iterationView(id: SessionId, latest: StoredIteration, blocks: readonly IterationBlock[], applicable: readonly Override[]): IterationView {
    const choices = this.#store.slotChoices(id);
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
      about: content.files.about,
      props: draft.props,
      controls: draft.controls,
      parts: content.parts,
      effectiveProps: resolveProps(
        draft.props,
        applicable.filter((o) => o.blockId === blockId),
      ),
    }));
    return { ...summary, slots, blocks: views };
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
    const changed =
      phase.phase !== "fulfilled" ? [] : phase.iteration === latest?.n ? latest.changed : this.#changedIn(session.id, phase.iteration);
    return { request, phase, message: phaseMessage(phase, { title: session.title, changed }) };
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
        return this.#regenerate(id, action, latest, blockIds);
      case "retry_request":
        return this.#retry(session);
      case "withdraw_request": {
        const open = this.#store.openRequest(id);
        if (open === null) return invalid(`${id} has no open request to withdraw`);
        this.#store.setRequestState(id, open.n, { state: "withdrawn" });
        return null;
      }
      case "check_thread":
        await this.#poll(id);
        return null;
    }
  }

  async #regenerate(
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
    const result = await this.#bridge.send(thread, formatRequestMessage(request));
    // The cached snapshot predates the message, so the next view must look again.
    this.#seen.delete(thread);
    this.#store.setRequestState(
      id,
      n,
      result.kind === "sent" ? { state: "sent" } : { state: "send_failed", error: result.error },
      result.kind === "sent" ? { sentAt: this.#now() } : {},
    );
  }

  /** Writes the latest iteration, with Rob's overrides and variant choices, as one offline HTML file. */
  async exportHtml(id: SessionId): Promise<Result<ExportResult>> {
    if (this.#store.session(id) === null) return fail(notFound("session", `no session ${id}`));
    const latest = this.#store.latestIteration(id);
    const { iteration } = this.#current(id, latest);
    if (latest === null || iteration === null) return fail(notFound("iteration", `${id} has no iteration to export yet`));
    const file = `${id}-i${latest.n}-${fileStamp(new Date(this.#now()))}.html`;
    const path = join(this.#exportsDir, file);
    mkdirSync(this.#exportsDir, { recursive: true });
    writeFileSync(path, buildCanvasDocument(exportPayload(iteration), "export"));
    return ok({ path, file });
  }

  // ---- tracker

  /** Polls the attached thread of every session with a sent request. Overlapping ticks are skipped. */
  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      for (const request of this.#store.requestsIn(["sent"])) await this.#poll(request.session);
    } finally {
      this.#ticking = false;
    }
  }

  /** view() asks T3 only about a thread it has never seen, or one that failed or went missing at least the TTL ago. */
  #shouldPoll(thread: ThreadId): boolean {
    const seen = this.#seen.get(thread);
    return seen === undefined || (seen.snapshot === null && this.#clockMs() - seen.checkedAt >= UNREACHABLE_TTL_MS);
  }

  /** Snapshots the attached thread, tells listeners if anything Rob sees changed, and returns the attachment after. */
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

  /** Snapshots a thread, caches it, and records loss or recovery when it is the session's attached thread. */
  async #snapshot(id: SessionId, thread: ThreadId): Promise<SnapshotResult> {
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

  // ---- reads

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

/** yyyyMMdd-HHmmss in local time, which is what Rob reads in Explorer. */
function fileStamp(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

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

/** Overrides that applied to the previous iteration and don't apply to this one. */
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

/** Feedback pinned to something the previous iteration rendered and this one doesn't. */
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

function requestWarnings(
  request: Request,
  touched: readonly BlockId[],
  addresses: readonly FeedbackId[],
  feedback: ReadonlyMap<FeedbackId, Feedback>,
): Issue[] {
  const scope = request.scope;
  const outOfScope =
    scope.kind === "blocks"
      ? touched
          .filter((b) => !scope.blocks.includes(b))
          .map((b) =>
            issue("out_of_scope", `${b} changed, but request ${request.n} asked only for ${scope.blocks.join(", ")}`, {
              file: blockFile(b, "tsx"),
            }),
          )
      : [];
  const notAddressed = request.feedbackIds
    .filter((fid) => feedback.get(fid)?.status.state === "open" && !addresses.includes(fid))
    .map((fid) =>
      issue(
        "not_addressed",
        `request ${request.n} asked about feedback #${fid}, and this commit doesn't address it; pass --addresses ${fid} if it does`,
      ),
    );
  return [...outOfScope, ...notAddressed];
}
