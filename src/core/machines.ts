import { partLabel } from "./fork";
import {
  isPendingThread,
  parseRequestN,
  parseSessionId,
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

/** A vary request carries no feedback: its new variants can't address pins on the block they copy. */
export function requestFeedback(feedback: readonly Feedback[], scope: RequestScope): Feedback[] {
  if (scope.kind === "vary") return [];
  return feedback.filter((f) => f.status.state === "open" && (scope.kind !== "blocks" || scope.blocks.includes(f.pin.blockId)));
}

export function regenerateGate(state: { readonly hasIteration: boolean; readonly open: Request | null; readonly attachment: Attachment }): Regenerate {
  if (!state.hasIteration) return { ok: false, reason: "no_iteration" };
  if (state.open !== null) return { ok: false, reason: "request_open" };
  if (state.attachment.lostAt !== null) return { ok: false, reason: "thread_lost" };
  return { ok: true };
}

export function blockedMessage(reason: Extract<Regenerate, { ok: false }>["reason"], openRequest: RequestN | undefined): string {
  switch (reason) {
    case "no_iteration":
      return "Needs a first iteration";
    case "request_open":
      return `Withdraw request ${openRequest} first`;
    case "thread_lost":
      return "This session's thread is gone. Take it over from a T3 thread first.";
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
 * thread and Withdraw keep one x across every phase that has them.
 */
export function requestPhase(request: Request, attachment: Attachment, observation: Observation | null): RequestPhase {
  const open = (step: readonly RequestPhaseAction[]): readonly RequestPhaseAction[] =>
    attachment.lostAt === null ? [...step, "open_thread", "withdraw"] : [...step, "withdraw"];
  // A fork without its thread has nothing to open or withdraw to: it starts, or Rob discards it.
  if (isPendingThread(request.threadId)) {
    if (request.state.state === "sending") return { phase: "starting", actions: [] };
    if (request.state.state === "send_failed") return { phase: "start_failed", error: request.state.error, actions: ["retry", "discard"] };
  }
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
  if (attachment.lostAt !== null) return { phase: "thread_lost", actions: open(["copy_phrase"]) };
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

export function takeoverPhrase(title: string): string {
  return `pick up the brainstorm session titled "${title}"`;
}

/**
 * What Rob reads for a phase. `changed` names the fulfilling iteration's changed blocks by title, and `scope` is the
 * request's, so a vary reads as what it asked for.
 */
export function phaseMessage(phase: RequestPhase, context: { title: string; changed: readonly string[]; scope?: RequestScope }): string {
  switch (phase.phase) {
    case "sending":
      return "Sending to T3…";
    case "send_failed":
      // The reason in brackets, so its own colons never read as part of the sentence.
      return `Couldn't send (${phase.error}). The request is saved.`;
    case "starting":
      return "Starting a T3 thread…";
    case "start_failed":
      return `Couldn't start a T3 thread (${phase.error}). The fork is saved.`;
    case "previous_thread":
      return "Sent to the previous thread";
    case "thread_lost":
      return `This session's thread is gone. In a T3 thread on this project, say: ${takeoverPhrase(context.title)}`;
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
      return `Iteration ${phase.iteration} · ${context.scope?.kind === "vary" ? varyLanded(context.scope, context.changed) : changedNames(context.changed)}`;
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
    case "all":
    case "described":
      return scope.kind;
  }
}

/** The filmstrip's line for an iteration: Rob's words when he gave some, otherwise what he asked for. */
export function originText(origin: IterationOrigin): string {
  switch (origin.kind) {
    case "brief":
      return "First designs, from the brief";
    case "fork":
      // The strip's stub beside it already names the parent, so this says what is Rob's.
      return `Your picks from iteration ${origin.from}`;
    case "agent":
      return origin.note ?? "The agent's own commit";
    case "request": {
      const { scope, freetext } = origin.body;
      if (scope.kind === "vary") {
        const what = scope.target.part === null ? "the block" : partLabel(scope.target.part);
        return `Vary ${what} ×${scope.variants.length}${freetext === null ? "" : ` · ${freetext}`}`;
      }
      if (freetext !== null) return freetext;
      // With no words of Rob's, what it changed says more than the scope's name.
      const changed = changedNames(origin.changed);
      return changed.charAt(0).toUpperCase() + changed.slice(1);
    }
  }
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
 * `fork` makes it a fork's first message: the thread is new, so the agent attaches first, which is a no-op once the
 * app has adopted the thread and adopts it otherwise. `home` is named when the app runs on a home of its own, because
 * T3 starts agents with its own environment and their CLI would otherwise look for the default one.
 */
export function formatRequestMessage(
  request: RequestMessageFields,
  options: { readonly fork?: { readonly parent: SessionId; readonly from: IterationN }; readonly home?: string | null } = {},
): string {
  const { fork, home = null } = options;
  const segments = [
    `[brainstorm] session ${request.session}`,
    `request ${request.n}`,
    ...(fork === undefined ? [] : [`fork of ${fork.parent} iteration ${fork.from}`]),
    `scope: ${scopeText(request.scope)}`,
    ...(request.feedbackIds.length > 0 ? [`feedback: ${request.feedbackIds.map((id) => `#${id}`).join(" ")}`] : []),
    ...(request.freetext !== null ? [`freetext: ${JSON.stringify(request.freetext)}`] : []),
  ];
  const run =
    fork === undefined
      ? `run \`brainstorm context ${request.session}\`.`
      : `this thread is new, so run \`brainstorm session attach ${request.session}\`, then \`brainstorm context ${request.session}\`.`;
  const lines = [segments.join(" · "), `Handle with the ux-brainstorm skill: ${run}`];
  if (home !== null) {
    lines.push(`Brainstorm runs with BRAINSTORM_HOME=${home}. Set it on every brainstorm command: in PowerShell, start each with \`$env:BRAINSTORM_HOME = '${home}';\`.`);
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
