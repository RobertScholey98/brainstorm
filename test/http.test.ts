import { mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { readApi } from "../src/server/appData";
import { startServer, type RunningServer } from "../src/server/index";
import type { ThreadId } from "../src/core/types";
import { FakeBridge } from "./fakeBridge";

const T1 = "11111111-1111-1111-1111-111111111111" as ThreadId;
const T3 = "33333333-3333-3333-3333-333333333333" as ThreadId;
const home = mkdtempSync(join(tmpdir(), "bs-http-"));
const bridge = new FakeBridge();
bridge.add(T1, "proj-a");
bridge.add(T3, "proj-b");

let server: RunningServer;
let agentToken = "";
beforeAll(async () => {
  server = await startServer({ home, bridge, trackerMs: 60_000 });
  agentToken = readApi(home)?.agentToken ?? "";
});
afterAll(() => server.close());

const base = () => `http://127.0.0.1:${server.port}`;
const call = async (method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base() + path, {
    method,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; data?: any; error?: any } };
};

describe("http", () => {
  test("api.json names the port and agent token, and never the UI token", () => {
    const api = readApi(home);
    expect(api?.port).toBe(server.port);
    expect(api?.pid).toBe(process.pid);
    expect(JSON.stringify(api)).not.toContain(server.uiToken);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/#ui=${server.uiToken}`);
  });

  test("health needs no token; agent and UI routes need their own token", async () => {
    expect(await call("GET", "/health", null)).toEqual({ status: 200, body: { ok: true, data: { pid: process.pid, version: "0.1.0" } } });
    expect(await call("GET", "/v1/agent/sessions?thread=" + T1, null)).toEqual({
      status: 401,
      body: { ok: false, error: { code: "unauthorized", message: "an agent token is required" } },
    });
    expect((await call("GET", "/v1/ui/sessions", agentToken)).status).toBe(401);
    expect((await call("GET", "/v1/agent/sessions?thread=" + T1, server.uiToken)).status).toBe(401);
  });

  test("refuses a foreign Origin, including the canvas frame's null, and a foreign Host", async () => {
    expect((await call("GET", "/health", null, undefined, { origin: "null" })).status).toBe(401);
    expect((await call("GET", "/health", null, undefined, { origin: "http://evil.test" })).status).toBe(401);
    expect((await call("GET", "/health", null, undefined, { origin: `http://localhost:${server.port}` })).status).toBe(200);
    const status = await new Promise<number>((resolve) =>
      request({ host: "127.0.0.1", port: server.port, path: "/health", headers: { host: "evil.test" } }, (res) => resolve(res.statusCode ?? 0)).end(),
    );
    expect(status).toBe(401);
  });

  test("maps bodies to domain types and failures to statuses", async () => {
    expect(await call("POST", "/v1/agent/sessions", agentToken, { title: "", brief: "", thread: "nope", project: null })).toEqual({
      status: 400,
      body: { ok: false, error: { code: "usage", message: 'title: Too small: expected string to have >=1 characters; thread: "nope" is not a T3 thread id' } },
    });
    const created = await call("POST", "/v1/agent/sessions", agentToken, { title: "Chore wheel", brief: "", thread: T1, project: null });
    expect(created.status).toBe(200);
    const id = created.body.data.session.id;
    expect((await call("POST", "/v1/agent/attach", agentToken, { ref: id, thread: T3 })).body.error.code).toBe("wrong_project");
    expect((await call("POST", "/v1/agent/attach", agentToken, { ref: id, thread: T3 })).status).toBe(409);
    expect((await call("GET", "/v1/ui/sessions/s_nothere1", server.uiToken)).status).toBe(404);
    expect(await call("POST", `/v1/ui/sessions/${id}/actions`, server.uiToken, { kind: "regenerate", scope: { kind: "described" }, freetext: null })).toEqual({
      status: 400,
      body: { ok: false, error: { code: "usage", message: "freetext: a described request needs freetext" } },
    });
    expect(await call("POST", `/v1/ui/sessions/${id}/actions`, server.uiToken, { kind: "select_variant", slot: "wheel", variant: "neon" })).toEqual({
      status: 404,
      body: { ok: false, error: { code: "not_found", entity: "block", message: `wheel/neon is not in the latest iteration of ${id}` } },
    });
    expect((await call("POST", `/v1/ui/sessions/${id}/export`, server.uiToken)).status).toBe(501);
  });

  test("streams a session id over SSE when the session changes", async () => {
    const created = await call("POST", "/v1/agent/sessions", agentToken, { title: "Streamed", brief: "", thread: T1, project: null });
    const id = created.body.data.session.id;
    const controller = new AbortController();
    const res = await fetch(`${base()}/v1/ui/events`, { headers: { authorization: `Bearer ${server.uiToken}` }, signal: controller.signal });
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    await call("POST", `/v1/ui/sessions/${id}/actions`, server.uiToken, { kind: "check_thread" });
    while (!text.includes("event: session")) text += decoder.decode((await reader.read()).value);
    controller.abort();
    expect(text).toContain(`event: session\ndata: {"session":"${id}"}\n\n`);
  });

  test("serves the canvas page with its CSP and no token", async () => {
    const res = await fetch(`${base()}/canvas`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'",
    );
    expect(await res.text()).toContain('<script type="application/json" id="brainstorm-boot">{"mode":"live","messages":[]}</script>');
  });
});
