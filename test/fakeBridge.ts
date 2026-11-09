import type {
  AgentBridge,
  ProjectId,
  RunId,
  SendResult,
  SnapshotResult,
  StartResult,
  ThreadId,
  ThreadInfo,
  ThreadMessage,
} from "../src/core/types";

type FakeThread = { info: ThreadInfo; messages: ThreadMessage[]; missing: boolean };

/**
 * An in-memory T3 for service tests. `sendMode` picks what the next sends do: deliver, fail without delivering,
 * deliver and still report failure (the CLI lost the reply), or hang until `release()`. `startMode` does the same for
 * `thread start`.
 */
export class FakeBridge implements AgentBridge {
  readonly threads = new Map<ThreadId, FakeThread>();
  readonly sent: { thread: ThreadId; message: string }[] = [];
  sendMode: "deliver" | "fail" | "deliver_then_fail" | "hang" = "deliver";
  snapshotFails = false;
  snapshotCalls = 0;
  startMode: "deliver" | "fail" | "deliver_then_fail" | "hang" = "deliver";
  readonly started: { project: ProjectId; title: string; thread: ThreadId; message: string }[] = [];
  #nextThread = 1;
  #held: (() => void)[] = [];

  add(id: string, projectId: string, title = "Thread"): ThreadId {
    const threadId = id as ThreadId;
    this.threads.set(threadId, {
      info: {
        threadId,
        projectId: projectId as ProjectId,
        title,
        link: `https://app.t3.codes/threads/p/${id}`,
        status: "completed",
        activeRunId: null,
        latestRunId: null,
        pendingRequestCount: 0,
      },
      messages: [],
      missing: false,
    });
    return threadId;
  }

  thread(id: ThreadId): FakeThread {
    const t = this.threads.get(id);
    if (t === undefined) throw new Error(`no fake thread ${id}`);
    return t;
  }

  startRun(id: ThreadId, run: string, pendingRequestCount = 0): void {
    const t = this.thread(id);
    const runId = run as RunId;
    t.messages = t.messages.map((m) => (m.runId === null ? { ...m, runId } : m));
    t.info = { ...t.info, status: "running", activeRunId: runId, latestRunId: runId, pendingRequestCount };
  }

  endRun(id: ThreadId, status: "completed" | "failed"): void {
    const t = this.thread(id);
    t.info = { ...t.info, status, activeRunId: null, pendingRequestCount: 0 };
  }

  release(): void {
    for (const resolve of this.#held.splice(0)) resolve();
  }

  async send(thread: ThreadId, message: string): Promise<SendResult> {
    const t = this.threads.get(thread);
    if (t === undefined || t.missing) return { kind: "failed", error: `Thread ${thread} is no longer available.` };
    if (this.sendMode === "hang") await new Promise<void>((resolve) => this.#held.push(resolve));
    if (this.sendMode === "fail") return { kind: "failed", error: "t3 did not answer within 15 s" };
    t.messages.push({ role: "user", runId: null, text: message });
    this.sent.push({ thread, message });
    return this.sendMode === "deliver_then_fail" ? { kind: "failed", error: "t3 did not answer within 15 s" } : { kind: "sent" };
  }

  async start({ project, title, message }: { project: ProjectId; title: string; message: string }): Promise<StartResult> {
    if (this.startMode === "hang") await new Promise<void>((resolve) => this.#held.push(resolve));
    if (this.startMode === "fail") return { kind: "failed", error: "t3 did not answer within 15 s" };
    const thread = this.add(`f0000000-0000-4000-8000-${String(this.#nextThread++).padStart(12, "0")}`, project, title);
    this.thread(thread).messages.push({ role: "user", runId: null, text: message });
    this.started.push({ project, title, thread, message });
    return this.startMode === "deliver_then_fail" ? { kind: "failed", error: "t3 did not answer within 15 s" } : { kind: "started", thread };
  }

  async snapshot(thread: ThreadId, { messages }: { messages: number }): Promise<SnapshotResult> {
    this.snapshotCalls += 1;
    if (this.snapshotFails) return { kind: "failed", error: "t3 did not answer within 15 s" };
    const t = this.threads.get(thread);
    if (t === undefined || t.missing) return { kind: "missing" };
    return { kind: "found", snapshot: { thread: t.info, messages: t.messages.slice(-messages) } };
  }
}
