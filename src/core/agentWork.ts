import type { AgentWork, ThreadSnapshot } from "./types";

/**
 * What the agent is doing with the work Brainstorm last handed it: the thread's newest `[brainstorm]` message, the run
 * that took it, and the agent's latest reply since. A run after it, such as Rob's follow-up, still counts as working.
 */
export function observeWork(snapshot: ThreadSnapshot): Omit<AgentWork, "link"> {
  const { thread, messages } = snapshot;
  const index = messages.findLastIndex((m) => m.role === "user" && m.text.startsWith("[brainstorm]"));
  const reply = messages
    .slice(index + 1)
    .filter((m) => m.role === "assistant")
    .at(-1);
  const lastLine = reply === undefined ? null : lastLineOf(reply.text);
  const mine = messages[index];
  if (mine !== undefined && mine.runId === null) return { phase: "waiting", lastLine };
  if (thread.activeRunId !== null) return { phase: thread.pendingRequestCount > 0 ? "asking" : "working", lastLine };
  const failed = thread.status === "failed" && (mine === undefined || mine.runId === thread.latestRunId);
  return { phase: failed ? "failed" : "finished", lastLine };
}

/** The reply's last line of prose, without markdown marks, short enough for one row. */
export function lastLineOf(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*(#+|[-*>]|\d+\.)\s*/, "")
        .replace(/[*_`]/g, "")
        .trim(),
    )
    .filter((l) => l !== "" && !/^(```|---)/.test(l))
    .at(-1);
  if (line === undefined) return null;
  return line.length <= 160 ? line : `${line.slice(0, 159).trimEnd()}…`;
}
