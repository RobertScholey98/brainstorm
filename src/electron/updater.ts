import { app } from "electron";
import { autoUpdater as platformUpdater, type AppUpdater } from "electron-updater";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MacZipUpdater } from "./macUpdater";
import { installable, nextUpdateState, updateOffReason, type AppUpdateEvent, type AppUpdates, type AppUpdateState } from "../core/appUpdate";

/** T3 Code's cadence: a first look soon after start, then a poll. Brainstorm releases are rarer, so it polls less. */
const FIRST_CHECK_MS = 15_000;
const POLL_MS = 30 * 60_000;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).split(/\r?\n/, 1)[0] ?? "";

function linuxPackage(): string | null {
  try {
    return readFileSync(join(process.resourcesPath, "package-type"), "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * The installed app's updater. It reads the GitHub feed electron-builder wrote into resources/app-update.yml, downloads
 * a newer release as soon as it finds one, and installs it on Rob's restart or on the next quit.
 */
export function createUpdater(): AppUpdates {
  // A local feed in place of GitHub's, as T3 Code's mock update server is, so scripts/verify/update.mjs can update an
  // installed app on a temp home end to end.
  const testFeed = process.env.BRAINSTORM_UPDATE_FEED || null;
  const reason = updateOffReason({
    packaged: app.isPackaged,
    platform: process.platform,
    isolatedHome: Boolean(process.env.BRAINSTORM_HOME) && testFeed === null,
    disabledByEnv: Boolean(process.env.BRAINSTORM_DISABLE_AUTO_UPDATE),
    hasFeed: testFeed !== null || (app.isPackaged && existsSync(join(process.resourcesPath, "app-update.yml"))),
    linuxPackage: process.platform === "linux" ? linuxPackage() : null,
  });
  let state: AppUpdateState = reason === null ? { kind: "idle", checkedAt: null } : { kind: "off", reason };
  const listeners = new Set<(state: AppUpdateState) => void>();
  const apply = (event: AppUpdateEvent) => {
    const next = nextUpdateState(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener(state);
  };

  // Squirrel.Mac, which electron-updater uses on macOS, only installs a build signed by the same Developer ID.
  const autoUpdater: AppUpdater | null = reason === null ? (process.platform === "darwin" ? new MacZipUpdater() : platformUpdater) : null;
  if (autoUpdater !== null) {
    // electron-updater logs to the console by default, which the packaged app has nowhere to show.
    autoUpdater.logger = null;
    if (testFeed !== null) autoUpdater.setFeedURL({ provider: "generic", url: testFeed });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => apply({ kind: "checking" }));
    autoUpdater.on("update-available", (info) => apply({ kind: "found", version: info.version }));
    autoUpdater.on("update-not-available", () => apply({ kind: "none", at: new Date().toISOString() }));
    autoUpdater.on("download-progress", (progress) => apply({ kind: "progress", percent: progress.percent }));
    autoUpdater.on("update-downloaded", (info) => apply({ kind: "downloaded", version: info.version }));
    autoUpdater.on("error", (e) => apply({ kind: "error", message: errorMessage(e) }));

    const check = () => {
      // A download or an install already under way has nothing to gain from another look.
      if (state.kind === "downloading" || state.kind === "installing") return;
      // The error event reports a failed check too; this only keeps the rejection from going unhandled.
      autoUpdater.checkForUpdates().catch(() => {});
    };
    setTimeout(check, FIRST_CHECK_MS).unref();
    setInterval(check, POLL_MS).unref();
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    install() {
      if (installable(state) === null) return false;
      apply({ kind: "install" });
      // After the HTTP answer goes out. Silent, then reopen the app, as T3 Code does; the quit runs main's before-quit,
      // which closes the server first. An app on a test feed isn't reopened: the Windows installer reopens it with the
      // user's environment, which would bring it back on Rob's own home.
      setImmediate(() => {
        try {
          autoUpdater?.quitAndInstall(true, testFeed === null);
        } catch (e) {
          apply({ kind: "error", message: errorMessage(e) });
        }
      });
      return true;
    },
  };
}
