import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { installable, nextUpdateState, type AppUpdateEvent, type AppUpdates, type AppUpdateState } from "../src/core/appUpdate";
import { startServer, type RunningServer } from "../src/server/index";
import { FakeBridge } from "./fakeBridge";

/** The updater's contract without electron-updater: events move the state, and install takes a ready download. */
function fakeUpdates() {
  let state: AppUpdateState = { kind: "idle", checkedAt: null };
  const listeners = new Set<(s: AppUpdateState) => void>();
  const emit = (event: AppUpdateEvent) => {
    state = nextUpdateState(state, event);
    for (const l of listeners) l(state);
  };
  const updates: AppUpdates = {
    state: () => state,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    install: () => {
      if (installable(state) === null) return false;
      emit({ kind: "install" });
      return true;
    },
  };
  return { updates, emit };
}

const fake = fakeUpdates();
let server: RunningServer;
beforeAll(async () => {
  server = await startServer({ home: mkdtempSync(join(tmpdir(), "bs-update-")), bridge: new FakeBridge(), trackerMs: 60_000, updates: fake.updates });
});
afterAll(() => server.close());

const call = async (method: string, path: string) => {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: { authorization: `Bearer ${server.uiToken}` } });
  return { status: res.status, body: await res.json() };
};

describe("update routes", () => {
  test("the stream carries each update state, and a restart needs a downloaded update", async () => {
    expect(await call("GET", "/v1/ui/update")).toEqual({ status: 200, body: { ok: true, data: { kind: "idle", checkedAt: null } } });
    expect(await call("POST", "/v1/ui/update/install")).toEqual({
      status: 422,
      body: { ok: false, error: { code: "invalid_action", message: "There's no downloaded update to install." } },
    });

    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${server.port}/v1/ui/events`, { headers: { authorization: `Bearer ${server.uiToken}` }, signal: controller.signal });
    const reader = res.body!.getReader();
    await reader.read(); // ": connected"
    fake.emit({ kind: "found", version: "0.2.0" });
    fake.emit({ kind: "downloaded", version: "0.2.0" });
    let text = "";
    while (!text.includes('"ready"')) text += new TextDecoder().decode((await reader.read()).value);
    controller.abort();
    expect(text).toBe(
      'event: update\ndata: {"kind":"downloading","version":"0.2.0","percent":0}\n\n' + 'event: update\ndata: {"kind":"ready","version":"0.2.0"}\n\n',
    );

    expect(await call("POST", "/v1/ui/update/install")).toEqual({ status: 200, body: { ok: true, data: { kind: "installing", version: "0.2.0" } } });
    // A second press while it restarts doesn't start the installer twice.
    expect((await call("POST", "/v1/ui/update/install")).status).toBe(422);
  });

  test("the headless server says it has nothing to update", async () => {
    const headless = await startServer({ home: mkdtempSync(join(tmpdir(), "bs-update-")), bridge: new FakeBridge(), trackerMs: 60_000 });
    try {
      const res = await fetch(`http://127.0.0.1:${headless.port}/v1/ui/update`, { headers: { authorization: `Bearer ${headless.uiToken}` } });
      expect(await res.json()).toEqual({ ok: true, data: { kind: "off", reason: "The headless server has no app to update." } });
    } finally {
      await headless.close();
    }
  });
});
