import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { applyPrefs, DEFAULT_SETTINGS, readPrefs, stripOpen } from "../src/core/prefs";
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
  test("pane widths, the Inspector rail, the history strip, a brainstorm's canvas view, home's filters and the preview window survive a restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "bs-prefs-"));
    await withServer(home, async (call) => {
      expect((await call("GET")).body).toEqual({
        ok: true,
        data: { panes: { sidebar: null, inspector: null }, inspectorRail: false, historyStrip: {}, canvas: {}, home: { status: "active", projects: [], sort: "recent" }, preview: { look: "clean", here: true }, settings: DEFAULT_SETTINGS },
      });
      await call("POST", { panes: { sidebar: 312 } });
      await call("POST", { panes: { inspector: 344 }, inspectorRail: true });
      await call("POST", { canvas: { session: "s_abcdefgh", layout: { view: "board", slot: "wheel" } } });
      await call("POST", { home: { status: "settled", projects: ["proj-a"], sort: "title" } });
      await call("POST", { historyStrip: { session: "s_abcdefgh", open: false } });
      await call("POST", { historyStrip: { session: "s_zzzzzzzz", open: true } });
      await call("POST", { preview: { look: "working", here: false } });
    });
    await withServer(home, async (call) => {
      expect((await call("GET")).body).toEqual({
        ok: true,
        data: {
          panes: { sidebar: 312, inspector: 344 },
          inspectorRail: true,
          historyStrip: { s_abcdefgh: false, s_zzzzzzzz: true },
          canvas: { s_abcdefgh: { view: "board", slot: "wheel" } },
          home: { status: "settled", projects: ["proj-a"], sort: "title" },
          preview: { look: "working", here: false },
          settings: DEFAULT_SETTINGS,
        },
      });
    });
  });

  test("refuses a width off the scale, an unknown field and an unknown view", async () => {
    await withServer(mkdtempSync(join(tmpdir(), "bs-prefs-")), async (call) => {
      const bad = [
        { panes: { sidebar: 40 } },
        { theme: "dark" },
        { canvas: { session: "s_abcdefgh", layout: { view: "grid", slot: null } } },
        { home: { status: "archived", projects: [], sort: "recent" } },
        { home: { status: "active", projects: [], sort: "recent", search: "wheel" } },
        { historyStrip: false },
        { historyStrip: { session: "wheel", open: true } },
        { preview: { look: "present", here: true } },
        { preview: { look: "clean" } },
      ];
      expect(await Promise.all(bad.map(async (b) => (await call("POST", b)).status)), "the search text is never stored").toEqual([400, 400, 400, 400, 400, 400, 400, 400, 400]);
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
      { key: "home.query", json: '{"status":"snoozed","projects":[],"sort":"recent"}' },
      { key: "history.strip", json: "false" },
      { key: "strip.s_abcdefgh", json: "true" },
      { key: "strip.s_zzzzzzzz", json: '"open"' },
      { key: "preview.window", json: '{"look":"stage","here":true}' },
      { key: "setting.theme", json: '"dark"' },
      { key: "setting.varyCount", json: "12" },
      { key: "setting.notifications", json: '"loud"' },
      { key: "setting.constructor", json: "true" },
    ];
    expect(readPrefs(rows)).toEqual({
      panes: { sidebar: 264, inspector: null },
      inspectorRail: false,
      historyStrip: { s_abcdefgh: true },
      canvas: { s_abcdefgh: { view: "stage", slot: null } },
      home: { status: "active", projects: [], sort: "recent" },
      preview: { look: "clean", here: true },
      settings: { ...DEFAULT_SETTINGS, theme: "dark" },
    });
  });
});

describe("applyPrefs", () => {
  test("changes only what the patch names, as the server stores it", () => {
    const before = readPrefs([
      { key: "pane.sidebar", json: "264" },
      { key: "canvas.s_abcdefgh", json: '{"view":"stage","slot":"wheel"}' },
      { key: "strip.s_abcdefgh", json: "true" },
    ]);
    const patch = {
      panes: { inspector: 320 },
      historyStrip: { session: "s_zzzzzzzz" as SessionId, open: false },
      canvas: { session: "s_zzzzzzzz" as SessionId, layout: { view: "board" as const, slot: null } },
      settings: { notifications: "off" as const, varyCount: undefined },
    };
    expect(applyPrefs(before, patch)).toEqual({
      panes: { sidebar: 264, inspector: 320 },
      inspectorRail: false,
      historyStrip: { s_abcdefgh: true, s_zzzzzzzz: false },
      canvas: { s_abcdefgh: { view: "stage", slot: "wheel" }, s_zzzzzzzz: { view: "board", slot: null } },
      home: { status: "active", projects: [], sort: "recent" },
      preview: { look: "clean", here: true },
      settings: { ...DEFAULT_SETTINGS, notifications: "off" },
    });
  });
});

describe("stripOpen", () => {
  test("a strip Rob hasn't set is shut with one iteration and open from the second, and his own choice wins either way", () => {
    expect([stripOpen(undefined, 0), stripOpen(undefined, 1), stripOpen(undefined, 2), stripOpen(undefined, 7)]).toEqual([false, false, true, true]);
    expect([stripOpen(true, 1), stripOpen(false, 2), stripOpen(false, 1), stripOpen(true, 5)]).toEqual([true, false, false, true]);
  });

  test("Settings can open or shut every strip Rob hasn't set, and his own choice still wins", () => {
    expect([stripOpen(undefined, 1, "open"), stripOpen(undefined, 5, "closed"), stripOpen(false, 1, "open"), stripOpen(true, 5, "closed")]).toEqual([true, false, false, true]);
  });
});
