import { describe, expect, it } from "vitest";
import type { BlockId, HistoryEntry, IterationN, RequestN, SessionId, SlotId, VariantKey } from "../src/core/types";
import { entryKey, runOf, splitRuns } from "../src/renderer/runs";

const root = "s_root01" as SessionId;
const branch = "s_branch1" as SessionId;
const at = "2026-11-08T10:00:00.000Z";

const brief = (n: number, session = root): HistoryEntry => ({ session, n: n as IterationN, createdAt: at, origin: { kind: "brief" } });
const agent = (n: number, session = root): HistoryEntry => ({ session, n: n as IterationN, createdAt: at, origin: { kind: "agent", note: null } });
const confirm = (n: number, session = root): HistoryEntry => ({
  session,
  n: n as IterationN,
  createdAt: at,
  origin: {
    kind: "request",
    n: 1 as RequestN,
    body: { scope: { kind: "confirm", mains: [{ slot: "wheel" as SlotId, variant: "neon" as VariantKey }], grafts: [], drop: ["wheel/flat" as BlockId] }, freetext: null },
    changed: [],
    kept: [],
  },
});
const forked = (n: number, session: SessionId): HistoryEntry => ({
  session,
  n: n as IterationN,
  createdAt: at,
  origin: { kind: "fork", parent: "Root", from: (n - 1) as IterationN },
});
const regenerate = (n: number): HistoryEntry => ({
  session: root,
  n: n as IterationN,
  createdAt: at,
  origin: { kind: "request", n: 2 as RequestN, body: { scope: { kind: "all" }, freetext: "warmer" }, changed: [], kept: [] },
});

describe("splitRuns", () => {
  it("is one Start run while nothing was confirmed", () => {
    expect(splitRuns([brief(1), agent(2), regenerate(3)]).map((r) => [r.key, r.label, r.entries.map((e) => e.n)])).toEqual([["s_root01:1", "Start", [1, 2, 3]]]);
  });

  it("starts a run at each confirm and numbers the confirms", () => {
    const runs = splitRuns([brief(1), agent(2), confirm(3), regenerate(4), confirm(5)]);
    expect(runs.map((r) => [r.key, r.label, r.entries.map((e) => e.n)])).toEqual([
      ["s_root01:1", "Start", [1, 2]],
      ["s_root01:3", "Confirm 1", [3, 4]],
      ["s_root01:5", "Confirm 2", [5]],
    ]);
  });

  it("starts a run at a branch's first iteration, across sessions on the trail", () => {
    const runs = splitRuns([brief(1), agent(2), forked(3, branch), agent(4, branch)]);
    expect(runs.map((r) => [r.key, r.label, r.entries.map(entryKey)])).toEqual([
      ["s_root01:1", "Start", ["s_root01:1", "s_root01:2"]],
      ["s_branch1:3", "Confirm 1", ["s_branch1:3", "s_branch1:4"]],
    ]);
  });

  it("has no Start run when the trail opens on a confirm", () => {
    expect(splitRuns([confirm(1), agent(2)]).map((r) => r.label)).toEqual(["Confirm 1"]);
  });

  it("is empty for an empty trail", () => {
    expect(splitRuns([])).toEqual([]);
  });
});

describe("runOf", () => {
  const runs = splitRuns([brief(1), agent(2), confirm(3), agent(4)]);

  it("finds the run holding an entry by session and number", () => {
    expect(runOf(runs, { session: root, n: 2 as IterationN })?.key).toBe("s_root01:1");
    expect(runOf(runs, { session: root, n: 4 as IterationN })?.key).toBe("s_root01:3");
  });

  it("falls back to the newest run for a point not on the trail", () => {
    expect(runOf(runs, { session: branch, n: 2 as IterationN })?.key).toBe("s_root01:3");
  });

  it("is null with no runs", () => {
    expect(runOf([], { session: root, n: 1 as IterationN })).toBeNull();
  });
});
