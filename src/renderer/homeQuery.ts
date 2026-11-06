import type { HomeQuery, HomeSort, HomeStatus } from "../core/prefs";
import type { ProjectId, SessionListing } from "../core/types";
import { markdownText } from "./markdownSubset";
import { isSettled, listedAt } from "./sessionGroups";
import { needsAttention } from "./status";

const IN_STATUS: Record<HomeStatus, (s: SessionListing) => boolean> = {
  active: (s) => !isSettled(s),
  attention: (s) => !isSettled(s) && needsAttention(s),
  settled: isSettled,
  all: () => true,
};

/** Every word of the search, in any order and any case, somewhere in the title or the brief's text. */
export function matchesSearch(s: SessionListing, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = `${s.title}\n${markdownText(s.brief)}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

export type ProjectOption = { readonly id: ProjectId; readonly label: string; readonly count: number };

/**
 * Every project with a brainstorm, by name, for the project filter. Each counts what picking it would show under the
 * status and search as they are, so its count agrees with the cards; a project with none there still lists, at 0.
 */
export function projectOptions(sessions: readonly SessionListing[], status: HomeStatus, search: string): ProjectOption[] {
  const byId = new Map<ProjectId, ProjectOption>();
  for (const s of sessions) {
    const known = byId.get(s.projectId);
    const shown = IN_STATUS[status](s) && matchesSearch(s, search) ? 1 : 0;
    byId.set(s.projectId, { id: s.projectId, label: known?.label ?? s.projectName ?? "Other project", count: (known?.count ?? 0) + shown });
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** The projects a stored filter names that still have a brainstorm. None left is every project, so home is never empty by a filter Rob can't see. */
export function liveProjects(query: HomeQuery, sessions: readonly SessionListing[]): ReadonlySet<ProjectId> {
  const known = new Set(sessions.map((s) => s.projectId));
  return new Set(query.projects.filter((p) => known.has(p)));
}

const settledAt = (s: SessionListing) => (s.settlement.state === "active" ? "" : s.settlement.at);
const newestFirst = (key: (s: SessionListing) => string) => (a: SessionListing, b: SessionListing) => {
  const [x, y] = [key(a), key(b)];
  return x < y ? 1 : x > y ? -1 : 0;
};

/** Settled brainstorms sort by when they were settled under the activity order, as the sidebar's Settled group does. */
function sorter(sort: HomeSort, settled: boolean): (a: SessionListing, b: SessionListing) => number {
  if (sort === "title") return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  if (sort === "created") return newestFirst((s) => s.createdAt);
  return newestFirst(settled ? settledAt : listedAt);
}

export type HomeResult = {
  /** The cards to show, in order; under `all`, only the ones still active. */
  readonly shown: readonly SessionListing[];
  /** Under `all`, the settled ones, shown after the rest under their own heading; otherwise empty. */
  readonly settled: readonly SessionListing[];
  /** How many each status would show with the search and projects as they are, for the status tabs. */
  readonly counts: Readonly<Record<HomeStatus, number>>;
};

export function queryHome(sessions: readonly SessionListing[], query: HomeQuery, search: string): HomeResult {
  const projects = liveProjects(query, sessions);
  const pool = sessions.filter((s) => (projects.size === 0 || projects.has(s.projectId)) && matchesSearch(s, search));
  const counts = {
    active: pool.filter(IN_STATUS.active).length,
    attention: pool.filter(IN_STATUS.attention).length,
    settled: pool.filter(IN_STATUS.settled).length,
    all: pool.length,
  };
  if (query.status === "all") {
    return {
      shown: pool.filter((s) => !isSettled(s)).sort(sorter(query.sort, false)),
      settled: pool.filter(isSettled).sort(sorter(query.sort, true)),
      counts,
    };
  }
  return { shown: pool.filter(IN_STATUS[query.status]).sort(sorter(query.sort, query.status === "settled")), settled: [], counts };
}
