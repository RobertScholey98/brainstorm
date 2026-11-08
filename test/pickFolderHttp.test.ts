import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { startServer, type RunningServer } from "../src/server/index";
import { FakeBridge } from "./fakeBridge";

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const start = async (pickFolder?: () => Promise<string | null>) => {
  server = await startServer({ home: mkdtempSync(join(tmpdir(), "bs-pick-")), bridge: new FakeBridge(), trackerMs: 60_000, pickFolder });
  return server;
};

const pick = async (s: RunningServer, token = s.uiToken) => {
  const res = await fetch(`http://127.0.0.1:${s.port}/v1/ui/pick-folder`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
};

describe("the folder dialog route", () => {
  test("answers with the folder the app's dialog chose, or null when it was cancelled", async () => {
    const answers = ["C:\\code\\app\\packages\\ui", null];
    const s = await start(async () => answers.shift() ?? null);
    expect(await pick(s)).toEqual({ status: 200, body: { ok: true, data: { path: "C:\\code\\app\\packages\\ui" } } });
    expect(await pick(s)).toEqual({ status: 200, body: { ok: true, data: { path: null } } });
  });

  test("the headless server has no dialog to open", async () => {
    const s = await start();
    expect(await pick(s)).toEqual({
      status: 503,
      body: { ok: false, error: { code: "unavailable", message: "Only the Brainstorm app can open a folder dialog. Paste the folder's path instead." } },
    });
  });

  test("only the window's token opens it", async () => {
    let opened = 0;
    const s = await start(async () => (opened++, null));
    expect((await pick(s, "not-the-token")).status).toBe(401);
    expect(opened).toBe(0);
  });
});
