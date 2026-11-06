declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type NonEmpty<T> = readonly [T, ...T[]];

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type SessionId = Brand<string, "SessionId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ThreadId = Brand<string, "ThreadId">;
export type RunId = Brand<string, "RunId">;
export type SlotId = Brand<string, "SlotId">;
export type VariantKey = Brand<string, "VariantKey">;
export type BlockId = Brand<string, "BlockId">;
export type PropName = Brand<string, "PropName">;
export type PartName = Brand<string, "PartName">;
export type IterationN = Brand<number, "IterationN">;
export type RequestN = Brand<number, "RequestN">;
export type FeedbackId = Brand<number, "FeedbackId">;
export type ContentHash = Brand<string, "ContentHash">;

export const SESSION_ID_PATTERN = /^s_[0-9a-z]{6,16}$/;
// T3 prefixes threads that agents create, e.g. "mcp:<uuid>".
export const THREAD_ID_PATTERN = /^(?:[a-z]+:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLOT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const PROP_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

const matching =
  <T extends string>(pattern: RegExp) =>
  (raw: string): T | null =>
    pattern.test(raw) ? (raw as T) : null;

const nonEmpty =
  <T extends string>() =>
  (raw: string): T | null =>
    raw.length > 0 ? (raw as T) : null;

const positiveInt =
  <T extends number>() =>
  (raw: number): T | null =>
    Number.isSafeInteger(raw) && raw > 0 ? (raw as T) : null;

export const parseSessionId = matching<SessionId>(SESSION_ID_PATTERN);
export const parseThreadId = matching<ThreadId>(THREAD_ID_PATTERN);
export const parseSlotId = matching<SlotId>(SLOT_ID_PATTERN);
export const parseVariantKey = matching<VariantKey>(SLOT_ID_PATTERN);
export const parsePropName = matching<PropName>(PROP_NAME_PATTERN);
export const parseContentHash = matching<ContentHash>(CONTENT_HASH_PATTERN);
export const parseProjectId = nonEmpty<ProjectId>();
export const parseRunId = nonEmpty<RunId>();
export const parsePartName = nonEmpty<PartName>();
export const parseIterationN = positiveInt<IterationN>();
export const parseRequestN = positiveInt<RequestN>();
export const parseFeedbackId = positiveInt<FeedbackId>();

export function blockIdOf(slot: SlotId, variant: VariantKey): BlockId {
  return `${slot}/${variant}` as BlockId;
}

export function splitBlockId(id: BlockId): { readonly slot: SlotId; readonly variant: VariantKey } {
  const [slot, variant] = id.split("/") as [SlotId, VariantKey];
  return { slot, variant };
}

export function parseBlockId(raw: string): BlockId | null {
  const [slot, variant, ...rest] = raw.split("/");
  if (rest.length > 0 || slot === undefined || variant === undefined) return null;
  const s = parseSlotId(slot);
  const v = parseVariantKey(variant);
  return s && v ? blockIdOf(s, v) : null;
}

export type DataProp = {
  readonly name: PropName;
  readonly type: "data";
  readonly description: string | null;
  readonly sample: Json;
};

export type NumberProp = {
  readonly name: PropName;
  readonly type: "number";
  readonly label: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number | null;
  readonly unit: string | null;
};

export type EnumProp = {
  readonly name: PropName;
  readonly type: "enum";
  readonly label: string;
  readonly default: string;
  readonly options: NonEmpty<string>;
};

export type ColorProp = { readonly name: PropName; readonly type: "color"; readonly label: string; readonly default: string };
export type BooleanProp = { readonly name: PropName; readonly type: "boolean"; readonly label: string; readonly default: boolean };
export type TextProp = {
  readonly name: PropName;
  readonly type: "text";
  readonly label: string;
  readonly default: string;
  readonly multiline: boolean;
};

export type AppearanceProp = NumberProp | EnumProp | ColorProp | BooleanProp | TextProp;
export type AppearanceType = AppearanceProp["type"];
export type AppearanceValue = number | string | boolean;

/** Both lists keep the order they were written in, which is the order derived controls use. */
export type PropsSchema = {
  readonly data: readonly DataProp[];
  readonly appearance: readonly AppearanceProp[];
};

/** The flat object a block component receives: data samples, then appearance defaults, then applicable overrides. */
export type Props = Readonly<Record<string, Json>>;

export type Override = {
  readonly blockId: BlockId;
  readonly prop: PropName;
  readonly value: AppearanceValue;
  readonly setAt: string;
};

export type OverrideMismatch = "prop_removed" | "type_changed" | "out_of_range" | "option_removed" | "block_removed";

export type InapplicableOverride = { readonly override: Override; readonly reason: OverrideMismatch };

export type ControlKind = "Slider" | "Select" | "Segmented" | "Colour" | "Toggle" | "Text";

export type SectionElement = {
  readonly type: "Section";
  readonly props: { readonly title: string | null };
  readonly children: readonly string[];
};

/** `label: null` means the control shows the prop's label. */
export type ControlElement = {
  readonly type: ControlKind;
  readonly props: { readonly label: string | null; readonly value: { readonly $bindState: string } };
  readonly children: readonly [];
};

export type ControlsSpec = {
  readonly root: string;
  readonly elements: Readonly<Record<string, SectionElement | ControlElement>>;
};

/** Relative POSIX path to UTF-8 text. */
export type FileMap = Readonly<Record<string, string>>;

export type FrameSize = { readonly width: number; readonly height: number | null };

export type SlotManifest = { readonly id: SlotId; readonly title: string; readonly frame: FrameSize };

export type WorkingCopyManifest = {
  readonly format: 1;
  readonly session: SessionId;
  readonly base: IterationN | null;
  readonly slots: readonly SlotManifest[];
};

/** A block's stored files, LF line endings, no BOM. `controls: null` means the controls are derived. */
export type BlockFiles = {
  readonly tsx: string;
  readonly json: string;
  readonly css: string | null;
  readonly controls: string | null;
};

export type BlockDraft = {
  readonly id: BlockId;
  readonly slot: SlotId;
  readonly variant: VariantKey;
  readonly hash: ContentHash;
  readonly files: BlockFiles;
  readonly title: string;
  readonly props: PropsSchema;
  readonly controls: ControlsSpec;
};

export type WorkingCopyDraft = { readonly manifest: WorkingCopyManifest; readonly blocks: readonly BlockDraft[] };

export type StoredBlock = { readonly id: BlockId; readonly files: BlockFiles };

export type IterationContents = {
  readonly n: IterationN;
  readonly slots: readonly SlotManifest[];
  readonly blocks: readonly StoredBlock[];
};

const ISSUE_SEVERITY = {
  invalid_json: "error",
  invalid_manifest: "error",
  invalid_id: "error",
  unlisted_slot: "error",
  empty_slot: "error",
  missing_file: "error",
  unexpected_file: "error",
  invalid_block: "error",
  invalid_prop: "error",
  invalid_controls: "error",
  bad_binding: "error",
  compile_error: "error",
  disallowed_import: "error",
  no_default_export: "error",
  render_error: "error",
  browser_global: "error",
  render_timeout: "error",
  uncontrolled_prop: "warning",
  duplicate_part: "warning",
  override_dropped: "warning",
  pin_lost: "warning",
  out_of_scope: "warning",
  not_addressed: "warning",
  vary_mismatch: "warning",
} as const satisfies Record<string, "error" | "warning">;

export type IssueCode = keyof typeof ISSUE_SEVERITY;
export type Severity = "error" | "warning";

export type Issue = {
  readonly severity: Severity;
  readonly code: IssueCode;
  readonly file: string | null;
  /** 1-based, for source files. */
  readonly loc: { readonly line: number; readonly column: number } | null;
  /** RFC 6901 pointer into a JSON file. */
  readonly pointer: string | null;
  readonly message: string;
};

export function issue(
  code: IssueCode,
  message: string,
  where: { file?: string | null; loc?: Issue["loc"]; pointer?: string | null } = {},
): Issue {
  return {
    severity: ISSUE_SEVERITY[code],
    code,
    file: where.file ?? null,
    loc: where.loc ?? null,
    pointer: where.pointer ?? null,
    message,
  };
}

export const isError = (i: Issue): boolean => i.severity === "error";

/** `issues` on failure holds every error and warning found. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: readonly Issue[] }
  | { readonly ok: false; readonly issues: readonly Issue[] };

export type Failure =
  | { readonly code: "usage"; readonly message: string }
  | { readonly code: "unavailable"; readonly message: string }
  | { readonly code: "unauthorized"; readonly message: string }
  | {
      readonly code: "not_found";
      readonly message: string;
      readonly entity: "session" | "thread" | "iteration" | "block" | "feedback" | "request";
    }
  | { readonly code: "validation_failed"; readonly message: string; readonly issues: readonly Issue[] }
  | {
      readonly code: "stale_working_copy";
      readonly message: string;
      readonly base: IterationN | null;
      readonly latest: IterationN;
    }
  | { readonly code: "session_mismatch"; readonly message: string; readonly expected: SessionId; readonly found: SessionId }
  | { readonly code: "thread_not_attached"; readonly message: string; readonly owner: ThreadId }
  | {
      readonly code: "wrong_project";
      readonly message: string;
      readonly sessionProject: ProjectId;
      readonly threadProject: ProjectId;
    }
  | {
      readonly code: "ambiguous_title";
      readonly message: string;
      readonly candidates: readonly { readonly id: SessionId; readonly title: string }[];
    }
  | { readonly code: "thread_missing"; readonly message: string; readonly thread: ThreadId }
  | { readonly code: "request_open"; readonly message: string; readonly n: RequestN }
  | { readonly code: "thread_lost"; readonly message: string; readonly thread: ThreadId }
  | { readonly code: "invalid_action"; readonly message: string }
  | { readonly code: "internal"; readonly message: string };

export type FailureCode = Failure["code"];

export type Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: Failure };

/** `part: null` pins the whole block. */
export type Pin = { readonly blockId: BlockId; readonly part: PartName | null };

export type FeedbackEvent =
  | { readonly kind: "address"; readonly iteration: IterationN; readonly at: string }
  | { readonly kind: "confirm"; readonly at: string }
  | { readonly kind: "reopen"; readonly at: string };

export type FeedbackEventKind = FeedbackEvent["kind"];

export type FeedbackStatus =
  | { readonly state: "open"; readonly previouslyAddressedIn: IterationN | null }
  | { readonly state: "addressed"; readonly in: IterationN }
  | { readonly state: "confirmed"; readonly addressedIn: IterationN; readonly at: string };

export type FeedbackAction = "confirm" | "reopen" | "edit" | "delete";

export type Feedback = {
  readonly id: FeedbackId;
  readonly pin: Pin;
  readonly text: string;
  readonly createdIn: IterationN;
  readonly createdAt: string;
  readonly history: readonly FeedbackEvent[];
  readonly status: FeedbackStatus;
};

/** One variant a vary request asks for. The server names them when Rob sends, so the commit can hold the agent to them. */
export type VaryVariant = { readonly key: VariantKey; readonly title: string };

/**
 * New variants of `target`'s slot that differ from `target.blockId` only at `target.part` (the whole block when the
 * part is null). It reuses the pin's shape, because Rob picks the element the same way.
 */
export type VaryScope = { readonly kind: "vary"; readonly target: Pin; readonly variants: NonEmpty<VaryVariant> };

/** A vary request's `freetext` is Rob's optional direction. */
export type RequestBody =
  | {
      readonly scope: { readonly kind: "all" } | { readonly kind: "blocks"; readonly blocks: NonEmpty<BlockId> } | VaryScope;
      readonly freetext: string | null;
    }
  | { readonly scope: { readonly kind: "described" }; readonly freetext: string };

export type RequestScope = RequestBody["scope"];

export type RequestState =
  | { readonly state: "sending" }
  | { readonly state: "sent" }
  | { readonly state: "send_failed"; readonly error: string }
  | { readonly state: "fulfilled"; readonly iteration: IterationN }
  | { readonly state: "withdrawn" };

export type Request = RequestBody & {
  readonly session: SessionId;
  readonly n: RequestN;
  readonly feedbackIds: readonly FeedbackId[];
  readonly base: IterationN | null;
  readonly threadId: ThreadId;
  readonly state: RequestState;
  readonly sentAt: string | null;
  readonly createdAt: string;
};

export type Attachment = {
  readonly session: SessionId;
  readonly threadId: ThreadId;
  readonly attachedAt: string;
  readonly lostAt: string | null;
};

export type ThreadStatus = "running" | "completed" | "failed" | "unknown";

export type ThreadInfo = {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly link: string;
  readonly status: ThreadStatus;
  readonly activeRunId: RunId | null;
  readonly latestRunId: RunId | null;
  readonly pendingRequestCount: number;
};

export type ThreadMessage = {
  readonly role: "user" | "assistant" | "other";
  readonly runId: RunId | null;
  readonly text: string;
};

export type ThreadSnapshot = { readonly thread: ThreadInfo; readonly messages: readonly ThreadMessage[] };

export type SnapshotResult =
  | { readonly kind: "found"; readonly snapshot: ThreadSnapshot }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly error: string };

export type SendResult = { readonly kind: "sent" } | { readonly kind: "failed"; readonly error: string };

export type StartResult = { readonly kind: "started"; readonly thread: ThreadId } | { readonly kind: "failed"; readonly error: string };

/** A project's threads, newest first. */
export type ListResult =
  | { readonly kind: "found"; readonly threads: readonly { readonly threadId: ThreadId; readonly createdAt: string }[] }
  | { readonly kind: "failed"; readonly error: string };

export interface AgentBridge {
  send(thread: ThreadId, message: string): Promise<SendResult>;
  snapshot(thread: ThreadId, options: { readonly messages: number }): Promise<SnapshotResult>;
  /** Starts a thread in `project` with `message` as its first turn. */
  start(input: { readonly project: ProjectId; readonly title: string; readonly message: string }): Promise<StartResult>;
  list(project: ProjectId): Promise<ListResult>;
}

/**
 * A fork is attached to this stand-in until T3 gives it a thread. It can't match THREAD_ID_PATTERN, so no thread can
 * own the fork by accident, and the bridge refuses it before running anything.
 */
export const pendingThreadOf = (session: SessionId): ThreadId => `pending:${session}` as ThreadId;
export const isPendingThread = (thread: ThreadId): boolean => thread.startsWith("pending:");

export type Observation =
  | { readonly kind: "not_seen" }
  | { readonly kind: "queued" }
  | { readonly kind: "running"; readonly pendingRequestCount: number }
  | { readonly kind: "ended"; readonly failed: boolean };

export type RequestPhaseAction = "retry" | "resend" | "withdraw" | "open_thread" | "copy_phrase" | "discard";

export type RequestPhase = { readonly actions: readonly RequestPhaseAction[] } & (
  | { readonly phase: "sending" }
  | { readonly phase: "send_failed"; readonly error: string }
  /** A fork's first request while T3 starts its thread, and once that failed. */
  | { readonly phase: "starting" }
  | { readonly phase: "start_failed"; readonly error: string }
  | { readonly phase: "previous_thread" }
  | { readonly phase: "thread_lost" }
  | { readonly phase: "queued" }
  | { readonly phase: "asking" }
  | { readonly phase: "working" }
  | { readonly phase: "run_failed" }
  | { readonly phase: "no_change" }
  | { readonly phase: "fulfilled"; readonly iteration: IterationN }
  | { readonly phase: "withdrawn" }
);

export type RobAction =
  | { readonly kind: "set_override"; readonly blockId: BlockId; readonly prop: PropName; readonly value: AppearanceValue }
  | { readonly kind: "clear_override"; readonly blockId: BlockId; readonly prop: PropName }
  | { readonly kind: "dismiss_inapplicable"; readonly blockId: BlockId; readonly prop: PropName }
  | { readonly kind: "select_variant"; readonly slot: SlotId; readonly variant: VariantKey }
  | { readonly kind: "add_feedback"; readonly pin: Pin; readonly text: string }
  | { readonly kind: "edit_feedback"; readonly id: FeedbackId; readonly text: string }
  | { readonly kind: "delete_feedback"; readonly id: FeedbackId }
  | { readonly kind: "confirm_feedback"; readonly id: FeedbackId }
  | { readonly kind: "reopen_feedback"; readonly id: FeedbackId }
  | ({ readonly kind: "regenerate" } & RequestBody)
  /** The server names the `count` new variants, then sends a vary request. */
  | { readonly kind: "vary"; readonly target: Pin; readonly count: number; readonly direction: string | null }
  /** New variants that have now been on Rob's canvas. */
  | { readonly kind: "mark_seen"; readonly blocks: NonEmpty<BlockId> }
  | { readonly kind: "retry_request" }
  | { readonly kind: "withdraw_request" }
  | { readonly kind: "check_thread" };

/** `file` is the name inside the exports folder. */
export type ExportResult = { readonly path: string; readonly file: string };

export type SessionSummary = {
  readonly id: SessionId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly brief: string;
  readonly createdAt: string;
};

export type SessionListing = SessionSummary & {
  /** The project's repo folder name. T3 lists no projects, so this is the only readable label. */
  readonly projectName: string | null;
  readonly attachedThread: ThreadId;
  readonly lost: boolean;
  readonly latest: IterationN | null;
  /** The newest of its creation, latest iteration and latest request. */
  readonly activeAt: string;
  /** The open Regenerate request's phase, or null when none is open. */
  readonly request: OpenPhase | null;
  readonly settlement: Settlement;
  /** Set on a fork. Home lists forks flat, each naming its parent. */
  readonly fork: { readonly parentTitle: string; readonly from: IterationN } | null;
};

/**
 * Whether Rob has put a brainstorm away, as T3 Code settles a thread (ADR 004). Settling while a request is open waits
 * for it to close, as T3 settles a thread at turn end, so a request that ends needing Rob keeps it in view. `at` is when
 * he settled it. `unsettledAt` is when he last brought it back, which lists it as freshly active without changing how
 * long ago it last moved.
 */
export type Settlement =
  | { readonly state: "active"; readonly unsettledAt: string | null }
  | { readonly state: "settling" | "settled"; readonly at: string };

/** The phases of a request that is still open. A fulfilled or withdrawn request has closed. */
export type OpenPhase = Exclude<RequestPhase["phase"], "fulfilled" | "withdrawn">;

export type NewSessionResult = { readonly session: SessionSummary; readonly attachment: Attachment };

/** `previous` is the thread that owned the session before, or null when the caller already owned it. */
export type AttachResult = {
  readonly session: SessionSummary;
  readonly attachment: Attachment;
  readonly previous: ThreadId | null;
};

/** `created: false` is an idempotent replay: nothing changed, and `iteration` is the latest one. */
export type CommitResult = { readonly iteration: IterationSummary; readonly created: boolean; readonly warnings: readonly Issue[] };

export type PullResult = { readonly files: FileMap; readonly iteration: IterationN | null };

export type ValidateResult = {
  readonly changed: readonly BlockId[];
  readonly removed: readonly BlockId[];
  readonly wouldCreate: boolean;
  readonly warnings: readonly Issue[];
};

export type IterationSummary = {
  readonly n: IterationN;
  readonly threadId: ThreadId;
  readonly note: string | null;
  readonly createdAt: string;
  readonly slots: readonly SlotManifest[];
  readonly blocks: readonly BlockId[];
  /** Blocks whose hash differs from the previous iteration's, including new ones. */
  readonly changed: readonly BlockId[];
};

export type RequestContext = RequestBody & {
  readonly n: RequestN;
  readonly base: IterationN | null;
  readonly feedback: readonly Feedback[];
  readonly overrides: readonly Override[];
};

/** What an agent needs to know about a fork: where it came from, and which of its defaults are Rob's settings. */
export type ForkContext = {
  readonly parent: { readonly id: SessionId; readonly title: string };
  readonly from: IterationN;
  readonly baked: readonly BakedSetting[];
};

export type BakedSetting = { readonly blockId: BlockId; readonly prop: PropName; readonly value: AppearanceValue };

export type AgentContext = {
  readonly session: { readonly id: SessionId; readonly title: string; readonly brief: string };
  readonly fork: ForkContext | null;
  readonly latest: IterationSummary | null;
  readonly attached: boolean;
  readonly attachedThread: ThreadId;
  readonly request: RequestContext | null;
  readonly feedback: { readonly open: readonly Feedback[]; readonly addressed: readonly Feedback[] };
  readonly controlVocabulary: string;
  readonly next: readonly string[];
};

export type BlockView = {
  readonly id: BlockId;
  readonly slot: SlotId;
  readonly variant: VariantKey;
  readonly title: string;
  readonly hash: ContentHash;
  readonly compiled: string;
  readonly css: string | null;
  readonly props: PropsSchema;
  readonly controls: ControlsSpec;
  readonly parts: readonly PartName[];
  readonly effectiveProps: Props;
  /** Added after the first iteration and not yet on Rob's canvas. Always false in a past iteration. */
  readonly isNew: boolean;
};

export type SlotView = {
  readonly id: SlotId;
  readonly title: string;
  readonly frame: FrameSize;
  readonly variants: NonEmpty<VariantKey>;
  readonly active: VariantKey;
};

export type IterationView = Omit<IterationSummary, "slots" | "blocks"> & {
  readonly slots: readonly SlotView[];
  readonly blocks: readonly BlockView[];
};

export type Regenerate = { readonly ok: true } | { readonly ok: false; readonly reason: "no_iteration" | "request_open" | "thread_lost" };

/** What produced an iteration, for the filmstrip: the brief, a fork, one of Rob's requests, or the agent unasked. */
export type IterationOrigin =
  | { readonly kind: "brief" }
  | { readonly kind: "fork"; readonly parent: string; readonly from: IterationN }
  | { readonly kind: "request"; readonly n: RequestN; readonly body: RequestBody }
  | { readonly kind: "agent"; readonly note: string | null };

export type HistoryEntry = { readonly n: IterationN; readonly createdAt: string; readonly origin: IterationOrigin };

/** A fork made from this brainstorm, drawn as an offshoot of the still it came from. */
export type ForkBranch = { readonly id: SessionId; readonly title: string; readonly from: IterationN };

/** A fork's parent, as its strip's first stub names it. A gone parent can't be opened. */
export type ForkLink = {
  readonly parent: { readonly id: SessionId; readonly title: string; readonly state: "active" | "settled" | "gone" };
  readonly from: IterationN;
};

export type SessionView = {
  readonly session: SessionSummary;
  readonly fork: ForkLink | null;
  /** The fork's ancestors, root first, for the breadcrumb. Empty for a brainstorm that isn't a fork. */
  readonly lineage: readonly { readonly id: SessionId; readonly title: string; readonly gone: boolean }[];
  readonly history: { readonly iterations: readonly HistoryEntry[]; readonly forks: readonly ForkBranch[] };
  readonly attachment: Attachment;
  readonly thread: ThreadInfo | null;
  readonly iteration: IterationView | null;
  readonly overrides: { readonly applicable: readonly Override[]; readonly inapplicable: readonly InapplicableOverride[] };
  readonly feedback: readonly Feedback[];
  readonly request: { readonly request: Request; readonly phase: RequestPhase; readonly message: string } | null;
  readonly regenerate: Regenerate;
};

export type CanvasModule = {
  readonly blockId: BlockId;
  readonly hash: ContentHash;
  readonly compiled: string;
  readonly css: string | null;
};

export type CanvasFrame = {
  readonly slot: SlotId;
  readonly title: string;
  readonly frame: FrameSize;
  readonly blockId: BlockId;
};

export function framesOf(slots: readonly SlotView[]): CanvasFrame[] {
  return slots.map((s) => ({ slot: s.id, title: s.title, frame: s.frame, blockId: blockIdOf(s.id, s.active) }));
}

export type CanvasMode = "view" | "pin";

export type CanvasPin = { readonly id: FeedbackId; readonly pin: Pin; readonly status: FeedbackStatus["state"] };

export type HostToFrame =
  | { readonly kind: "modules"; readonly modules: readonly CanvasModule[] }
  | {
      readonly kind: "state";
      readonly frames: readonly CanvasFrame[];
      /** Keyed by BlockId. */
      readonly props: Readonly<Record<string, Props>>;
      /** The block whose controls are open, outlined in the canvas. */
      readonly selected: BlockId | null;
      /** The slot the stage shows on its own, or null for the board, every slot side by side. Export is always the board. */
      readonly stage: SlotId | null;
    }
  | { readonly kind: "mode"; readonly mode: CanvasMode }
  /** `focused` is the comment open in the Inspector, ringed on the canvas; `hovered` is the one under the pointer there. */
  | { readonly kind: "pins"; readonly pins: readonly CanvasPin[]; readonly focused: FeedbackId | null; readonly hovered: FeedbackId | null }
  /** Scrolls a pin into view and pulses it. */
  | { readonly kind: "pulse"; readonly id: FeedbackId }
  /** Export only: every variant of each slot, for the in-page switcher. Keyed by SlotId. */
  | { readonly kind: "variants"; readonly slots: Readonly<Record<string, readonly CanvasVariant[]>> };

export type CanvasVariant = { readonly blockId: BlockId; readonly title: string };

export type FrameToHost =
  | { readonly kind: "ready" }
  /**
   * `at` is where Rob clicked and `rect` the element he picked, both in the frame's viewport coordinates, so the host
   * can place the composer beside the element instead of over it.
   */
  | { readonly kind: "picked"; readonly pin: Pin; readonly at: { readonly x: number; readonly y: number }; readonly rect: CanvasRect }
  | { readonly kind: "pin_clicked"; readonly id: FeedbackId }
  | { readonly kind: "select_block"; readonly blockId: BlockId }
  | { readonly kind: "pin_placement"; readonly placed: readonly FeedbackId[]; readonly detached: readonly FeedbackId[] }
  | { readonly kind: "block_error"; readonly blockId: BlockId; readonly message: string }
  | { readonly kind: "csp_violation"; readonly directive: string; readonly blockedUri: string }
  /** Every slot the fit rules zoomed below 1, keyed by slot, sent whenever that changes. */
  | { readonly kind: "zooms"; readonly zooms: Readonly<Record<string, number>> }
  /** How many board frames sit wholly below the visible canvas, sent whenever that changes. */
  | { readonly kind: "below"; readonly count: number }
  /** A shortcut pressed while the canvas has focus, so the shell's keys work wherever Rob last clicked. */
  | { readonly kind: "key"; readonly key: string; readonly ctrl: boolean; readonly meta: boolean; readonly shift: boolean; readonly alt: boolean }
  /** A preview frame has painted its block: a still of it as a PNG data URL, or null when it couldn't take one. */
  | { readonly kind: "painted"; readonly image: string | null };

/**
 * What a home card previews: the latest iteration's first slot, showing the variant Rob has selected, with his
 * settings applied. Null before the first iteration.
 */
export type SessionPreview = { readonly frame: CanvasFrame; readonly module: CanvasModule; readonly props: Props };

/** A fork's source: an iteration of the parent, and the variant Rob picked per slot there. A slot left out keeps the one it shows. */
export type ForkInput = {
  readonly from: IterationN;
  readonly picks: Readonly<Record<string, VariantKey>>;
  readonly instruction: string;
};

export type CanvasRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
