import { partLabel } from "./fork";
import {
  blockIdOf,
  parseRequestN,
  parseSessionId,
  splitBlockId,
  type Attachment,
  type IterationN,
  type IterationOrigin,
  type BlockId,
  type Feedback,
  type FeedbackAction,
  type FeedbackEvent,
  type FeedbackEventKind,
  type FeedbackStatus,
  type Observation,
  type Regenerate,
  type Request,
  type RequestN,
  type RequestPhase,
  type RequestPhaseAction,
  type RequestScope,
  type SessionId,
  type Settlement,
  type ThreadSnapshot,
} from "./types";

const LEGAL_EVENTS: { readonly [S in FeedbackStatus["state"]]: readonly FeedbackEventKind[] } = {
  open: ["address"],
  addressed: ["address", "confirm", "reopen"],
  confirmed: ["reopen"],
};

/** What Rob may do to feedback in each status, in the order the feedback list shows them. */
export const FEEDBACK_ACTIONS: { readonly [S in FeedbackStatus["state"]]: readonly FeedbackAction[] } = {
  open: ["edit", "delete"],
  addressed: ["confirm", "reopen"],
  confirmed: ["reopen"],
};

/**
 * A settle holds until something happens to the brainstorm afterwards (`woken`): Rob asks for a regenerate, or the agent
 * commits other than to finish a request Rob made before settling. Those are what bring a T3 thread back: a new turn.
 */
export function settlementOf(state: {
  readonly settledAt: string | null;
  readonly unsettledAt: string | null;
  readonly woken: boolean;
  readonly openRequest: boolean;
}): Settlement {
  if (state.settledAt === null || state.woken) return { state: "active", unsettledAt: state.unsettledAt };
  return { state: state.openRequest ? "settling" : "settled", at: state.settledAt };
}

export function canAppend(status: FeedbackStatus, kind: FeedbackEventKind): boolean {
  return LEGAL_EVENTS[status.state].includes(kind);
}

/**
 * A vary request carries no feedback: its new variants can't address pins on the block they copy. Nor do a confirm and
 * an add-slot: they ask for one specific change, and the open pins wait for a regenerate.
 */
export function requestFeedback(feedback: readonly Feedback[], scope: RequestScope): Feedback[] {
  if (scope.kind === "vary" || scope.kind === "confirm" || scope.kind === "add_slot") return [];
  return feedback.filter((f) => f.status.state === "open" && (scope.kind !== "blocks" || scope.blocks.includes(f.pin.blockId)));
}

/** `busy` is whether another branch of the brainstorm has a request open on the thread they share. */
export function regenerateGate(state: {
  readonly hasIteration: boolean;
  readonly open: Request | null;
  readonly busy?: boolean;
  readonly attachment: Attachment;
}): Regenerate {
  if (!state.hasIteration) return { ok: false, reason: "no_iteration" };
  if (state.open !== null) return { ok: false, reason: "request_open" };
  if (state.busy === true) return { ok: false, reason: "branch_busy" };
  if (state.attachment.lostAt !== null) return { ok: false, reason: "thread_lost" };
  return { ok: true };
}

export function blockedMessage(reason: Extract<Regenerate, { ok: false }>["reason"], openRequest: RequestN | undefined): string {
  switch (reason) {
    case "no_iteration":
      return "Needs a first iteration";
    case "request_open":
      return `Request ${openRequest} is still open`;
    case "branch_busy":
      return "Another branch's request is open on this thread";
    case "thread_lost":
      return "This brainstorm's thread is gone. Start a fresh thread from the top bar.";
  }
}

const lastAddressedIn = (status: FeedbackStatus) =>
  status.state === "addressed" ? status.in : status.state === "confirmed" ? status.addressedIn : status.previouslyAddressedIn;

function apply(status: FeedbackStatus, event: FeedbackEvent): FeedbackStatus {
  if (!canAppend(status, event.kind)) return status;
  switch (event.kind) {
    case "address":
      return { state: "addressed", in: event.iteration };
    case "confirm":
      return status.state === "addressed" ? { state: "confirmed", addressedIn: status.in, at: event.at } : status;
    case "reopen":
      return { state: "open", previouslyAddressedIn: lastAddressedIn(status) };
  }
}

/** Folds the event log into a status, skipping events that were illegal when they happened. */
export function foldFeedback(events: readonly FeedbackEvent[]): FeedbackStatus {
  return events.reduce<FeedbackStatus>(apply, { state: "open", previouslyAddressedIn: null });
}

/**
 * An open request's actions follow one order: the phase's own step (Retry, Resend or Copy phrase), then Open thread
 * whenever the thread can still be reached, then Withdraw. The bar holds them right to left from Regenerate, so Open
 * thread and Withdraw keep one x across every phase that has them. While another branch's request holds the thread
 * they share (`busy`), Retry and Resend wait, since the thread works on one thing at a time.
 */
export function requestPhase(request: Request, attachment: Attachment, observation: Observation | null, busy = false): RequestPhase {
  const open = (step: readonly RequestPhaseAction[]): readonly RequestPhaseAction[] => {
    const own = busy ? step.filter((a) => a !== "retry" && a !== "resend") : step;
    return attachment.lostAt === null ? [...own, "open_thread", "withdraw"] : [...own, "withdraw"];
  };
  switch (request.state.state) {
    case "sending":
      return { phase: "sending", actions: [] };
    case "send_failed":
      return { phase: "send_failed", error: request.state.error, actions: open(["retry"]) };
    case "fulfilled":
      return { phase: "fulfilled", iteration: request.state.iteration, actions: [] };
    case "withdrawn":
      return { phase: "withdrawn", actions: [] };
    case "sent":
      break;
  }
  if (request.threadId !== attachment.threadId) return { phase: "previous_thread", actions: open(["resend"]) };
  if (attachment.lostAt !== null) return { phase: "thread_lost", actions: open(["fresh_thread"]) };
  switch (observation?.kind) {
    case undefined:
    case "not_seen":
    case "queued":
      return { phase: "queued", actions: open([]) };
    case "running":
      return observation.pendingRequestCount > 0 ? { phase: "asking", actions: open([]) } : { phase: "working", actions: open([]) };
    case "ended":
      return { phase: observation.failed ? "run_failed" : "no_change", actions: open(["retry"]) };
  }
}

/**
 * What Rob reads for a phase. `changed` names the fulfilling iteration's changed blocks by title, and `scope` is the
 * request's, so a vary reads as what it asked for. `kept` names a confirm's Mains, as the origin's does.
 */
export function phaseMessage(
  phase: RequestPhase,
  context: { title: string; changed: readonly string[]; kept?: readonly string[]; scope?: RequestScope },
): string {
  switch (phase.phase) {
    case "sending":
      return "Sending to T3";
    case "send_failed":
      // The reason in brackets, so its own colons never read as part of the sentence.
      return `Couldn't send (${phase.error}). The request is saved.`;
    case "previous_thread":
      return "Sent to the previous thread";
    case "thread_lost":
      return "This brainstorm's thread is gone. Start a fresh thread, and the open request goes to it.";
    case "queued":
      return "Queued in T3";
    case "asking":
      return "Agent asking in T3";
    case "working":
      return "Agent working";
    case "run_failed":
      return "The agent's run failed in T3";
    case "no_change":
      return "The agent replied in T3 without changing the design";
    case "fulfilled":
      return `Iteration ${phase.iteration} · ${fulfilledText(context.scope, context.changed, context.kept ?? [])}`;
    case "withdrawn":
      return "Request withdrawn";
  }
}

/**
 * Finds the request's marker among the thread's user messages. A marker whose run is neither active nor the latest
 * counts as ended only when a later message belongs to another run; otherwise it is waiting as the thread's next turn.
 */
export function observeRequest(session: SessionId, n: RequestN, snapshot: ThreadSnapshot): Observation {
  const { thread, messages } = snapshot;
  const index = messages.findLastIndex((m) => {
    if (m.role !== "user") return false;
    const marker = parseRequestMarker(m.text);
    return marker !== null && marker.session === session && marker.n === n;
  });
  const message = messages[index];
  if (message === undefined) return { kind: "not_seen" };
  const runId = message.runId;
  if (runId === null) return { kind: "queued" };
  if (runId === thread.activeRunId) return { kind: "running", pendingRequestCount: thread.pendingRequestCount };
  const isLatest = runId === thread.latestRunId;
  const laterRun = messages.slice(index + 1).some((m) => m.runId !== null && m.runId !== runId);
  if (!isLatest && !laterRun) return { kind: "queued" };
  return { kind: "ended", failed: isLatest && thread.status === "failed" };
}

const MARKER = /\[brainstorm\] session (\S+) · request (\d+)/;

type RequestMessageFields = Pick<Request, "session" | "n" | "scope" | "freetext" | "feedbackIds">;

export function scopeText(scope: RequestScope): string {
  switch (scope.kind) {
    case "blocks":
      return scope.blocks.join(", ");
    case "vary":
      return `vary ${scope.target.blockId}${scope.target.part === null ? "" : ` [${scope.target.part}]`} as ${scope.variants.map((v) => v.key).join(", ")}`;
    case "confirm": {
      const mains = scope.mains.map((m) => `${m.slot}/${m.variant}`);
      const grafts = scope.grafts.map((g) => `${g.from.blockId}${g.from.part === null ? "" : ` [${g.from.part}]`} into ${g.into}`);
      return [
        `confirm${mains.length === 0 ? "" : ` main ${mains.join(", ")}`}`,
        ...(grafts.length === 0 ? [] : [`graft ${grafts.join(", ")}`]),
        `drop ${scope.drop.length === 0 ? "none" : scope.drop.join(", ")}`,
      ].join("; ");
    }
    case "all":
    case "described":
    case "add_slot":
      return scope.kind;
  }
}

/** The filmstrip's line for an iteration: Rob's words when he gave some, otherwise what he asked for. */
export function originText(origin: IterationOrigin): string {
  switch (origin.kind) {
    case "brief":
      return "First designs, from the brief";
    case "fork":
      return `Branched from iteration ${origin.from}`;
    case "agent":
      return origin.note ?? "The agent's own commit";
    case "request": {
      const { scope, freetext } = origin.body;
      if (scope.kind === "vary") {
        const what = scope.target.part === null ? "the block" : partLabel(scope.target.part);
        return `Vary ${what} ×${scope.variants.length}${freetext === null ? "" : ` · ${freetext}`}`;
      }
      if (scope.kind === "confirm") return confirmText(scope, origin.kept);
      if (scope.kind === "add_slot") return `New slot · ${freetext}`;
      if (freetext !== null) return freetext;
      // With no words of Rob's, what it changed says more than the scope's name.
      const changed = changedNames(origin.changed);
      return changed.charAt(0).toUpperCase() + changed.slice(1);
    }
  }
}

/** What a fulfilled request did, in the top bar's words. */
function fulfilledText(scope: RequestScope | undefined, changed: readonly string[], kept: readonly string[]): string {
  if (scope?.kind === "vary") return varyLanded(scope, changed);
  if (scope?.kind === "confirm") return confirmText(scope, kept);
  return changedNames(changed);
}

/**
 * A confirm, as the strip, its dropdown and the top bar name it, leading with what it kept: "Kept Neon wheel · 3
 * options dropped, 1 element brought in". `kept` titles the Mains it narrowed or grafted into; a slot that only kept
 * its one variant isn't news.
 */
export function confirmText(scope: Extract<RequestScope, { kind: "confirm" }>, kept: readonly string[]): string {
  const parts = [
    ...(scope.drop.length === 0 ? [] : [`${scope.drop.length} ${scope.drop.length === 1 ? "option" : "options"} dropped`]),
    ...(scope.grafts.length === 0 ? [] : [`${scope.grafts.length} ${scope.grafts.length === 1 ? "element" : "elements"} brought in`]),
  ];
  const lead = kept.length === 0 ? "Confirmed" : kept.length === 1 ? `Kept ${kept[0]}` : `Kept ${kept.length} Mains`;
  return [lead, parts.join(", ")].filter((p) => p !== "").join(" · ");
}

/** The Mains a confirm changed something about: the slot dropped an option or took a graft. */
export function keptMains(scope: Extract<RequestScope, { kind: "confirm" }>): BlockId[] {
  return scope.mains
    .filter((m) => scope.grafts.some((g) => g.into === m.slot) || scope.drop.some((b) => splitBlockId(b).slot === m.slot))
    .map((m) => blockIdOf(m.slot, m.variant));
}

/** A fulfilled vary, by the new variants it asked for that landed: "3 new variants of Spin button". */
function varyLanded(scope: Extract<RequestScope, { kind: "vary" }>, changed: readonly string[]): string {
  const landed = scope.variants.filter((v) => changed.includes(v.title)).length;
  if (landed === 0) return changedNames(changed);
  const what = scope.target.part === null ? "" : ` of ${partLabel(scope.target.part)}`;
  return `${landed} new ${landed === 1 ? "variant" : "variants"}${what}`;
}

/** The fulfilled message's list, short enough for the top bar: two names, then a count. */
export function changedNames(titles: readonly string[]): string {
  if (titles.length === 0) return "no blocks changed";
  const shown = titles.slice(0, 2).join(", ");
  return titles.length > 2 ? `changed ${shown} and ${titles.length - 2} more` : `changed ${shown}`;
}

export const changedText = (changed: readonly string[]): string =>
  changed.length === 0 ? "no blocks changed" : `changed ${changed.join(", ")}`;

/**
 * `fork` makes it a branch's first request: the segment tells the agent the session is a new branch of the brainstorm
 * it already works on, in the same thread.
 */
export function formatRequestMessage(
  request: RequestMessageFields,
  options: { readonly fork?: { readonly parent: SessionId; readonly from: IterationN } } = {},
): string {
  const { fork } = options;
  const segments = [
    `[brainstorm] session ${request.session}`,
    `request ${request.n}`,
    ...(fork === undefined ? [] : [`branch of ${fork.parent} iteration ${fork.from}`]),
    `scope: ${scopeText(request.scope)}`,
    ...(request.feedbackIds.length > 0 ? [`feedback: ${request.feedbackIds.map((id) => `#${id}`).join(" ")}`] : []),
    ...(request.freetext !== null ? [`freetext: ${JSON.stringify(request.freetext)}`] : []),
  ];
  return [segments.join(" · "), `Handle with the use-brainstorm skill: run \`brainstorm context ${request.session}\`.`].join("\n");
}

/**
 * The first message of a fresh thread Rob started for a brainstorm. It is no request, so it carries no request marker.
 * `home` is named when the app runs on a home of its own, because T3 starts agents with its own environment and their
 * CLI would otherwise look for the default one.
 */
export function formatRefreshMessage(session: SessionId, title: string, home: string | null): string {
  const lines = [
    `[brainstorm] session ${session} · fresh thread for "${title}"`,
    `Handle with the use-brainstorm skill: this thread is new, so run \`brainstorm session attach ${session}\`, then \`brainstorm context ${session}\`, and reply in one line once you have read it.`,
  ];
  if (home !== null) {
    lines.push(`Brainstorm runs with BRAINSTORM_HOME=${home}. Set it on every brainstorm command: in PowerShell, start each with \`$env:BRAINSTORM_HOME = '${home}';\`; in a POSIX shell, with \`BRAINSTORM_HOME='${home}'\`.`);
  }
  return lines.join("\n");
}

export function parseRequestMarker(text: string): { session: SessionId; n: RequestN } | null {
  const match = MARKER.exec(text);
  if (match === null) return null;
  const session = parseSessionId(match[1] ?? "");
  const n = parseRequestN(Number(match[2]));
  return session !== null && n !== null ? { session, n } : null;
}
