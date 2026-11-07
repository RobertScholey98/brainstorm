/**
 * The installed app updating itself from GitHub releases, as T3 Code does: electron-updater checks the release feed,
 * downloads a newer installer in the background, and Rob restarts into it from the sidebar. An update he doesn't
 * restart for installs when he next quits. This module is the state and its transitions; src/electron/updater.ts
 * drives them from electron-updater's events, and the server hands the state to the window.
 */

export type AppUpdateState =
  /** This build can't update itself, and `reason` says why. */
  | { readonly kind: "off"; readonly reason: string }
  /** Up to date as of `checkedAt`, or not checked yet. */
  | { readonly kind: "idle"; readonly checkedAt: string | null }
  | { readonly kind: "checking" }
  | { readonly kind: "downloading"; readonly version: string; readonly percent: number }
  /** Downloaded; a restart installs it, and so does the next quit. */
  | { readonly kind: "ready"; readonly version: string }
  | { readonly kind: "installing"; readonly version: string }
  /** `version` is a downloaded update that can still install, or null when nothing was downloaded. */
  | { readonly kind: "failed"; readonly message: string; readonly version: string | null };

export type AppUpdateEvent =
  | { readonly kind: "checking" }
  | { readonly kind: "found"; readonly version: string }
  | { readonly kind: "none"; readonly at: string }
  | { readonly kind: "progress"; readonly percent: number }
  | { readonly kind: "downloaded"; readonly version: string }
  | { readonly kind: "install" }
  | { readonly kind: "error"; readonly message: string };

/** The version a restart would install, if there is one. */
export function installable(state: AppUpdateState): string | null {
  return state.kind === "ready" || state.kind === "failed" ? state.version : null;
}

export function nextUpdateState(state: AppUpdateState, event: AppUpdateEvent): AppUpdateState {
  if (state.kind === "off") return state;
  switch (event.kind) {
    case "checking":
      // A downloaded update stays ready while a later poll looks for a newer one.
      return state.kind === "idle" || (state.kind === "failed" && state.version === null) ? { kind: "checking" } : state;
    case "found":
      if (state.kind === "installing" || installable(state) === event.version) return state;
      return state.kind === "downloading" && state.version === event.version ? state : { kind: "downloading", version: event.version, percent: 0 };
    case "none":
      return installable(state) === null && state.kind !== "downloading" ? { kind: "idle", checkedAt: event.at } : state;
    case "progress":
      return state.kind === "downloading" ? { ...state, percent: Math.max(0, Math.min(100, Math.floor(event.percent))) } : state;
    case "downloaded":
      return { kind: "ready", version: event.version };
    case "install": {
      const version = installable(state);
      return version === null ? state : { kind: "installing", version };
    }
    case "error": {
      // electron-updater reports a failed background check the same way, which says nothing a ready update needs.
      if (state.kind === "ready") return state;
      const version = state.kind === "installing" ? state.version : installable(state);
      return { kind: "failed", message: event.message, version };
    }
  }
}

/** What the server needs from the updater: the state, its changes, and the restart. */
export type AppUpdates = {
  state(): AppUpdateState;
  subscribe(listener: (state: AppUpdateState) => void): () => void;
  /** Starts quitting into the downloaded installer; false when there's none, or a restart already started. */
  install(): boolean;
};

/** The headless server has no installer to update. */
export function updatesOff(reason: string): AppUpdates {
  const state: AppUpdateState = { kind: "off", reason };
  return { state: () => state, subscribe: () => () => {}, install: () => false };
}

export type UpdateHost = {
  readonly packaged: boolean;
  /** process.platform; the renderer's types have no NodeJS namespace to name it by. */
  readonly platform: string;
  /** BRAINSTORM_HOME is set, which marks a test or otherwise isolated app. */
  readonly isolatedHome: boolean;
  readonly disabledByEnv: boolean;
  /** resources/app-update.yml exists; electron-builder writes it from electron-builder.yml's publish block. */
  readonly hasFeed: boolean;
  /** resources/package-type on Linux, which electron-builder writes for the .deb. */
  readonly linuxPackage: string | null;
};

/** Why this build can't update itself, or null when it can. */
export function updateOffReason(host: UpdateHost): string | null {
  if (!host.packaged) return "Updates come with the installed app, not a build run from source.";
  if (host.isolatedHome) return "Updates are off while BRAINSTORM_HOME points at another home.";
  if (host.disabledByEnv) return "BRAINSTORM_DISABLE_AUTO_UPDATE turned updates off.";
  if (!host.hasFeed) return "This build has no update feed.";
  // Squirrel.Mac only installs a build signed by the same Developer ID, and the macOS builds are ad hoc signed for now.
  if (host.platform === "darwin") return "The macOS build can't update itself until it's signed. Download the new .pkg from the releases page.";
  if (host.platform === "linux" && host.linuxPackage !== "deb") return "On Linux only the .deb updates itself. Download the new archive from the releases page.";
  return null;
}
