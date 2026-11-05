import { expect, test } from "vitest";
import type { SessionListing } from "../src/core/types";
import { groupByProject } from "../src/renderer/sessionGroups";

const listing = (id: string, projectId: string, projectName: string | null, createdAt: string, activeAt: string): SessionListing =>
  ({ id, projectId, projectName, title: id, brief: "", createdAt, attachedThread: "t", lost: false, latest: null, activeAt }) as unknown as SessionListing;

test("groups by project, newest activity first, labelled with the newest name that isn't null", () => {
  const groups = groupByProject([
    listing("wheel", "p-brainstorm", "brainstorm", "2026-11-01T09:00:00Z", "2026-11-01T09:00:00Z"),
    listing("onboarding", "p-brainstorm", "brainstorm-app", "2026-11-03T09:00:00Z", "2026-11-04T09:00:00Z"),
    listing("legacy", "p-brainstorm", null, "2026-11-04T09:00:00Z", "2026-11-04T10:00:00Z"),
    listing("fleet", "p-fleet", "fleet-hub", "2026-11-02T09:00:00Z", "2026-11-05T09:00:00Z"),
    listing("loose", "p-loose", null, "2026-11-02T09:00:00Z", "2026-11-02T09:00:00Z"),
  ]);
  expect(groups.map((g) => [g.projectId, g.label, g.sessions.map((s) => s.id)])).toEqual([
    ["p-fleet", "fleet-hub", ["fleet"]],
    ["p-brainstorm", "brainstorm-app", ["legacy", "onboarding", "wheel"]],
    ["p-loose", "Other project", ["loose"]],
  ]);
});
