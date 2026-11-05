import type { ExportResult, Result, RobAction, SessionId, SessionListing, SessionView } from "../core/types";

export type Api = {
  sessions(): Promise<Result<SessionListing[]>>;
  view(id: SessionId): Promise<Result<SessionView>>;
  act(id: SessionId, action: RobAction): Promise<Result<SessionView>>;
  exportHtml(id: SessionId): Promise<Result<ExportResult>>;
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
    } catch (e) {
      return { ok: false, error: { code: "unavailable", message: `Brainstorm's server didn't answer: ${(e as Error).message}` } };
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
    act: (id, action) => call("POST", `/v1/ui/sessions/${id}/actions`, action),
    exportHtml: (id) => call("POST", `/v1/ui/sessions/${id}/export`),
    events,
  };
}
