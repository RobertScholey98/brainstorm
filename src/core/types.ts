import type { SystemManifest, ThemeAxis, Tier, Token } from "./system/model";

export type { ArgType, CatalogEntry, PropInfo, StoryInfo, SystemManifest, ThemeAxis, Tier, Token } from "./system/model";

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type NonEmpty<T> = readonly [T, ...T[]];

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type SessionId = Brand<string, "SessionId">;
export type SystemId = Brand<string, "SystemId">;
export type SystemVersionN = Brand<number, "SystemVersionN">;
/** A proposed component's name, PascalCase, which blocks import as `proposed/<name>`. */
export type ProposedName = Brand<string, "ProposedName">;
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
export type GraftId = Brand<number, "GraftId">;
export type ContentHash = Brand<string, "ContentHash">;

export const SESSION_ID_PATTERN = /^s_[0-9a-z]{6,16}$/;
export const SYSTEM_ID_PATTERN = /^ds_[0-9a-z]{6,16}$/;
export const PROPOSED_NAME_PATTERN = /^[A-Z][A-Za-z0-9]{0,47}$/;
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
export const parseSystemId = matching<SystemId>(SYSTEM_ID_PATTERN);
export const parseProposedName = matching<ProposedName>(PROPOSED_NAME_PATTERN);
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
export const parseGraftId = positiveInt<GraftId>();

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

/** A proposed component's stored files: `component.tsx`, `component.json` and the optional `component.css`. */
export type ProposedFiles = { readonly tsx: string; readonly json: string; readonly css: string | null };

/**
 * A component a design needs that its design system lacks (ADR 007). It may write HTML, unlike a block, but only with
 * the kit's classes and the values the kit uses. `example` is the props its story renders it with.
 */
export type ProposedDraft = {
  readonly name: ProposedName;
  readonly hash: ContentHash;
  readonly files: ProposedFiles;
  readonly title: string;
  readonly description: string;
  readonly example: Readonly<Record<string, Json>>;
  /** Null for one committed before tiers (ADR 008); it counts as a primitive. */
  readonly tier: Tier | null;
};

export type WorkingCopyDraft = {
  readonly manifest: WorkingCopyManifest;
  readonly blocks: readonly BlockDraft[];
  readonly proposed: readonly ProposedDraft[];
};

export type StoredProposed = { readonly name: ProposedName; readonly files: ProposedFiles };

export type StoredBlock = { readonly id: BlockId; readonly files: BlockFiles };

export type IterationContents = {
  readonly proposed: readonly StoredProposed[];
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
  confirm_mismatch: "warning",
  // Design systems (ADR 007): syncing one, and holding a design in a session with one to it.
  system_source: "error",
  system_bundle_failed: "error",
  system_css_failed: "error",
  kit_load_failed: "error",
  no_story: "warning",
  story_failed: "warning",
  theme_ignored: "warning",
  off_scale: "warning",
  remote_url: "warning",
  frame_missing: "warning",
  raw_element: "error",
  style_prop: "error",
  css_in_system: "error",
  unknown_component: "error",
  unknown_proposed: "error",
  invalid_proposed: "error",
  unknown_class: "error",
  off_scale_value: "error",
  untokened_value: "error",
  dynamic_class: "warning",
  unused_proposed: "warning",
  proposed_in_kit: "warning",
  // Systems from app projects (ADR 008).
  no_system: "error",
  invalid_adapter: "error",
  empty_glob: "warning",
  duplicate_export: "warning",
  outside_boundary: "warning",
  story_empty: "warning",
  no_tokens: "warning",
  missing_tier: "error",
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
      readonly entity: "session" | "thread" | "iteration" | "block" | "feedback" | "request" | "system" | "theme" | "proposed";
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

/**
 * An element Rob is bringing into a slot's Main (ADR 009): a vary option's varied part, or anything he picked from any
 * variant. `part: null` brings the whole block. `instruction` is his optional word on where it goes.
 */
export type Graft = { readonly from: Pin; readonly into: SlotId; readonly instruction: string | null };

export type StoredGraft = Graft & { readonly id: GraftId };

/**
 * Rob's marks on an iteration (ADR 009): each slot's chosen Main, the grafts going into them, and the variants he
 * trashed. None of them runs the agent; Confirm locks them in.
 */
export type Marks = {
  readonly mains: Readonly<Partial<Record<SlotId, VariantKey>>>;
  readonly grafts: readonly StoredGraft[];
  readonly trashed: readonly BlockId[];
};

export const NO_MARKS: Marks = { mains: {}, grafts: [], trashed: [] };

/**
 * What a confirm locks in: each slot's Main, the grafts the agent applies to them, and every variant that goes. With no
 * grafts the app writes the narrowed iteration itself.
 */
export type ConfirmScope = {
  readonly kind: "confirm";
  readonly mains: readonly { readonly slot: SlotId; readonly variant: VariantKey }[];
  readonly grafts: readonly Graft[];
  readonly drop: readonly BlockId[];
};

/** A vary request's `freetext` is Rob's optional direction; a confirm's is what a new branch should try. */
export type RequestBody =
  | {
      readonly scope: { readonly kind: "all" } | { readonly kind: "blocks"; readonly blocks: NonEmpty<BlockId> } | VaryScope | ConfirmScope;
      readonly freetext: string | null;
    }
  /** An add-slot request's freetext is Rob's prompt for the new slot. */
  | { readonly scope: { readonly kind: "described" } | { readonly kind: "add_slot" }; readonly freetext: string };

export type RequestScope = RequestBody["scope"];

export type RequestState =
  | { readonly state: "sending" }
  | { readonly state: "sent" }
  | { readonly state: "send_failed"; readonly error: string }
  | { readonly state: "fulfilled"; readonly iteration: IterationN }
  | { readonly state: "withdrawn" };

/** A request is open from when it is saved until it is fulfilled or withdrawn. A branch has at most one open at a time. */
export const OPEN_REQUEST_STATES = ["sending", "sent", "send_failed"] as const satisfies readonly RequestState["state"][];

export type OpenRequestState = (typeof OPEN_REQUEST_STATES)[number];

export function isOpenRequest(state: RequestState["state"]): state is OpenRequestState {
  return (OPEN_REQUEST_STATES as readonly string[]).includes(state);
}

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

export interface AgentBridge {
  send(thread: ThreadId, message: string): Promise<SendResult>;
  snapshot(thread: ThreadId, options: { readonly messages: number }): Promise<SnapshotResult>;
  /** Starts a thread in `project` with `message` as its first turn. */
  start(input: { readonly project: ProjectId; readonly title: string; readonly message: string }): Promise<StartResult>;
}

export type Observation =
  | { readonly kind: "not_seen" }
  | { readonly kind: "queued" }
  | { readonly kind: "running"; readonly pendingRequestCount: number }
  | { readonly kind: "ended"; readonly failed: boolean };

export type RequestPhaseAction = "retry" | "resend" | "withdraw" | "open_thread" | "fresh_thread";

export type RequestPhase = { readonly actions: readonly RequestPhaseAction[] } & (
  | { readonly phase: "sending" }
  | { readonly phase: "send_failed"; readonly error: string }
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
  // Main and confirm (ADR 009). Marks are Rob's and instant; confirm and add_slot are requests.
  /** 👍: the variant becomes its slot's Main, or a vary option's element goes into Main. Again undoes it. */
  | { readonly kind: "approve"; readonly blockId: BlockId }
  | { readonly kind: "trash"; readonly blockId: BlockId }
  | { readonly kind: "restore"; readonly blockId: BlockId }
  /** Pick: an element of any variant into a slot's Main. */
  | { readonly kind: "add_graft"; readonly from: Pin; readonly into: SlotId; readonly instruction: string | null }
  | { readonly kind: "remove_graft"; readonly id: GraftId }
  | { readonly kind: "confirm" }
  | { readonly kind: "add_slot"; readonly prompt: string }
  /** This branch becomes the brainstorm's primary. */
  | { readonly kind: "make_primary" }
  /** Starts a new T3 thread for the brainstorm and moves every branch to it. */
  | { readonly kind: "refresh_thread" }
  | { readonly kind: "retry_request" }
  | { readonly kind: "withdraw_request" }
  | { readonly kind: "check_thread" }
  // A session's theme (ADR 007). Tweaks belong to the session; Save as theme copies them to the system.
  /** `value: null` clears the axis back to the system's default. */
  | { readonly kind: "set_theme_axis"; readonly axis: string; readonly value: string | null }
  | { readonly kind: "set_theme_token"; readonly token: string; readonly value: string }
  | { readonly kind: "clear_theme_token"; readonly token: string }
  | { readonly kind: "reset_theme" }
  | { readonly kind: "apply_theme"; readonly name: string }
  | { readonly kind: "save_theme"; readonly name: string }
  | { readonly kind: "upgrade_system" }
  | { readonly kind: "promote"; readonly name: ProposedName };

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

/** What an agent needs to know about a branch: where it came from, and which of its defaults are Rob's settings. */
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
  /** Rob's marks on the latest iteration: what each slot's Main is, and what he trashed. */
  readonly marks: Marks;
  readonly controlVocabulary: string;
  /** The session's design system, or null for a freeform session. `catalog` is the text the agent reads. */
  readonly system: { readonly id: SystemId; readonly name: string; readonly n: SystemVersionN; readonly catalog: string } | null;
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
  /** The block and element a vary request copied this variant from, so a 👍 brings that element into Main. */
  readonly variedFrom: Pin | null;
};

export type SlotView = {
  readonly id: SlotId;
  readonly title: string;
  readonly frame: FrameSize;
  readonly variants: NonEmpty<VariantKey>;
  readonly active: VariantKey;
};

/** What the canvas loads for a proposed component. */
export type ProposedModule = { readonly name: ProposedName; readonly hash: ContentHash; readonly compiled: string; readonly css: string | null };

export type IterationView = Omit<IterationSummary, "slots" | "blocks"> & {
  readonly proposed: readonly (ProposedModule & { readonly title: string; readonly description: string; readonly tier: Tier | null; readonly usedBy: readonly BlockId[] })[];
  readonly slots: readonly SlotView[];
  readonly blocks: readonly BlockView[];
};

/** `branch_busy`: another branch of the brainstorm has a request open on the thread they share. */
export type Regenerate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "no_iteration" | "request_open" | "branch_busy" | "thread_lost" };

/** What produced an iteration, for the filmstrip: the brief, a branch, one of Rob's requests, or the agent unasked. */
export type IterationOrigin =
  | { readonly kind: "brief" }
  | { readonly kind: "fork"; readonly parent: string; readonly from: IterationN }
  /** `kept` titles a confirm's Mains that it narrowed or grafted into, and is empty for any other request. */
  | { readonly kind: "request"; readonly n: RequestN; readonly body: RequestBody; readonly changed: readonly string[]; readonly kept: readonly string[] }
  | { readonly kind: "agent"; readonly note: string | null };

/**
 * One iteration on a branch's trail. `session` is the branch it belongs to: a trail runs through its ancestors'
 * iterations up to each branch point, then its own.
 */
export type HistoryEntry = { readonly session: SessionId; readonly n: IterationN; readonly createdAt: string; readonly origin: IterationOrigin };

/** A branch that leaves the trail at iteration `from` of `parent`, drawn as an offshoot of that still. */
export type ForkBranch = { readonly id: SessionId; readonly title: string; readonly parent: SessionId; readonly from: IterationN };

/** Where a branch left its parent. */
export type ForkLink = { readonly parent: { readonly id: SessionId; readonly title: string }; readonly from: IterationN };

/**
 * One branch of a brainstorm. Three fields place it in its tree, each answering one question: `tree` says which
 * brainstorm it is and which branch is primary, `fork` says where this branch itself left its parent, and
 * `history.forks` says which other branches leave this branch's trail. `fork` is this branch's own link, so it never
 * appears in `history.forks`; that list holds its children, its ancestors' other children before each branch point,
 * and the rest of an ancestor's own line past the point this branch left it.
 */
export type SessionView = {
  readonly session: SessionSummary;
  /** Which brainstorm this is: its root, whose title it goes by, and its primary branch. */
  readonly tree: { readonly root: { readonly id: SessionId; readonly title: string }; readonly primary: SessionId };
  /** Where this branch left its parent, or null for the root. */
  readonly fork: ForkLink | null;
  /**
   * What the strip draws: `iterations` is this branch's trail, its ancestors' iterations up to each branch point and
   * then its own, and `forks` is every other branch that leaves an iteration on it.
   */
  readonly history: { readonly iterations: readonly HistoryEntry[]; readonly forks: readonly ForkBranch[] };
  readonly attachment: Attachment;
  readonly thread: ThreadInfo | null;
  readonly iteration: IterationView | null;
  readonly marks: Marks;
  readonly overrides: { readonly applicable: readonly Override[]; readonly inapplicable: readonly InapplicableOverride[] };
  readonly feedback: readonly Feedback[];
  readonly request: { readonly request: Request; readonly phase: RequestPhase; readonly message: string } | null;
  readonly regenerate: Regenerate;
  readonly system: SessionSystemView | null;
};

// --- Design systems (ADR 007) -----------------------------------------------------------------------------------------

export type SystemSourceView = {
  readonly root: string;
  /** Null when Brainstorm generates the entry from the adapter's tier globs (ADR 008). */
  readonly entry: string | null;
  readonly css: string | null;
  readonly stories: readonly string[];
  readonly frame: string | null;
  readonly stubs: Readonly<Record<string, string>>;
  /** The project's `.brainstorm/system.json`, or null for a package folder. */
  readonly adapter: string | null;
  readonly tiers: Readonly<Record<Tier, readonly string[]>>;
};

export type SystemVersionSummary = {
  readonly n: SystemVersionN;
  readonly hash: string;
  readonly syncedAt: string;
  readonly components: number;
  readonly stories: number;
  readonly failedStories: number;
  readonly warnings: readonly Issue[];
};

export type SystemListing = {
  readonly id: SystemId;
  readonly name: string;
  readonly root: string;
  readonly projectId: ProjectId | null;
  readonly latest: SystemVersionSummary | null;
  /** Sessions that use any version of it. */
  readonly sessions: number;
  /** Why the last sync failed, or null. Auto-sync tries again when the project changes (ADR 008). */
  readonly syncError: { readonly message: string; readonly issues: readonly Issue[]; readonly at: string } | null;
  /** The project has `.brainstorm/system.json`, so an agent can repair a failed sync. */
  readonly adapter: boolean;
  /** Rob's review of the import (ADR 008). A system added before reviews existed has none, and counts as confirmed. */
  readonly review: SystemReview | null;
};

/** A note Rob raised in a review: on one component, or on the whole system when `name` is null. */
export type ReviewIssue = { readonly id: number; readonly name: string | null; readonly note: string; readonly at: string };

/**
 * Rob's review of an imported system (ADR 008). Brainstorms can't use it while it's pending. Tier moves wait here until
 * Rob sends the review to the agent or confirms it, when Brainstorm writes them into the adapter's `tiers`.
 */
export type SystemReview = {
  readonly state: "pending" | "confirmed";
  readonly tiers: Readonly<Record<string, Tier>>;
  readonly issues: readonly ReviewIssue[];
  /** The T3 thread the import ran in, or that the review was last sent to. */
  readonly thread: { readonly id: ThreadId; readonly link: string | null } | null;
  /**
   * The last review sent to the agent: Rob's notes, the tier moves Brainstorm wrote into the adapter, and the version
   * that was newest once they were written, so a later one is the agent's.
   */
  readonly sent: {
    readonly at: string;
    readonly notes: readonly ReviewIssue[];
    readonly moved: Readonly<Record<string, Tier>>;
    readonly version: number | null;
  } | null;
  readonly confirmed: { readonly at: string; readonly n: SystemVersionN } | null;
};

export type ReviewAction =
  | { readonly kind: "tier"; readonly name: string; readonly tier: Tier }
  | { readonly kind: "issue"; readonly name: string | null; readonly note: string }
  | { readonly kind: "drop_issue"; readonly issue: number }
  | { readonly kind: "send" }
  | { readonly kind: "confirm" };

/** An agent importing a project's design system in a T3 thread (ADR 008). */
export type SystemImport = { readonly root: string; readonly projectId: ProjectId; readonly at: string } & PromotionState;

/** What `brainstorm system check` decides: every gate an agent import must pass before `system add`. */
export type SystemCheck = {
  readonly root: string;
  readonly passed: boolean;
  readonly gates: readonly { readonly gate: "builds" | "boundary" | "stories" | "theme"; readonly passed: boolean; readonly issues: readonly Issue[] }[];
  /** Warnings that don't hold the import back. */
  readonly warnings: readonly Issue[];
  readonly components: readonly { readonly name: string; readonly tier: Tier; readonly stories: number }[];
};

export type SavedTheme = {
  readonly name: string;
  readonly axes: Readonly<Record<string, string>>;
  readonly tokens: Readonly<Record<string, string>>;
  readonly createdAt: string;
};

export type SystemView = SystemListing & {
  readonly source: SystemSourceView;
  /** Each version, with the brainstorms that build with it. */
  readonly versions: readonly (Omit<SystemVersionSummary, "warnings"> & {
    readonly sessions: readonly { readonly id: SessionId; readonly title: string }[];
    /** Components it exports that the version before didn't, and ones it dropped. */
    readonly added: readonly string[];
    readonly removed: readonly string[];
    /** Components whose stories render differently from the version before, with how many did. */
    readonly changed: readonly { readonly name: string; readonly stories: number; readonly via: readonly string[] }[];
    /** Tokens whose value changed from the version before. */
    readonly tokens: readonly { readonly name: string; readonly before: string; readonly after: string }[];
    /** Components that moved to another tier since the version before. */
    readonly retiered: readonly { readonly name: string; readonly from: Tier; readonly to: Tier }[];
    /** Stories a component already in the version before gained, by story name. */
    readonly newStories: readonly { readonly name: string; readonly stories: readonly string[] }[];
  })[];
  /** The latest version's manifest, without its story sources. */
  readonly manifest: Omit<SystemManifest, "storyFiles"> | null;
  readonly themes: readonly SavedTheme[];
};

/** What a canvas frame loads to render a design system's components. */
export type KitPayload = {
  readonly hash: string;
  readonly bundle: string;
  readonly css: string;
  readonly frame: string | null;
  readonly surface: readonly { readonly property: string; readonly value: string }[];
};

/** A session's theme as the canvas applies it: attribute values on the root, and token values over the system's own. */
export type ThemeState = { readonly axes: Readonly<Record<string, string>>; readonly tokens: Readonly<Record<string, string>> };

/**
 * What an agent Brainstorm handed work to is doing in its T3 thread, as T3 shows it: waiting for its turn, working,
 * asking Rob something, finished or failed, or the thread is gone. `lastLine` is the end of the agent's latest reply.
 */
export type AgentWork = {
  readonly phase: "waiting" | "working" | "asking" | "finished" | "failed" | "missing";
  readonly lastLine: string | null;
  readonly link: string | null;
};

export type PromotionState =
  | { readonly state: "starting" }
  /** `link` opens the thread in T3; null when T3 didn't show the thread right after starting it. */
  | { readonly state: "started"; readonly thread: ThreadId; readonly link: string | null }
  | { readonly state: "failed"; readonly error: string };

export type ProposedView = {
  readonly name: ProposedName;
  readonly title: string;
  readonly description: string;
  /** What the agent said the component is: a primitive, a composite or a layout (ADR 008); null for one made before tiers. */
  readonly tier: Tier | null;
  readonly usedBy: readonly BlockId[];
  readonly promotion: (PromotionState & { readonly at: string }) | null;
  /** The newest version of the system that exports a component by this name, or null. */
  readonly inSystem: SystemVersionN | null;
  /** The session's version exports it, so blocks that import it get the kit's component, untagged. */
  readonly fromKit: boolean;
};

export type SessionSystemView = {
  readonly id: SystemId;
  readonly name: string;
  readonly n: SystemVersionN;
  /** The system's newest version, which the session can upgrade to when it's newer than `n`. */
  readonly latest: SystemVersionN;
  readonly kitHash: string;
  readonly axes: readonly ThemeAxis[];
  readonly tokens: readonly Token[];
  readonly theme: ThemeState;
  readonly themes: readonly SavedTheme[];
  readonly proposed: readonly ProposedView[];
  /** Whether a T3 project is known for the system's source, so Promote can start a thread there. */
  readonly canPromote: boolean;
  /** What the newest version changes against the session's, by exported component name; empty when they're the same. */
  readonly upgrade: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    /** Components whose stories render differently in the newest version. */
    readonly changed: readonly string[];
    /** Tokens whose value the newest version changes, the usual reason those components render differently. */
    readonly tokens: readonly { readonly name: string; readonly before: string; readonly after: string }[];
    readonly check: UpgradeCheck | null;
  };
};

/** Whether the newest version would break the session's design (ADR 008); `where` names the blocks, as `home/a`. */
export type UpgradeCheck =
  | { readonly state: "checking" }
  | { readonly state: "clean" }
  | {
      readonly state: "breaks";
      readonly errors: number;
      readonly where: readonly string[];
      /** The first few errors, each with the block or proposed component it's in. */
      readonly issues: readonly { readonly where: string; readonly message: string }[];
    };

export type ThemeExport = { readonly css: ExportResult; readonly json: ExportResult };

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
      /**
       * A preview only: the least zoom its frame takes. A frame that would fit the window only below it keeps this zoom
       * and shows its top left, cut at the window's right edge.
       */
      readonly floor?: number;
    }
  | { readonly kind: "mode"; readonly mode: CanvasMode }
  /** `focused` is the comment open in the Inspector, ringed on the canvas; `hovered` is the one under the pointer there. */
  | { readonly kind: "pins"; readonly pins: readonly CanvasPin[]; readonly focused: FeedbackId | null; readonly hovered: FeedbackId | null }
  /** Scrolls a pin into view and pulses it. */
  | { readonly kind: "pulse"; readonly id: FeedbackId }
  /** Export only: every variant of each slot, for the in-page switcher. Keyed by SlotId. */
  | { readonly kind: "variants"; readonly slots: Readonly<Record<string, readonly CanvasVariant[]>> }
  /**
   * Present: the slot on the stage fills the window with none of the canvas's own chrome (title, frame edge, selection,
   * pins), as if the design were the app itself. Pick mode still works in it (ADR 007).
   */
  | { readonly kind: "present"; readonly on: boolean }
  /** A design system's kit, sent once per version; null clears it. */
  | { readonly kind: "kit"; readonly kit: KitPayload | null }
  | { readonly kind: "theme"; readonly theme: ThemeState }
  /** Proposed components that blocks import as `proposed/<name>`. */
  | { readonly kind: "proposed"; readonly modules: readonly ProposedModule[] }
  /** The system page's gallery: the loaded kit's stories with these ids, or every story when null. */
  | {
      readonly kind: "gallery";
      readonly stories: readonly string[] | null;
      readonly focus?: GalleryFocus | null;
      /** Each story's component, by story id, so a frame is labelled as the catalog names it, not by its story title. */
      readonly components?: Readonly<Record<string, string>>;
      /** A word beside a story's label, by story id, such as "new in v3" for one the agent added during a review. */
      readonly notes?: Readonly<Record<string, string>>;
    };

/** The workbench's one story (ADR 008): Rob's args over the story's own, at a width in pixels or filling the frame. */
export type GalleryFocus = { readonly id: string; readonly args: Readonly<Record<string, Json>>; readonly width: number | null };

export type CanvasVariant = { readonly blockId: BlockId; readonly title: string };

export type FrameToHost =
  | { readonly kind: "ready" }
  /**
   * `at` is where Rob clicked and `rect` the element he picked, both in the frame's viewport coordinates, so the host
   * can place the composer beside the element instead of over it.
   */
  | { readonly kind: "picked"; readonly pin: Pin; readonly at: { readonly x: number; readonly y: number }; readonly rect: CanvasRect }
  | { readonly kind: "pin_clicked"; readonly id: FeedbackId }
  /** The pin under the pointer, or null once it leaves, so the comment it pins can echo the hover. */
  | { readonly kind: "pin_hovered"; readonly id: FeedbackId | null }
  | { readonly kind: "select_block"; readonly blockId: BlockId }
  | { readonly kind: "pin_placement"; readonly placed: readonly FeedbackId[]; readonly detached: readonly FeedbackId[] }
  | { readonly kind: "block_error"; readonly blockId: BlockId; readonly message: string }
  | { readonly kind: "csp_violation"; readonly directive: string; readonly blockedUri: string }
  /** Every slot the fit rules zoomed below 1, keyed by slot, sent whenever that changes. */
  | { readonly kind: "zooms"; readonly zooms: Readonly<Record<string, number>> }
  /** A shortcut pressed while the canvas has focus, so the shell's keys work wherever Rob last clicked. */
  | { readonly kind: "key"; readonly key: string; readonly ctrl: boolean; readonly meta: boolean; readonly shift: boolean; readonly alt: boolean }
  /** In present, the pointer moved near the frame's top edge, at most every few hundred ms, so the host can show how to leave. */
  | { readonly kind: "pointer" }
  /** A preview frame has painted its block: a still of it as a PNG data URL, or null when it couldn't take one. */
  | { readonly kind: "painted"; readonly image: string | null }
  /** Rob clicked a story's title in the system page's gallery, to open it in the workbench. */
  | { readonly kind: "open_story"; readonly id: string };

/**
 * What a home card previews: the latest iteration's first slot, showing the variant Rob has selected, with his
 * settings applied. Null before the first iteration.
 */
/** What a canvas frame needs for a session with a design system: the kit version to load, its theme and proposed components. */
export type CanvasSystem = {
  readonly id: SystemId;
  readonly n: SystemVersionN;
  readonly theme: ThemeState;
  readonly proposed: readonly ProposedModule[];
};

export type SessionPreview = {
  readonly frame: CanvasFrame;
  readonly module: CanvasModule;
  readonly props: Props;
  readonly system: CanvasSystem | null;
};

/** A branch from iteration `from`: Rob's marks on that iteration, and optionally what the branch should try. */
export type ForkInput = {
  readonly from: IterationN;
  readonly marks: Marks;
  readonly instruction: string | null;
};

export type CanvasRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
