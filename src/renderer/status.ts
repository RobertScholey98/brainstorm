import type { OpenPhase, SessionListing } from "../core/types";

export type Tone = "accent" | "info" | "warning" | "danger";

/**
 * What a brainstorm is waiting on, as its list row and card say it. The accent is the agent at work; a status hue is
 * something Rob has to look at, which is what home's Attention filter finds. Working and sending pulse, since they
 * change on their own.
 */
export const STATUS: Record<OpenPhase, { readonly label: string; readonly tone: Tone; readonly live?: true }> = {
  sending: { label: "Sending", tone: "accent", live: true },
  starting: { label: "Starting thread", tone: "accent", live: true },
  queued: { label: "Queued in T3", tone: "accent" },
  working: { label: "Agent working", tone: "accent", live: true },
  asking: { label: "Agent asking", tone: "info" },
  no_change: { label: "No change", tone: "info" },
  previous_thread: { label: "Previous thread", tone: "warning" },
  thread_lost: { label: "Thread lost", tone: "warning" },
  send_failed: { label: "Send failed", tone: "danger" },
  start_failed: { label: "Start failed", tone: "danger" },
  run_failed: { label: "Run failed", tone: "danger" },
};

/** A lost thread outranks any request, since nobody can answer it. */
export const sessionPhase = (s: SessionListing): OpenPhase | null => (s.lost ? "thread_lost" : s.request);

export function sessionStatus(s: SessionListing): (typeof STATUS)[OpenPhase] | null {
  const phase = sessionPhase(s);
  return phase === null ? null : STATUS[phase];
}

/** Whether the brainstorm has stopped for Rob: a lost thread, or a request in a status hue. */
export const needsAttention = (s: SessionListing): boolean => (sessionStatus(s)?.tone ?? "accent") !== "accent";
