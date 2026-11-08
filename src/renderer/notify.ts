import type { OpenPhase, SessionId, SessionListing } from "../core/types";
import { sessionPhase } from "./status";

/** A system notification for one brainstorm. */
export type Alert = { readonly session: SessionId; readonly title: string; readonly body: string };

const FAILED: ReadonlySet<OpenPhase> = new Set(["send_failed", "start_failed", "run_failed"]);

/**
 * What changed for Rob between two readings of the list, one alert per brainstorm at most: a new iteration, else the
 * agent asking in T3, a request that failed, or a lost thread. A brainstorm the first reading didn't have says nothing,
 * since Rob or his agent just made it, and a phase that was already showing says nothing again.
 */
export function alertsBetween(before: readonly SessionListing[], after: readonly SessionListing[]): Alert[] {
  const was = new Map(before.map((s) => [s.id, s]));
  return after.flatMap((s): Alert[] => {
    const prev = was.get(s.id);
    if (prev === undefined) return [];
    if (s.latest !== null && (prev.latest === null || s.latest > prev.latest)) {
      return [{ session: s.id, title: "New iteration", body: `${s.title} · Iteration ${s.latest}` }];
    }
    const phase = sessionPhase(s);
    if (phase === null || phase === sessionPhase(prev)) return [];
    if (phase === "asking") return [{ session: s.id, title: "The agent is asking something", body: `${s.title} · Answer it in its T3 thread` }];
    if (FAILED.has(phase)) return [{ session: s.id, title: "The request failed", body: `${s.title} · Open it to retry` }];
    if (phase === "thread_lost") return [{ session: s.id, title: "Thread lost", body: `${s.title} · Its T3 thread is gone` }];
    return [];
  });
}
