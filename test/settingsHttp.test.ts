import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { canCheck, nextUpdateState, type AppUpdateEvent, type AppUpdates, type AppUpdateState } from "../src/core/appUpdate";
import type { SkillHost } from "../src/core/about";
import { DEFAULT_SETTINGS, type AppSettings } from "../src/core/prefs";
import { startServer, type ServerOptions } from "../src/server/index";
import { FakeBridge } from "./fakeBridge";

async function withServer(options: Partial<ServerOptions>, fn: (call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>) => Promise<void>) {
  const home = options.home ?? mkdtempSync(join(tmpdir(), "bs-settings-"));
  const server = await startServer({ bridge: new FakeBridge(), trackerMs: 60_000, ...options, home });
  try {
    await fn(async (method, path, body) => {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
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

describe("settings", () => {
  test("the main process hears the stored settings at start and each change after, and a restart keeps them", async () => {
    const home = mkdtempSync(join(tmpdir(), "bs-settings-"));
    const heard: AppSettings[] = [];
    await withServer({ home, onSettings: (s) => heard.push(s) }, async (call) => {
      expect(heard).toEqual([DEFAULT_SETTINGS]);
      const saved = await call("POST", "/v1/ui/prefs", { settings: { theme: "dark", autoUpdate: false } });
      expect(saved.body.data.settings).toEqual({ ...DEFAULT_SETTINGS, theme: "dark", autoUpdate: false });
      // A layout save changes no setting, so the main process isn't told.
      await call("POST", "/v1/ui/prefs", { panes: { sidebar: 300 } });
      expect(heard).toEqual([DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, theme: "dark", autoUpdate: false }]);
      expect((await call("POST", "/v1/ui/prefs", { settings: { varyCount: 9 } })).status).toBe(400);
      expect((await call("POST", "/v1/ui/prefs", { settings: { colour: "red" } })).status).toBe(400);
    });
    const restarted: AppSettings[] = [];
    await withServer({ home, onSettings: (s) => restarted.push(s) }, async () => {
      expect(restarted).toEqual([{ ...DEFAULT_SETTINGS, theme: "dark", autoUpdate: false }]);
    });
  });

  test("about names the version, the folders, and the skill only where the app manages it", async () => {
    const home = mkdtempSync(join(tmpdir(), "bs-settings-"));
    await withServer({ home }, async (call) => {
      const { body } = await call("GET", "/v1/ui/about");
      expect(body.data).toMatchObject({ home, exports: join(home, "exports"), skill: null, platform: process.platform });
      expect(body.data.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(await call("POST", "/v1/ui/skill/install")).toEqual({
        status: 503,
        body: { ok: false, error: { code: "unavailable", message: "Only the installed Brainstorm app on your own home manages the agent skill." } },
      });
    });

    let installs = 0;
    const skill: SkillHost = { target: "/c/skills/use-brainstorm", backups: "/c/skill-backups", install: () => (installs++, { kind: "current", target: "/c/skills/use-brainstorm" }) };
    await withServer({ skill }, async (call) => {
      expect((await call("GET", "/v1/ui/about")).body.data.skill).toEqual({ target: "/c/skills/use-brainstorm", backups: "/c/skill-backups" });
      expect((await call("POST", "/v1/ui/skill/install")).body).toEqual({ ok: true, data: { kind: "current", target: "/c/skills/use-brainstorm" } });
      expect(installs).toBe(1);
    });
  });

  test("Check for updates starts a check, and a download takes an update a check offered", async () => {
    let state: AppUpdateState = { kind: "idle", checkedAt: null };
    const emit = (event: AppUpdateEvent) => void (state = nextUpdateState(state, event));
    const updates: AppUpdates = {
      state: () => state,
      subscribe: () => () => {},
      check: () => canCheck(state) && (emit({ kind: "checking" }), true),
      download: () => state.kind === "available" && (emit({ kind: "found", version: state.version, download: true }), true),
      setAutoDownload: () => {},
      install: () => false,
    };
    await withServer({ updates }, async (call) => {
      expect((await call("POST", "/v1/ui/update/download")).body.error.message).toBe("There's no update waiting to download.");
      expect((await call("POST", "/v1/ui/update/check")).body).toEqual({ ok: true, data: { kind: "checking" } });
      expect((await call("POST", "/v1/ui/update/check")).body.error.message).toBe("Brainstorm is already checking for, downloading or installing an update.");
      emit({ kind: "found", version: "0.2.0", download: false });
      expect((await call("POST", "/v1/ui/update/download")).body).toEqual({ ok: true, data: { kind: "downloading", version: "0.2.0", percent: 0 } });
    });
    await withServer({}, async (call) => {
      expect((await call("POST", "/v1/ui/update/check")).body.error.message).toBe("The headless server has no app to update.");
    });
  });
});
