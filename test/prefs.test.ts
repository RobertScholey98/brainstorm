import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyPrefs, readPrefs } from "../src/core/prefs";
import type { SessionId } from "../src/core/types";
import { startServer } from "../src/server/index";
import { FakeBridge } from "./fakeBridge";

async function withServer<T>(home: string, fn: (call: (method: string, body?: unknown) => Promise<{ status: number; body: any }>) => Promise<T>) {
  const server = await startServer({ home, bridge: new FakeBridge(), trackerMs: 60_000 });
  try {
    return await fn(async (method, body) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/v1/ui/prefs`, {
        method,
        headers: { authorization: `Bearer ${server.uiToken}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    });
  } finally {
    await server.close();
  }
}

describe("UI prefs", () => {
  test("pane widths, the Inspector rail and a brainstorm's canvas view survive a restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "bs-prefs-"));
    await withServer(home, async (call) => {
      expect((await call("GET")).body).toEqual({ ok: true, data: { panes: { sidebar: null, inspector: null }, inspectorRail: false, canvas: {} } });
      await call("POST", { panes: { sidebar: 312 } });
      await call("POST", { panes: { inspector: 344 }, inspectorRail: true });
      await call("POST", { canvas: { session: "s_abcdefgh", layout: { view: "board", slot: "wheel" } } });
    });
    await withServer(home, async (call) => {
      expect((await call("GET")).body).toEqual({
        ok: true,
        data: { panes: { sidebar: 312, inspector: 344 }, inspectorRail: true, canvas: { s_abcdefgh: { view: "board", slot: "wheel" } } },
      });
    });
  });

  test("refuses a width off the scale, an unknown field and an unknown view", async () => {
    await withServer(mkdtempSync(join(tmpdir(), "bs-prefs-")), async (call) => {
      const bad = [{ panes: { sidebar: 40 } }, { theme: "dark" }, { canvas: { session: "s_abcdefgh", layout: { view: "grid", slot: null } } }];
      expect(await Promise.all(bad.map(async (b) => (await call("POST", b)).status))).toEqual([400, 400, 400]);
      expect((await call("GET")).body.data.panes).toEqual({ sidebar: null, inspector: null });
    });
  });

  test("skips stored rows it can't read instead of trusting them", () => {
    const rows = [
      { key: "pane.sidebar", json: "264" },
      { key: "pane.inspector", json: '"wide"' },
      { key: "inspector.rail", json: "{" },
      { key: "canvas.s_abcdefgh", json: '{"view":"stage","slot":null}' },
      { key: "canvas.s_zzzzzzzz", json: '{"view":"zoom"}' },
    ];
    expect(readPrefs(rows)).toEqual({ panes: { sidebar: 264, inspector: null }, inspectorRail: false, canvas: { s_abcdefgh: { view: "stage", slot: null } } });
  });
});

describe("applyPrefs", () => {
  test("changes only what the patch names, as the server stores it", () => {
    const before = readPrefs([
      { key: "pane.sidebar", json: "264" },
      { key: "canvas.s_abcdefgh", json: '{"view":"stage","slot":"wheel"}' },
    ]);
    const patch = { panes: { inspector: 320 }, canvas: { session: "s_zzzzzzzz" as SessionId, layout: { view: "board" as const, slot: null } } };
    expect(applyPrefs(before, patch)).toEqual({
      panes: { sidebar: 264, inspector: 320 },
      inspectorRail: false,
      canvas: { s_abcdefgh: { view: "stage", slot: "wheel" }, s_zzzzzzzz: { view: "board", slot: null } },
    });
  });
});
