import { describe, expect, test } from "vitest";
import { nextUpdateState, updateOffReason, type AppUpdateEvent, type AppUpdateState, type UpdateHost } from "../src/core/appUpdate";

const run = (events: readonly AppUpdateEvent[], from: AppUpdateState = { kind: "idle", checkedAt: null }) => events.reduce(nextUpdateState, from);

describe("app update state", () => {
  test("a found update downloads, then waits for a restart", () => {
    expect(run([{ kind: "checking" }, { kind: "found", version: "0.2.0" }, { kind: "progress", percent: 41.7 }])).toEqual({
      kind: "downloading",
      version: "0.2.0",
      percent: 41,
    });
    expect(run([{ kind: "checking" }, { kind: "found", version: "0.2.0" }, { kind: "downloaded", version: "0.2.0" }])).toEqual({
      kind: "ready",
      version: "0.2.0",
    });
  });

  test("no update leaves it idle with the time it checked", () => {
    expect(run([{ kind: "checking" }, { kind: "none", at: "2026-11-07T20:00:00.000Z" }])).toEqual({ kind: "idle", checkedAt: "2026-11-07T20:00:00.000Z" });
  });

  test("a ready update survives a later poll that finds it again, finds nothing, or fails", () => {
    const ready: AppUpdateState = { kind: "ready", version: "0.2.0" };
    expect(run([{ kind: "checking" }, { kind: "found", version: "0.2.0" }], ready)).toEqual(ready);
    expect(run([{ kind: "checking" }, { kind: "none", at: "x" }], ready)).toEqual(ready);
    expect(run([{ kind: "checking" }, { kind: "error", message: "offline" }], ready)).toEqual(ready);
  });

  test("a newer version found while one is ready downloads in its place", () => {
    expect(run([{ kind: "found", version: "0.3.0" }], { kind: "ready", version: "0.2.0" })).toEqual({ kind: "downloading", version: "0.3.0", percent: 0 });
  });

  test("a failed install keeps the downloaded version, so Rob can restart again", () => {
    const failed = run([{ kind: "install" }, { kind: "error", message: "installer exited 2" }], { kind: "ready", version: "0.2.0" });
    expect(failed).toEqual({ kind: "failed", message: "installer exited 2", version: "0.2.0" });
    expect(nextUpdateState(failed, { kind: "install" })).toEqual({ kind: "installing", version: "0.2.0" });
    // A poll while it waits doesn't throw the download away.
    expect(nextUpdateState(failed, { kind: "checking" })).toEqual(failed);
  });

  test("a failed check has nothing to install, and the next poll checks again", () => {
    const failed = run([{ kind: "checking" }, { kind: "error", message: "offline" }]);
    expect(failed).toEqual({ kind: "failed", message: "offline", version: null });
    expect(nextUpdateState(failed, { kind: "install" })).toEqual(failed);
    expect(nextUpdateState(failed, { kind: "checking" })).toEqual({ kind: "checking" });
  });

  test("off never moves", () => {
    const off: AppUpdateState = { kind: "off", reason: "x" };
    expect(run([{ kind: "checking" }, { kind: "found", version: "0.2.0" }, { kind: "downloaded", version: "0.2.0" }], off)).toBe(off);
  });
});

describe("updateOffReason", () => {
  const windows: UpdateHost = { packaged: true, platform: "win32", isolatedHome: false, disabledByEnv: false, hasFeed: true, linuxPackage: null };

  test("an installed Windows app or .deb updates itself", () => {
    expect(updateOffReason(windows)).toBeNull();
    expect(updateOffReason({ ...windows, platform: "linux", linuxPackage: "deb" })).toBeNull();
  });

  test("names why every other build can't", () => {
    expect(updateOffReason({ ...windows, packaged: false })).toBe("Updates come with the installed app, not a build run from source.");
    expect(updateOffReason({ ...windows, isolatedHome: true })).toBe("Updates are off while BRAINSTORM_HOME points at another home.");
    expect(updateOffReason({ ...windows, disabledByEnv: true })).toBe("BRAINSTORM_DISABLE_AUTO_UPDATE turned updates off.");
    expect(updateOffReason({ ...windows, hasFeed: false })).toBe("This build has no update feed.");
    expect(updateOffReason({ ...windows, platform: "darwin" })).toMatch(/^The macOS build can't update itself/);
    expect(updateOffReason({ ...windows, platform: "linux", linuxPackage: null })).toMatch(/^On Linux only the \.deb/);
  });
});
