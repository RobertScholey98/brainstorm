import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { createT3Bridge, resolveT3Cli } from "../src/core/bridge/t3";
import type { ThreadId } from "../src/core/types";

const cli = join(import.meta.dirname, "fake-t3", "t3.cmd");
const thread = "8ee90f34-3a9b-4c75-9a5a-ed220b201be1" as ThreadId;
const statePath = join(mkdtempSync(join(tmpdir(), "bs-bridge-")), "t3.json");
process.env.BRAINSTORM_FAKE_T3_STATE = statePath;

const writeState = (state: unknown) => writeFileSync(statePath, JSON.stringify(state));
const readState = () => JSON.parse(readFileSync(statePath, "utf8"));

beforeEach(() =>
  writeState({
    threads: {
      [thread]: {
        projectId: "f0d48734-aa55-422c-9bcd-e473ade44a34",
        title: "Chore app",
        status: "running",
        activeRunId: "run:thread:x:ordinal:2",
        latestRunId: "run:thread:x:ordinal:2",
        pendingRequestCount: 1,
        messages: [
          { role: "user", runId: "run:thread:x:ordinal:2", text: "hello" },
          { role: "tool", runId: "run:thread:x:ordinal:2", text: "ran" },
        ],
      },
    },
  }),
);

const bridge = createT3Bridge({ cli });

describe("t3 bridge", () => {
  test("parses thread show into the domain snapshot", async () => {
    expect(await bridge.snapshot(thread, { messages: 30 })).toEqual({
      kind: "found",
      snapshot: {
        thread: {
          threadId: thread,
          projectId: "f0d48734-aa55-422c-9bcd-e473ade44a34",
          title: "Chore app",
          link: `https://app.t3.codes/threads/fake/${thread}`,
          status: "running",
          activeRunId: "run:thread:x:ordinal:2",
          latestRunId: "run:thread:x:ordinal:2",
          pendingRequestCount: 1,
        },
        messages: [
          { role: "user", runId: "run:thread:x:ordinal:2", text: "hello" },
          { role: "other", runId: "run:thread:x:ordinal:2", text: "ran" },
        ],
      },
    });
  });

  test("reads waiting, an idle thread whose run finished, as completed, and an unseen status as unknown", async () => {
    const status = async (raw: string) => {
      writeState({ threads: { [thread]: { ...readState().threads[thread], status: raw, activeRunId: null } } });
      const result = await bridge.snapshot(thread, { messages: 30 });
      return result.kind === "found" ? result.snapshot.thread.status : result.kind;
    };
    expect(await status("waiting")).toBe("completed");
    expect(await status("completed")).toBe("completed");
    expect(await status("archiving")).toBe("unknown");
  });

  test("a missing thread is missing, and any other failure is failed", async () => {
    expect(await bridge.snapshot("00000000-0000-0000-0000-000000000000" as ThreadId, { messages: 30 })).toEqual({ kind: "missing" });
    writeState({ ...readState(), fail: true });
    expect(await bridge.snapshot(thread, { messages: 30 })).toEqual({
      kind: "failed",
      error: "fake t3 failure: the server is not responding",
    });
  });

  test("send passes the message on stdin byte for byte", async () => {
    const message = `[brainstorm] session s_8f2k3a · request 1 · freetext: "a & b | c > d %PATH% ^"\nsecond line`;
    expect(await bridge.send(thread, message)).toEqual({ kind: "sent" });
    expect(readState().sent).toEqual([{ thread, message }]);
  });

  test("refuses a thread id that isn't one before spawning", async () => {
    expect(await bridge.send('x" & calc & "' as ThreadId, "hi")).toEqual({ kind: "failed", error: `"x" & calc & "" is not a T3 thread id` });
    expect(readState().sent).toEqual(undefined);
  });

  test("resolves the CLI path from BRAINSTORM_T3_CLI, then T3CODE_CLI_PATH, then the user profile", () => {
    expect(resolveT3Cli({ BRAINSTORM_T3_CLI: "C:\\a\\t3.cmd", T3CODE_CLI_PATH: "C:\\b\\t3.cmd" })).toBe("C:\\a\\t3.cmd");
    expect(resolveT3Cli({ T3CODE_CLI_PATH: "C:\\b\\t3.cmd" })).toBe("C:\\b\\t3.cmd");
    expect(resolveT3Cli({ USERPROFILE: "C:\\Users\\rob" })).toBe("C:\\Users\\rob\\.t3\\bin\\t3.cmd");
  });
});
