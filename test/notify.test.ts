import { describe, expect, it } from "vitest";
import type { IterationN, OpenPhase, SessionId, SessionListing } from "../src/core/types";
import { alertsBetween } from "../src/renderer/notify";

const row = (id: string, latest: number | null, request: OpenPhase | null = null, lost = false) =>
  ({ id: id as SessionId, title: `Brainstorm ${id}`, latest: latest as IterationN | null, request, lost }) as SessionListing;

describe("brainstorm notifications", () => {
  it("say a new iteration landed, the first one included", () => {
    expect(alertsBetween([row("a", 2, "working"), row("b", null, "working")], [row("a", 3), row("b", 1)])).toEqual([
      { session: "a", title: "New iteration", body: "Brainstorm a · Iteration 3" },
      { session: "b", title: "New iteration", body: "Brainstorm b · Iteration 1" },
    ]);
  });

  it("say when the agent asks, a request fails or the thread goes, once each", () => {
    const before = [row("a", 1, "working"), row("b", 1, "sending"), row("c", 1, "queued")];
    const after = [row("a", 1, "asking"), row("b", 1, "send_failed"), row("c", 1, "queued", true)];
    expect(alertsBetween(before, after).map((a) => [a.session, a.title])).toEqual([
      ["a", "The agent is asking something"],
      ["b", "The request failed"],
      ["c", "Thread lost"],
    ]);
    // The same phase on the next reading is old news.
    expect(alertsBetween(after, after)).toEqual([]);
  });

  it("say nothing for a phase Rob doesn't need to hear about, or a brainstorm the last reading didn't have", () => {
    expect(alertsBetween([row("a", 1, "sending")], [row("a", 1, "working"), row("new", 1, "asking")])).toEqual([]);
    expect(alertsBetween([row("a", 1, "working")], [row("a", 1, null)])).toEqual([]);
  });
});
