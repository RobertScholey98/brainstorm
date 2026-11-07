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
 * does. Live phases pulse, since they change on their own.
 */
export const PHASE: Record<RequestPhase["phase"], { readonly short: string; readonly tone: Tone; readonly live?: true }> = {
  sending: { short: "Sending", tone: "muted", live: true },
  starting: { short: "Starting", tone: "muted", live: true },
  queued: { short: "Queued", tone: "muted" },
  working: { short: "Agent working", tone: "accent", live: true },
  asking: { short: "Agent asking", tone: "info" },
  no_change: { short: "No change", tone: "info" },
  previous_thread: { short: "Sent to the previous thread", tone: "warning" },
  thread_lost: { short: "Thread lost", tone: "warning" },
  send_failed: { short: "Send failed", tone: "danger" },
  start_failed: { short: "Start failed", tone: "danger" },
  run_failed: { short: "Run failed", tone: "danger" },
  fulfilled: { short: "Fulfilled", tone: "success" },
  withdrawn: { short: "Withdrawn", tone: "muted" },
};

/** A lost thread outranks any request, since nobody can answer it. */
export const sessionPhase = (s: SessionListing): OpenPhase | null => (s.lost ? "thread_lost" : s.request);

/** Whether the brainstorm has stopped for Rob: a lost thread, or a request in a status hue. */
export function needsAttention(s: SessionListing): boolean {
  const phase = sessionPhase(s);
  return phase !== null && ATTENTION.has(PHASE[phase].tone);
}

/**
 * The tone a phase takes beside the header. The header and the request strip carry a status hue, so a second surface
 * names the phase in muted text rather than repeat the alarm, as the lost thread does (R5-66). The agent's own activity
 * keeps the accent wherever it shows.
 */
export const echoTone = (phase: RequestPhase["phase"]): Tone => (ATTENTION.has(PHASE[phase].tone) ? "muted" : PHASE[phase].tone);
