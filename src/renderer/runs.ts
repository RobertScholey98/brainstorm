import type { HistoryEntry, IterationN, SessionId } from "../core/types";

/**
 * A run of history (ADR 010): the iterations from one confirm up to the next. Confirms are like commits, so the strip
 * shows one run at a time and a dropdown steps between them. A branch point starts a run too, under its own name: a
 * branch made with only an instruction, or with grafts the agent has yet to merge, is no confirm yet.
 */
export type Run = {
  /** The run's first entry, as `session:n`, which never changes as the run grows. */
  readonly key: string;
  /**
   * "Start" for what came before the first confirm or branch point, "Branch from iteration n" for a branch point, and
   * "Confirm k" for a confirm, counting the trail's fulfilled confirms from 1.
   */
  readonly label: string;
  readonly entries: readonly HistoryEntry[];
};

export const entryKey = (at: { readonly session: SessionId; readonly n: IterationN }): string => `${at.session}:${at.n}`;

/** Whether an entry starts a run: a fulfilled confirm, or a branch's first iteration. */
export function startsRun(entry: HistoryEntry): boolean {
  return entry.origin.kind === "branch" || isConfirm(entry);
}

const isConfirm = (entry: HistoryEntry) => entry.origin.kind === "request" && entry.origin.body.scope.kind === "confirm";

/** The trail cut into runs, oldest first. A trail that opens on a confirm has no Start run. */
export function splitRuns(entries: readonly HistoryEntry[]): Run[] {
  const runs: HistoryEntry[][] = [];
  for (const entry of entries) {
    const last = runs.at(-1);
    if (last === undefined || startsRun(entry)) runs.push([entry]);
    else last.push(entry);
  }
  let confirms = 0;
  return runs.map((run) => {
    const first = run[0]!;
    const label = first.origin.kind === "branch" ? `Branch from iteration ${first.origin.from}` : isConfirm(first) ? `Confirm ${(confirms += 1)}` : "Start";
    return { key: entryKey(first), label, entries: run };
  });
}

/** The run holding `at`, or the newest run when none does. */
export function runOf(runs: readonly Run[], at: { readonly session: SessionId; readonly n: IterationN }): Run | null {
  const key = entryKey(at);
  return runs.find((r) => r.entries.some((e) => entryKey(e) === key)) ?? runs.at(-1) ?? null;
}
