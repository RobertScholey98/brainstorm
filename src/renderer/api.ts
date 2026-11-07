import type { UiPrefs, UiPrefsPatch } from "../core/prefs";
import type {
  ExportResult,
  ForkInput,
  IterationN,
  IterationView,
  Result,
  RobAction,
  SessionId,
  SessionListing,
  SessionPreview,
  SessionView,
  SlotId,
} from "../core/types";

export type Api = {
  sessions(): Promise<Result<SessionListing[]>>;
  view(id: SessionId): Promise<Result<SessionView>>;
  /** What the session's home card previews, or null before its first iteration. */
  preview(id: SessionId, at?: { readonly n?: IterationN; readonly slot?: SlotId }): Promise<Result<SessionPreview | null>>;
  /** A past iteration, read-only. */
  iteration(id: SessionId, n: IterationN): Promise<Result<IterationView>>;
  /** Makes a new brainstorm from one iteration and starts its thread. A failed start still makes the fork. */
  fork(id: SessionId, input: ForkInput): Promise<Result<{ readonly fork: SessionId }>>;
  /** Throws away a fork whose thread never started. */
  discard(id: SessionId): Promise<Result<{ readonly parent: SessionId | null }>>;
  act(id: SessionId, action: RobAction): Promise<Result<SessionView>>;
  /** Settles a brainstorm, or brings it back. */
  settle(id: SessionId, settled: boolean): Promise<Result<SessionListing>>;
  exportHtml(id: SessionId): Promise<Result<ExportResult>>;
  prefs(): Promise<Result<UiPrefs>>;
  setPrefs(patch: UiPrefsPatch): Promise<Result<UiPrefs>>;
  /** Calls `onSession` with each changed session id until `signal` aborts, reconnecting after a drop. */
  events(onSession: (id: SessionId) => void, onOpen: () => void, signal: AbortSignal): Promise<void>;
};

const RECONNECT_MS = 1000;

/** The UI token stays in this closure; nothing else in the renderer can read it. */
export function createApi(token: string): Api {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
    try {
      const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return (await res.json()) as Result<T>;
    } catch {
      return { ok: false, error: { code: "unavailable", message: "Brainstorm's server didn't answer. If it happens again, restart Brainstorm." } };
    }
  }

  async function events(onSession: (id: SessionId) => void, onOpen: () => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        // EventSource can't send the bearer header, so the stream is read with fetch.
        const res = await fetch("/v1/ui/events", { headers, signal });
        const reader = res.body?.getReader();
        if (!res.ok || reader === undefined) throw new Error(`events answered ${res.status}`);
        onOpen();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = /^data: (.*)$/m.exec(event)?.[1];
            if (/^event: session$/m.test(event) && data !== undefined) onSession((JSON.parse(data) as { session: SessionId }).session);
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      await new Promise((r) => setTimeout(r, RECONNECT_MS));
    }
  }

  return {
    sessions: () => call("GET", "/v1/ui/sessions"),
    view: (id) => call("GET", `/v1/ui/sessions/${id}`),
    preview: (id, at = {}) => {
      const query = new URLSearchParams();
      if (at.n !== undefined) query.set("n", String(at.n));
      if (at.slot !== undefined) query.set("slot", at.slot);
      const q = query.toString();
      return call("GET", `/v1/ui/sessions/${id}/preview${q === "" ? "" : `?${q}`}`);
    },
    iteration: (id, n) => call("GET", `/v1/ui/sessions/${id}/iterations/${n}`),
    fork: (id, input) => call("POST", `/v1/ui/sessions/${id}/fork`, input),
    discard: (id) => call("POST", `/v1/ui/sessions/${id}/discard`),
    act: (id, action) => call("POST", `/v1/ui/sessions/${id}/actions`, action),
    settle: (id, settled) => call("POST", `/v1/ui/sessions/${id}/settle`, { settled }),
    exportHtml: (id) => call("POST", `/v1/ui/sessions/${id}/export`),
    prefs: () => call("GET", "/v1/ui/prefs"),
    setPrefs: (patch) => call("POST", "/v1/ui/prefs", patch),
    events,
  };
}
