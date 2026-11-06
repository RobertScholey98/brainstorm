import { expect, test } from "vitest";
import type { SessionListing, Settlement } from "../src/core/types";
import { groupByProject, splitSettled } from "../src/renderer/sessionGroups";

const ACTIVE: Settlement = { state: "active", unsettledAt: null };

const listing = (id: string, projectId: string, projectName: string | null, activeAt: string, settlement: Settlement = ACTIVE): SessionListing =>
  ({ id, projectId, projectName, title: id, brief: "", createdAt: activeAt, attachedThread: "t", lost: false, latest: null, activeAt, request: null, settlement }) as unknown as SessionListing;

test("groups by project, newest activity first, labelled with the project's name or Other project", () => {
  const groups = groupByProject([
    listing("wheel", "p-brainstorm", "brainstorm", "2026-11-01T09:00:00Z"),
    listing("onboarding", "p-brainstorm", "brainstorm", "2026-11-04T09:00:00Z"),
    listing("legacy", "p-brainstorm", "brainstorm", "2026-11-04T10:00:00Z"),
    listing("fleet", "p-fleet", "fleet-hub", "2026-11-05T09:00:00Z"),
    listing("loose", "p-loose", null, "2026-11-02T09:00:00Z"),
  ]);
  expect(groups.map((g) => [g.projectId, g.label, g.sessions.map((s) => s.id)])).toEqual([
    ["p-fleet", "fleet-hub", ["fleet"]],
    ["p-brainstorm", "brainstorm", ["legacy", "onboarding", "wheel"]],
    ["p-loose", "Other project", ["loose"]],
  ]);
});

test("settled brainstorms leave the active list newest settled first, and one brought back lists as fresh", () => {
  const { active, settled } = splitSettled([
    listing("wheel", "p", "brainstorm", "2026-11-01T09:00:00Z", { state: "settled", at: "2026-11-02T09:00:00Z" }),
    listing("legacy", "p", "brainstorm", "2026-11-04T10:00:00Z"),
    listing("old", "p", "brainstorm", "2026-10-01T09:00:00Z", { state: "settled", at: "2026-11-03T09:00:00Z" }),
    listing("waiting", "p", "brainstorm", "2026-11-03T10:00:00Z", { state: "settling", at: "2026-11-03T11:00:00Z" }),
    listing("back", "p", "brainstorm", "2026-10-02T09:00:00Z", { state: "active", unsettledAt: "2026-11-05T09:00:00Z" }),
  ]);
  expect(active.map((s) => s.id), "a settle waiting on a request stays in view").toEqual(["back", "legacy", "waiting"]);
  expect(settled.map((s) => s.id)).toEqual(["old", "wheel"]);
  expect(groupByProject(active)[0]?.sessions.map((s) => s.id)).toEqual(["back", "legacy", "waiting"]);
});
