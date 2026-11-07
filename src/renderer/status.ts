import type { OpenPhase, RequestPhase, SessionListing } from "../core/types";

export type Tone = "accent" | "info" | "warning" | "danger" | "success" | "muted";

/** A tone that stops the brainstorm for Rob, which is what home's Attention filter finds. */
const ATTENTION: ReadonlySet<Tone> = new Set(["info", "warning", "danger"]);

export const TONE_TEXT: Record<Tone, string> = {
  accent: "text-accent",
  info: "text-info",
  warning: "text-warning",
  danger: "text-danger",
  success: "text-success",
  muted: "text-fg-muted",
};

export const TONE_DOT: Record<Tone, string> = {
  accent: "bg-accent",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
  muted: "bg-fg-muted",
};

/**
 * Every request phase, the one table the header, the request strip, the brainstorm panel's Thread row and home all
 * read. `short` is the phase's name where room is tight: a list row, the Thread row, a header that has given up its
 * long status. The accent is the agent at work, so only the phase where it is running takes it: sending, starting and
 * queued are Brainstorm and T3 at work, with no agent running yet, so they spin and pulse muted, as Export's spinner
 * does. Live phases pulse, since they change on their own. An ended phase has stopped, so nothing counts how long it
 * has run: "Run failed 33s" would read as a 33 s run.
 */
export const PHASE: Record<RequestPhase["phase"], { readonly short: string; readonly tone: Tone; readonly live?: true; readonly ended?: true }> = {
  sending: { short: "Sending", tone: "muted", live: true },
  starting: { short: "Starting", tone: "muted", live: true },
  queued: { short: "Queued", tone: "muted" },
  working: { short: "Agent working", tone: "accent", live: true },
  asking: { short: "Agent asking", tone: "info" },
  no_change: { short: "No change", tone: "info", ended: true },
  previous_thread: { short: "Previous thread", tone: "warning" },
  thread_lost: { short: "Thread lost", tone: "warning", ended: true },
  send_failed: { short: "Send failed", tone: "danger", ended: true },
  start_failed: { short: "Start failed", tone: "danger", ended: true },
  run_failed: { short: "Run failed", tone: "danger", ended: true },
  fulfilled: { short: "Fulfilled", tone: "success", ended: true },
  withdrawn: { short: "Withdrawn", tone: "muted", ended: true },
};

/** A lost thread outranks any request, since nobody can answer it. */
export const sessionPhase = (s: SessionListing): OpenPhase | null => (s.lost ? "thread_lost" : s.request);

/** Whether the brainstorm has stopped for Rob: a lost thread, or a request in a status hue. */
export function needsAttention(s: SessionListing): boolean {
  const phase = sessionPhase(s);
  return phase !== null && ATTENTION.has(PHASE[phase].tone);
}

/**
 * The tone a phase's mark takes beside the header. A phase that alarms or has ended has a strip under the bar in its
 * hue, so a second surface marks it muted rather than repeat the alarm, as the lost thread does (R5-66). A running
 * phase keeps its hue, so the agent at work and the agent asking Rob never share the grey of a queue.
 */
export const echoTone = (phase: RequestPhase["phase"]): Tone => {
  const { tone, ended } = PHASE[phase];
  return ended === true || tone === "danger" || tone === "warning" ? "muted" : tone;
};

/** Which tone wins when one mark speaks for several brainstorms: what stops Rob first, then the agent at work. */
const LOUDNESS: Record<Tone, number> = { danger: 0, warning: 1, info: 2, accent: 3, success: 4, muted: 5 };

/** The phase a folded group's head shows for its brainstorms, the one that most needs Rob, or null when none is open. */
export function loudestPhase(sessions: readonly SessionListing[]): OpenPhase | null {
  return sessions.reduce<OpenPhase | null>((loudest, s) => {
    const phase = sessionPhase(s);
    return phase !== null && (loudest === null || LOUDNESS[PHASE[phase].tone] < LOUDNESS[PHASE[loudest].tone]) ? phase : loudest;
  }, null);
}
