import { expect, test } from "vitest";
import { DEFAULT_HOME, type HomeQuery } from "../src/core/prefs";
import type { OpenPhase, ProjectId, SessionListing, Settlement } from "../src/core/types";
import { matchesSearch, projectOptions, queryHome } from "../src/renderer/homeQuery";
import { needsAttention } from "../src/renderer/status";

type Spec = { project?: string; name?: string | null; brief?: string; at?: string; created?: string; request?: OpenPhase | null; lost?: boolean; settled?: string };
const listing = (title: string, spec: Spec = {}): SessionListing => {
  const settlement: Settlement = spec.settled === undefined ? { state: "active", unsettledAt: null } : { state: "settled", at: spec.settled };
  return {
    id: `s_${title.toLowerCase().replace(/\W/g, "")}`,
    projectId: (spec.project ?? "p-chores") as ProjectId,
    projectName: spec.name === undefined ? "chores" : spec.name,
    title,
    brief: spec.brief ?? "",
    createdAt: spec.created ?? "2026-11-01T09:00:00Z",
    activeAt: spec.at ?? "2026-11-01T09:00:00Z",
    request: spec.request ?? null,
    lost: spec.lost ?? false,
    settlement,
  } as unknown as SessionListing;
};

const ids = (list: readonly SessionListing[]) => list.map((s) => s.title);

const wheel = listing("Chore wheel", { brief: "Spin to pick **who** does the bins", at: "2026-11-05T09:00:00Z", created: "2026-11-02T09:00:00Z" });
const rota = listing("Kitchen rota", { project: "p-kitchen", name: "kitchen", request: "asking", at: "2026-11-04T09:00:00Z", created: "2026-11-04T09:00:00Z" });
const lost = listing("Loose notes", { project: "p-loose", name: null, lost: true, at: "2026-11-03T09:00:00Z", created: "2026-11-03T09:00:00Z" });
const working = listing("Onboarding", { request: "working", at: "2026-11-02T09:00:00Z", created: "2026-11-05T09:00:00Z" });
const settled = listing("Archive tour", { project: "p-kitchen", name: "kitchen", at: "2026-10-01T09:00:00Z", settled: "2026-11-01T09:00:00Z", created: "2026-10-01T09:00:00Z" });
const settledLater = listing("Bins study", { at: "2026-10-02T09:00:00Z", settled: "2026-11-02T09:00:00Z", created: "2026-10-02T09:00:00Z" });
const all = [wheel, rota, lost, working, settled, settledLater];
const q = (patch: Partial<HomeQuery>): HomeQuery => ({ ...DEFAULT_HOME, ...patch });

test("search matches every word, in any case, in the title or the brief's text", () => {
  expect(matchesSearch(wheel, "WHEEL")).toBe(true);
  expect(matchesSearch(wheel, "bins who"), "brief words, markdown stripped, in any order").toBe(true);
  expect(matchesSearch(wheel, "wheel rota")).toBe(false);
  expect(matchesSearch(wheel, "   ")).toBe(true);
});

test("home shows active brainstorms by default, newest activity first, with a count for each status", () => {
  const result = queryHome(all, DEFAULT_HOME, "");
  expect(ids(result.shown)).toEqual(["Chore wheel", "Kitchen rota", "Loose notes", "Onboarding"]);
  expect(result.settled).toEqual([]);
  expect(result.counts).toEqual({ active: 4, attention: 2, settled: 2, all: 6 });
});

test("attention is a lost thread or a request that stopped for Rob, never the agent at work", () => {
  expect([wheel, rota, lost, working].map(needsAttention)).toEqual([false, true, true, false]);
  expect(ids(queryHome(all, q({ status: "attention" }), "").shown)).toEqual(["Kitchen rota", "Loose notes"]);
});

test("settled lists newest settled first; all lists the active ones, then the settled ones apart", () => {
  expect(ids(queryHome(all, q({ status: "settled" }), "").shown)).toEqual(["Bins study", "Archive tour"]);
  const both = queryHome(all, q({ status: "all" }), "");
  expect([ids(both.shown), ids(both.settled)]).toEqual([["Chore wheel", "Kitchen rota", "Loose notes", "Onboarding"], ["Bins study", "Archive tour"]]);
});

test("projects narrow every status and its count; a stored project with nothing left is ignored", () => {
  const kitchen = queryHome(all, q({ projects: ["p-kitchen" as ProjectId], status: "all" }), "");
  expect([ids(kitchen.shown), ids(kitchen.settled), kitchen.counts]).toEqual([["Kitchen rota"], ["Archive tour"], { active: 1, attention: 1, settled: 1, all: 2 }]);
  expect(ids(queryHome(all, q({ projects: ["p-gone" as ProjectId] }), "").shown)).toHaveLength(4);
});

test("sorts by title or by when each was created", () => {
  expect(ids(queryHome(all, q({ sort: "title" }), "").shown)).toEqual(["Chore wheel", "Kitchen rota", "Loose notes", "Onboarding"]);
  expect(ids(queryHome(all, q({ sort: "created" }), "").shown)).toEqual(["Onboarding", "Kitchen rota", "Loose notes", "Chore wheel"]);
  expect(ids(queryHome(all, q({ sort: "title", status: "settled" }), "").shown)).toEqual(["Archive tour", "Bins study"]);
});

test("search narrows the counts too, so a status tab never promises cards it won't show", () => {
  const result = queryHome(all, q({ status: "all" }), "bins");
  expect([ids(result.shown), ids(result.settled), result.counts]).toEqual([["Chore wheel"], ["Bins study"], { active: 1, attention: 0, settled: 1, all: 2 }]);
});

test("the project filter lists every project once, by name, with Other project for one without", () => {
  expect(projectOptions(all).map((p) => [p.id, p.label, p.count])).toEqual([
    ["p-chores", "chores", 3],
    ["p-kitchen", "kitchen", 2],
    ["p-loose", "Other project", 1],
  ]);
});
