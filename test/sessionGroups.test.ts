import { expect, test } from "vitest";
import type { SessionListing } from "../src/core/types";
import { groupByProject } from "../src/renderer/sessionGroups";

const listing = (id: string, projectId: string, projectName: string | null, activeAt: string): SessionListing =>
  ({ id, projectId, projectName, title: id, brief: "", createdAt: activeAt, attachedThread: "t", lost: false, latest: null, activeAt, request: null }) as unknown as SessionListing;

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
