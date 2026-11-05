import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { zBranded } from "../parse";
import {
  parseProjectId,
  parseRunId,
  parseThreadId,
  THREAD_ID_PATTERN,
  type AgentBridge,
  type SendResult,
  type SnapshotResult,
  type ThreadId,
  type ThreadSnapshot,
  type ThreadStatus,
} from "../types";

const TIMEOUT_MS = 15_000;
const MISSING = /is no longer available/;

export function resolveT3Cli(env: NodeJS.ProcessEnv = process.env): string {
  return env.BRAINSTORM_T3_CLI || env.T3CODE_CLI_PATH || join(env.USERPROFILE ?? homedir(), ".t3", "bin", "t3.cmd");
}

const runIdOrNull = zBranded(z.string(), parseRunId, "run id")
  .nullable()
  .optional()
  .transform((v) => v ?? null);

const threadShape = z.object({
  threadId: zBranded(z.string(), parseThreadId, "thread id"),
  projectId: zBranded(z.string(), parseProjectId, "project id"),
  title: z.string(),
  link: z.string(),
  status: z.string(),
  activeRunId: runIdOrNull,
  latestRunId: runIdOrNull,
  pendingRequestCount: z.number().int().nonnegative(),
});

const showShape = z.object({
  thread: threadShape,
  messages: z.array(z.object({ role: z.string(), runId: runIdOrNull, text: z.string() })),
});

/** T3 reports an idle thread whose run finished as `waiting`, which Brainstorm reads as completed. */
const STATUSES: ReadonlyMap<string, ThreadStatus> = new Map([
  ["running", "running"],
  ["completed", "completed"],
  ["waiting", "completed"],
  ["failed", "failed"],
]);

function toSnapshot(raw: z.infer<typeof showShape>): ThreadSnapshot {
  const t = raw.thread;
  return {
    thread: {
      threadId: t.threadId,
      projectId: t.projectId,
      title: t.title,
      link: t.link,
      status: STATUSES.get(t.status) ?? "unknown",
      activeRunId: t.activeRunId,
      latestRunId: t.latestRunId,
      pendingRequestCount: t.pendingRequestCount,
    },
    messages: raw.messages.map((m) => ({
      role: m.role === "user" || m.role === "assistant" ? m.role : "other",
      runId: m.runId,
      text: m.text,
    })),
  };
}

type Run = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/**
 * Runs `<t3.cmd> thread <args>` through cmd.exe, which a .cmd needs. Every argument is a fixed token or a thread id
 * checked against THREAD_ID_PATTERN, and the only free text travels on stdin, so nothing user-written reaches the
 * command line.
 */
function runThread(cli: string, args: readonly string[], stdin: string, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", `""${cli}" thread ${args.join(" ")}"`], {
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin, "utf8");
  });
}

const describeFailure = (run: Run, timeoutMs: number): string =>
  run.timedOut
    ? `t3 did not answer within ${timeoutMs / 1000} s`
    : run.stderr.trim() || run.stdout.trim() || `t3 exited with code ${run.code ?? "unknown"}`;

export function createT3Bridge(options: { cli?: string; timeoutMs?: number } = {}): AgentBridge {
  const cli = options.cli ?? resolveT3Cli();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const usable = !/["%\r\n]/.test(cli);

  const checked = (thread: ThreadId): string | null =>
    !usable
      ? `the t3 CLI path ${JSON.stringify(cli)} contains characters cmd.exe would misread`
      : THREAD_ID_PATTERN.test(thread)
        ? null
        : `"${thread}" is not a T3 thread id`;

  return {
    async send(thread, message): Promise<SendResult> {
      const refused = checked(thread);
      if (refused !== null) return { kind: "failed", error: refused };
      const run = await runThread(cli, ["send", thread, "-"], message, timeoutMs);
      return run.code === 0 && !run.timedOut ? { kind: "sent" } : { kind: "failed", error: describeFailure(run, timeoutMs) };
    },

    async snapshot(thread, { messages }): Promise<SnapshotResult> {
      const refused = checked(thread);
      if (refused !== null) return { kind: "failed", error: refused };
      const run = await runThread(cli, ["show", thread, "--json", "--messages", String(Math.trunc(messages))], "", timeoutMs);
      if (run.code !== 0 || run.timedOut) {
        return MISSING.test(run.stderr) ? { kind: "missing" } : { kind: "failed", error: describeFailure(run, timeoutMs) };
      }
      let json: unknown;
      try {
        json = JSON.parse(run.stdout);
      } catch {
        return { kind: "failed", error: `t3 thread show printed something other than JSON: ${run.stdout.slice(0, 200)}` };
      }
      const parsed = showShape.safeParse(json);
      if (!parsed.success) {
        return { kind: "failed", error: `t3 thread show changed shape: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
      }
      return { kind: "found", snapshot: toSnapshot(parsed.data) };
    },
  };
}
