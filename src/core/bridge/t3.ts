import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { z } from "zod";
import { zBranded } from "../parse";
import {
  parseProjectId,
  parseRunId,
  parseThreadId,
  THREAD_ID_PATTERN,
  type AgentBridge,
  type ListResult,
  type SendResult,
  type SnapshotResult,
  type StartResult,
  type ThreadId,
  type ThreadSnapshot,
  type ThreadStatus,
} from "../types";

const TIMEOUT_MS = 15_000;
const MISSING = /is no longer available/;

const WINDOWS = process.platform === "win32";

export function resolveT3Cli(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const fallback =
    platform === "win32" ? win32.join(env.USERPROFILE ?? homedir(), ".t3", "bin", "t3.cmd") : posix.join(env.HOME ?? homedir(), ".t3", "bin", "t3");
  return env.BRAINSTORM_T3_CLI || env.T3CODE_CLI_PATH || fallback;
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
 * Runs `t3 thread <args>`. On Windows that goes through cmd.exe, which a .cmd needs, with every argument quoted; each
 * one is a fixed token, an id checked against its pattern, or a thread title cut down by `safeTitle`, so none holds a
 * quote or a `%`. Elsewhere the CLI runs directly, with no shell. Messages travel on stdin, so no other user-written
 * text reaches the command line.
 */
function runThread(cli: string, args: readonly string[], stdin: string, timeoutMs: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = WINDOWS
      ? spawn("cmd.exe", ["/d", "/s", "/c", `""${cli}" thread ${args.map((a) => `"${a}"`).join(" ")}"`], {
          windowsVerbatimArguments: true,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        })
      : spawn(cli, ["thread", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!WINDOWS) child.kill("SIGKILL");
      else if (child.pid !== undefined) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
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

const startShape = z.object({ threadId: zBranded(z.string(), parseThreadId, "thread id") });
const listShape = z.array(z.object({ threadId: zBranded(z.string(), parseThreadId, "thread id"), createdAt: z.string() }));

/** T3 project ids seen so far are UUIDs; anything else cmd.exe might misread is refused before it reaches a command line. */
const PROJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TITLE_MAX = 80;

/**
 * A thread title is Rob's words, so before it goes on the command line it keeps only characters cmd.exe treats as
 * plain inside quotes. An empty result leaves the title to T3, which takes the message's first line.
 */
export function safeTitle(title: string): string | null {
  const kept = title.replace(/[^A-Za-z0-9 ,.'()?+=/_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX).trim();
  return kept.length === 0 ? null : kept;
}

const parseJson = <T>(stdout: string, shape: z.ZodType<T>, command: string): { ok: true; value: T } | { ok: false; error: string } => {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { ok: false, error: `t3 thread ${command} printed something other than JSON: ${stdout.slice(0, 200)}` };
  }
  const parsed = shape.safeParse(json);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: `t3 thread ${command} changed shape: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
};

const describeFailure = (run: Run, timeoutMs: number): string =>
  run.timedOut
    ? `t3 did not answer within ${timeoutMs / 1000} s`
    : run.stderr.trim() || run.stdout.trim() || `t3 exited with code ${run.code ?? "unknown"}`;

export function createT3Bridge(options: { cli?: string; timeoutMs?: number } = {}): AgentBridge {
  const cli = options.cli ?? resolveT3Cli();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const usable = !WINDOWS || !/["%\r\n]/.test(cli);

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
      const parsed = parseJson(run.stdout, showShape, "show");
      return parsed.ok ? { kind: "found", snapshot: toSnapshot(parsed.value) } : { kind: "failed", error: parsed.error };
    },

    async start({ project, title, message }): Promise<StartResult> {
      if (!usable) return { kind: "failed", error: `the t3 CLI path ${JSON.stringify(cli)} contains characters cmd.exe would misread` };
      if (!PROJECT_PATTERN.test(project)) return { kind: "failed", error: `"${project}" is not a T3 project id` };
      const safe = safeTitle(title);
      const args = ["start", ...(safe === null ? [] : ["--title", safe]), "--json", project, "-"];
      const run = await runThread(cli, args, message, timeoutMs);
      if (run.code !== 0 || run.timedOut) return { kind: "failed", error: describeFailure(run, timeoutMs) };
      const parsed = parseJson(run.stdout, startShape, "start");
      return parsed.ok ? { kind: "started", thread: parsed.value.threadId } : { kind: "failed", error: parsed.error };
    },

    async list(project): Promise<ListResult> {
      if (!usable) return { kind: "failed", error: `the t3 CLI path ${JSON.stringify(cli)} contains characters cmd.exe would misread` };
      if (!PROJECT_PATTERN.test(project)) return { kind: "failed", error: `"${project}" is not a T3 project id` };
      const run = await runThread(cli, ["list", "--project", project, "--json"], "", timeoutMs);
      if (run.code !== 0 || run.timedOut) return { kind: "failed", error: describeFailure(run, timeoutMs) };
      const parsed = parseJson(run.stdout, listShape, "list");
      return parsed.ok ? { kind: "found", threads: parsed.value } : { kind: "failed", error: parsed.error };
    },
  };
}
