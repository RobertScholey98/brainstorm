import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell, type BrowserWindowConstructorOptions } from "electron";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { solidColours } from "../core/design";
import { packageRoot } from "../core/packageRoot";
import { installSkill, SKILL_NAME } from "../core/skillInstall";
import { brainstormHome, exportsDir } from "../server/appData";
import { startServer, type RunningServer } from "../server/index";
import { createUpdater } from "./updater";

const home = brainstormHome();
// Electron's profile defaults to %APPDATA%\<name>, which is BRAINSTORM_HOME's default too. Keeping it under home also
// scopes the single-instance lock to one home, so a test app on a temp home never focuses Rob's window.
app.setPath("userData", join(home, "electron"));

const exports = exportsDir(home);

/** The file a /reveal-export/<file> link names, only when the exports folder holds a file of exactly that name, so a link can never reach a path outside it. */
function exported(pathname: string): string | null {
  try {
    const file = decodeURIComponent(/^\/reveal-export\/([^/]+)$/.exec(pathname)?.[1] ?? "");
    const listed = readdirSync(exports, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name === file);
    return file.endsWith(".html") && listed ? file : null;
  } catch {
    return null;
  }
}

/**
 * The app draws its own header. On Windows and Linux the native buttons overlay its right end in the header's own
 * colours. On macOS the traffic lights sit at its left end, 16 px in and centred on it, as T3 Code places them, and the
 * page leaves them room (styles.css, data-traffic-lights).
 */
const HEADER_HEIGHT = 48;
const MAC = process.platform === "darwin";
const TRAFFIC_LIGHT_RADIUS = 7;
const theme = () => solidColours(nativeTheme.shouldUseDarkColors ? "dark" : "light");
const overlay = () => ({ color: theme()["app"], symbolColor: theme()["fg"], height: HEADER_HEIGHT });
const titleBar = (): Pick<BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"> =>
  MAC
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: HEADER_HEIGHT / 2 - TRAFFIC_LIGHT_RADIUS } }
    : { titleBarStyle: "hidden", titleBarOverlay: overlay() };

/** An installed app keeps ~/.claude/skills/use-brainstorm on the version it shipped with, so agents can drive it. */
function installBundledSkill(): void {
  try {
    const source = fileURLToPath(new URL(`skills/${SKILL_NAME}`, packageRoot()));
    const result = installSkill(source, join(homedir(), ".claude"));
    if (result.kind === "installed") console.error(`installed the ${SKILL_NAME} skill to ${result.target}${result.backup ? `; the old copy is in ${result.backup}` : ""}`);
  } catch (e) {
    console.error(`couldn't install the ${SKILL_NAME} skill: ${e instanceof Error ? e.message : String(e)}`);
  }
}

if (app.requestSingleInstanceLock()) void run();
else app.quit();

async function run(): Promise<void> {
  let window: BrowserWindow | null = null;
  app.on("second-instance", () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  await app.whenReady();
  Menu.setApplicationMenu(null);
  // A BRAINSTORM_HOME marks a test or otherwise isolated app, which leaves the user's skills alone.
  if (app.isPackaged && !process.env.BRAINSTORM_HOME) installBundledSkill();

  let server: RunningServer;
  try {
    server = await startServer({ home, updates: createUpdater() });
  } catch (e) {
    dialog.showErrorBox("Brainstorm couldn't start", e instanceof Error ? e.message : String(e));
    app.exit(1);
    return;
  }
  const origin = new URL(server.url).origin;
  // Copy phrase writes the clipboard from the window; the canvas frame and everything else stay denied.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(permission === "clipboard-sanitized-write" && details.isMainFrame && new URL(details.requestingUrl).origin === origin),
  );

  let closing = false;
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void server.close().finally(() => app.exit(0));
  });
  app.on("window-all-closed", () => app.quit());

  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "Brainstorm",
    ...titleBar(),
    backgroundColor: theme()["app"],
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const shown = window;
  // The page follows prefers-color-scheme, which is the same setting, so the overlay needs no word from the renderer.
  nativeTheme.on("updated", () => {
    if (!MAC) shown.setTitleBarOverlay(overlay());
    shown.setBackgroundColor(theme()["app"] ?? "#000000");
  });
  const contents = window.webContents;
  // macOS hides the traffic lights in full screen, so the page gives their room back. The renderer has no preload, so
  // the main process marks the page itself.
  if (MAC) {
    const mark = (on: boolean) => void contents.executeJavaScript(`document.documentElement.toggleAttribute("data-fullscreen", ${on})`).catch(() => {});
    shown.on("enter-full-screen", () => mark(true));
    shown.on("leave-full-screen", () => mark(false));
    contents.on("did-finish-load", () => mark(shown.isFullScreen()));
  }
  // The renderer has no preload, so Show in folder is a link to /reveal-export/<file> that never opens a window.
  contents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    const file = target.origin === origin ? exported(target.pathname) : null;
    if (file) shell.showItemInFolder(join(exports, file));
    else if (/^https?:$/.test(target.protocol) && target.origin !== origin) void shell.openExternal(url);
    return { action: "deny" };
  });
  // will-frame-navigate also covers the canvas iframe, which block code could otherwise point at any URL.
  contents.on("will-frame-navigate", (event) => {
    if (new URL(event.url).origin !== origin) event.preventDefault();
  });
  await window.loadURL(server.url);
}
