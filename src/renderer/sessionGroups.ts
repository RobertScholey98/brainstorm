import type { ProjectId, SessionListing } from "../core/types";

export type ProjectGroup = { readonly projectId: ProjectId; readonly label: string; readonly sessions: readonly SessionListing[] };

const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

/** Where a brainstorm sorts among active ones: its last activity, or when Rob brought it back if that is later. */
export function listedAt(s: SessionListing): string {
  const back = s.settlement.state === "active" ? s.settlement.unsettledAt : null;
  return back !== null && back > s.activeAt ? back : s.activeAt;
}

/** A settle that waits on an open request keeps the brainstorm in view until it applies. */
export const isSettled = (s: SessionListing): boolean => s.settlement.state === "settled";

/** The active brainstorms, newest first, and the settled ones, newest settled first. */
export function splitSettled(sessions: readonly SessionListing[]): { active: SessionListing[]; settled: SessionListing[] } {
  const settledAt = (s: SessionListing) => (s.settlement.state === "active" ? "" : s.settlement.at);
  return {
    active: sessions.filter((s) => !isSettled(s)).sort((a, b) => newestFirst(listedAt(a), listedAt(b))),
    settled: sessions.filter(isSettled).sort((a, b) => newestFirst(settledAt(a), settledAt(b))),
  };
}

export function groupByProject(sessions: readonly SessionListing[]): ProjectGroup[] {
  const groups = new Map<ProjectId, SessionListing[]>();
  for (const s of [...sessions].sort((a, b) => newestFirst(listedAt(a), listedAt(b)))) {
    const rows = groups.get(s.projectId);
    if (rows === undefined) groups.set(s.projectId, [s]);
    else rows.push(s);
  }
  return [...groups].map(([projectId, rows]) => ({
    projectId,
    label: rows[0]?.projectName ?? "Other project",
    sessions: rows,
  }));
}
