import {
  parseRequestN,
  parseSessionId,
  type Attachment,
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
  type RequestScope,
  type SessionId,
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

export function canAppend(status: FeedbackStatus, kind: FeedbackEventKind): boolean {
  return LEGAL_EVENTS[status.state].includes(kind);
}

export function requestFeedback(feedback: readonly Feedback[], scope: RequestScope): Feedback[] {
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
      return "Regenerate needs a first iteration";
    case "request_open":
      return `Request ${openRequest} is still open. Withdraw it to send another.`;
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

export function requestPhase(request: Request, attachment: Attachment, observation: Observation | null): RequestPhase {
  switch (request.state.state) {
    case "sending":
      return { phase: "sending", actions: [] };
    case "send_failed":
      return { phase: "send_failed", error: request.state.error, actions: ["retry", "withdraw"] };
    case "fulfilled":
      return { phase: "fulfilled", iteration: request.state.iteration, actions: [] };
    case "withdrawn":
      return { phase: "withdrawn", actions: [] };
    case "sent":
      break;
  }
  if (request.threadId !== attachment.threadId) return { phase: "previous_thread", actions: ["resend", "withdraw"] };
  if (attachment.lostAt !== null) return { phase: "thread_lost", actions: ["copy_phrase", "withdraw"] };
  switch (observation?.kind) {
    case undefined:
    case "not_seen":
    case "queued":
      return { phase: "queued", actions: ["open_thread", "withdraw"] };
    case "running":
      return observation.pendingRequestCount > 0
        ? { phase: "asking", actions: ["open_thread", "withdraw"] }
        : { phase: "working", actions: ["open_thread", "withdraw"] };
    case "ended":
      return observation.failed ? { phase: "run_failed", actions: ["retry", "withdraw"] } : { phase: "no_change", actions: ["retry", "withdraw"] };
  }
}

export function takeoverPhrase(title: string): string {
  return `pick up the brainstorm session titled "${title}"`;
}

/** What Rob reads for a phase. `changed` names the fulfilling iteration's changed blocks by title. */
export function phaseMessage(phase: RequestPhase, context: { title: string; changed: readonly string[] }): string {
  switch (phase.phase) {
    case "sending":
      return "Sending to T3…";
    case "send_failed":
      return `Couldn't send: ${phase.error}. The request is saved.`;
    case "previous_thread":
      return "Sent to the previous thread";
    case "thread_lost":
      return `This session's thread is gone. In a T3 thread on this project, say: ${takeoverPhrase(context.title)}`;
    case "queued":
      return "Queued in T3";
    case "asking":
      return "The agent is asking something in T3";
    case "working":
      return "The agent is working";
    case "run_failed":
      return "The agent's run failed in T3";
    case "no_change":
      return "The agent replied in T3 without changing the design";
    case "fulfilled":
      return `Iteration ${phase.iteration} · ${changedNames(context.changed)}`;
    case "withdrawn":
      return "Withdrawn";
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

export const scopeText = (scope: RequestScope): string => (scope.kind === "blocks" ? scope.blocks.join(", ") : scope.kind);

/** The fulfilled message's list, short enough for the top bar: two names, then a count. */
export function changedNames(titles: readonly string[]): string {
  if (titles.length === 0) return "no blocks changed";
  const shown = titles.slice(0, 2).join(", ");
  return titles.length > 2 ? `changed ${shown} and ${titles.length - 2} more` : `changed ${shown}`;
}

export const changedText = (changed: readonly string[]): string =>
  changed.length === 0 ? "no blocks changed" : `changed ${changed.join(", ")}`;

export function formatRequestMessage(request: RequestMessageFields): string {
  const segments = [
    `[brainstorm] session ${request.session}`,
    `request ${request.n}`,
    `scope: ${scopeText(request.scope)}`,
    ...(request.feedbackIds.length > 0 ? [`feedback: ${request.feedbackIds.map((id) => `#${id}`).join(" ")}`] : []),
    ...(request.freetext !== null ? [`freetext: ${JSON.stringify(request.freetext)}`] : []),
  ];
  return `${segments.join(" · ")}\nHandle with the ux-brainstorm skill: run \`brainstorm context ${request.session}\`.`;
}

export function parseRequestMarker(text: string): { session: SessionId; n: RequestN } | null {
  const match = MARKER.exec(text);
  if (match === null) return null;
  const session = parseSessionId(match[1] ?? "");
  const n = parseRequestN(Number(match[2]));
  return session !== null && n !== null ? { session, n } : null;
}
