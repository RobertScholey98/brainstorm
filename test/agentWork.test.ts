import { describe, expect, it } from "vitest";
import { lastLineOf, observeWork } from "../src/core/agentWork";
import type { RunId, ThreadId, ThreadInfo, ThreadMessage, ProjectId } from "../src/core/types";

const run = (n: number) => `run:${n}` as RunId;
const thread = (fields: Partial<ThreadInfo> = {}): ThreadInfo => ({
  threadId: "t1" as ThreadId,
  projectId: "p1" as ProjectId,
  title: "Import",
  link: "t3://t1",
  status: "completed",
  activeRunId: null,
  latestRunId: null,
  pendingRequestCount: 0,
  ...fields,
});
const user = (text: string, runId: RunId | null): ThreadMessage => ({ role: "user", runId, text });
const agent = (text: string, runId: RunId | null): ThreadMessage => ({ role: "assistant", runId, text });

describe("what the agent is doing with Brainstorm's work", () => {
  it("waits until a run takes the message", () => {
    expect(observeWork({ thread: thread(), messages: [user("[brainstorm] import", null)] })).toEqual({ phase: "waiting", lastLine: null });
  });

  it("works, or asks, while the run is active, with the latest reply's last line", () => {
    const messages = [user("[brainstorm] import", run(1)), agent("Reading the components.\n\nMealCard renders a **Button**.", run(1))];
    expect(observeWork({ thread: thread({ status: "running", activeRunId: run(1), latestRunId: run(1) }), messages })).toEqual({
      phase: "working",
      lastLine: "MealCard renders a Button.",
    });
    expect(observeWork({ thread: thread({ status: "running", activeRunId: run(1), latestRunId: run(1), pendingRequestCount: 1 }), messages }).phase).toBe("asking");
  });

  it("finishes, or fails, once the run that took it ends", () => {
    const messages = [user("[brainstorm] import", run(1)), agent("Added the system; v1.", run(1))];
    expect(observeWork({ thread: thread({ latestRunId: run(1) }), messages })).toEqual({ phase: "finished", lastLine: "Added the system; v1." });
    expect(observeWork({ thread: thread({ status: "failed", latestRunId: run(1) }), messages }).phase).toBe("failed");
  });

  it("follows the newest Brainstorm message, not an earlier one's reply", () => {
    const messages = [user("[brainstorm] import", run(1)), agent("Added the system.", run(1)), user("[brainstorm] review", null)];
    expect(observeWork({ thread: thread({ latestRunId: run(1) }), messages })).toEqual({ phase: "waiting", lastLine: null });
  });
});

describe("a reply's last line", () => {
  it("drops markdown marks and blank lines", () => {
    expect(lastLineOf("## Report\n\n- Moved `PageFrame` to layouts\n\n")).toBe("Moved PageFrame to layouts");
  });

  it("shortens a long line to one row", () => {
    const line = lastLineOf("x".repeat(200));
    expect([line?.length, line?.endsWith("…")]).toEqual([160, true]);
  });

  it("has none for an empty reply", () => {
    expect(lastLineOf("\n\n")).toBeNull();
  });
});
