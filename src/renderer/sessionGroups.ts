import type { ProjectId, SessionListing } from "../core/types";

export type ProjectGroup = { readonly projectId: ProjectId; readonly label: string; readonly sessions: readonly SessionListing[] };

const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

export function groupByProject(sessions: readonly SessionListing[]): ProjectGroup[] {
  const groups = new Map<ProjectId, SessionListing[]>();
  for (const s of [...sessions].sort((a, b) => newestFirst(a.activeAt, b.activeAt))) {
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
