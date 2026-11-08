import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, session, shell, type BrowserWindowConstructorOptions, type Rectangle, type WebContents } from "electron";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { solidColours } from "../core/design";
import { packageRoot } from "../core/packageRoot";
import { installSkill, SKILL_NAME } from "../core/skillInstall";
import { OPENABLE, type Openable, type SkillHost } from "../core/about";
import type { AppSettings } from "../core/prefs";
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
    return /\.(?:html|css|json)$/.test(file) && listed ? file : null;
  } catch {
    return null;
  }
}

/**
 * The app draws its own header. On Windows and Linux the native buttons overlay its right end in the header's own
 * colours, 8 px shorter than the header: the inset card starts right under the header, and a full-height overlay drew
 * over the card's top edge and corner. The 8 px matches the card's gutter at the window's right and bottom. On macOS
 * the traffic lights sit at the header's left end, 16 px in and centred on it, as T3 Code places them, and the page
 * leaves them room (styles.css, data-traffic-lights).
 */
const HEADER_HEIGHT = 48;
const OVERLAY_HEIGHT = HEADER_HEIGHT - 8;
const MAC = process.platform === "darwin";
const TRAFFIC_LIGHT_RADIUS = 7;
const theme = () => solidColours(nativeTheme.shouldUseDarkColors ? "dark" : "light");
const overlay = () => ({ color: theme()["app"], symbolColor: theme()["fg"], height: OVERLAY_HEIGHT });
const titleBar = (): Pick<BrowserWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"> =>
  MAC
    ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: HEADER_HEIGHT / 2 - TRAFFIC_LIGHT_RADIUS } }
    : { titleBarStyle: "hidden", titleBarOverlay: overlay() };

/** Where the preview window was last, and whether it was full screen, so it comes back on the screen Rob gave it. */
const previewPlace = join(home, "electron", "preview-window.json");
type Place = { readonly bounds: Rectangle; readonly fullScreen: boolean };

function readPlace(): Place | null {
  try {
    const p = JSON.parse(readFileSync(previewPlace, "utf8")) as Place;
    const { x, y, width, height } = p.bounds;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    // A screen that has since gone would put the window out of reach, so it must still overlap one.
    const seen = screen.getAllDisplays().some(({ workArea: a }) => x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y);
    return seen ? { bounds: p.bounds, fullScreen: p.fullScreen === true } : null;
  } catch {
    return null;
  }
}

function writePlace(window: BrowserWindow): void {
  try {
    writeFileSync(previewPlace, JSON.stringify({ bounds: window.getNormalBounds(), fullScreen: window.isFullScreen() } satisfies Place));
  } catch {
    // Not keeping its place is no reason to interrupt Rob.
  }
}

/**
 * An installed app keeps ~/.claude/skills/use-brainstorm on the version it shipped with, so agents can drive it. A
 * BRAINSTORM_HOME marks a test or otherwise isolated app, which leaves the user's skills alone.
 */
const claudeDir = join(homedir(), ".claude");
const skill: SkillHost | null =
  app.isPackaged && !process.env.BRAINSTORM_HOME
    ? {
        target: join(claudeDir, "skills", SKILL_NAME),
        backups: join(claudeDir, "skill-backups"),
        install: () => installSkill(fileURLToPath(new URL(`skills/${SKILL_NAME}`, packageRoot())), claudeDir),
      }
    : null;

function installBundledSkill(host: SkillHost): void {
  try {
    const result = host.install();
    if (result.kind === "installed") console.error(`installed the ${SKILL_NAME} skill to ${result.target}${result.backup ? `; the old copy is in ${result.backup}` : ""}`);
  } catch (e) {
    console.error(`couldn't install the ${SKILL_NAME} skill: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The folders Settings opens, by the name its link carries, so a link can't open any other. */
const FOLDERS: Record<Openable, string | null> = {
  home,
  exports,
  skill: skill?.target ?? null,
  "skill-backups": skill?.backups ?? null,
};
const folderOf = (pathname: string): string | null => {
  const name = /^\/open-folder\/([a-z-]+)$/.exec(pathname)?.[1];
  return name !== undefined && (OPENABLE as readonly string[]).includes(name) ? FOLDERS[name as Openable] : null;
};

// Windows shows a notification only for an app with a model id, and the installer registers the app under its appId.
if (process.platform === "win32") app.setAppUserModelId("io.github.robertscholey98.brainstorm");

if (app.requestSingleInstanceLock()) void run();
else app.quit();

async function run(): Promise<void> {
  let window: BrowserWindow | null = null;
  let preview: BrowserWindow | null = null;
  app.on("second-instance", () => {
    if (window === null) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  await app.whenReady();
  Menu.setApplicationMenu(null);

  let server: RunningServer;
  let settings: AppSettings | null = null;
  try {
    // The renderer has no preload, so the window asks for a folder through the server, which opens the dialog here.
    const pickFolder = async (): Promise<string | null> => {
      const options = { title: "Add a design system", buttonLabel: "Add design system", properties: ["openDirectory" as const] };
      const picked = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    };
    const updates = createUpdater();
    // The theme Rob picks is the native one, so the pages' prefers-color-scheme, the canvas frames and the title bar
    // overlay all follow it, the same way they follow the OS.
    const onSettings = (next: AppSettings) => {
      settings = next;
      nativeTheme.themeSource = next.theme;
      updates.setAutoDownload(next.autoUpdate);
    };
    server = await startServer({ home, updates, pickFolder, skill: skill ?? undefined, onSettings });
  } catch (e) {
    dialog.showErrorBox("Brainstorm couldn't start", e instanceof Error ? e.message : String(e));
    app.exit(1);
    return;
  }
  if (skill !== null && (settings as AppSettings | null)?.skillUpdate !== false) installBundledSkill(skill);
  const origin = new URL(server.url).origin;
  // Copy phrase writes the clipboard, Present fills the screen and a brainstorm that moved in the background raises a
  // notification, from the window; the canvas frame and everything else stay denied.
  const ALLOWED = new Set(["clipboard-sanitized-write", "fullscreen", "notifications"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) =>
    callback(ALLOWED.has(permission) && details.isMainFrame && new URL(details.requestingUrl).origin === origin),
  );
  // The preview window's page is the renderer's, told by its hash which window it is (ADR 007).
  const previewUrl = `${server.url}&window=preview`;

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
  // The preview window lives and dies with the main one.
  shown.on("close", () => preview?.close());

  /**
   * The rules both windows' pages live under. A link the page opens never opens a window: Show in folder and the
   * preview window's commands are links the main process acts on, and anything else on the web goes to the browser.
   * Neither page nor the canvas frame in it may leave the server's origin, and a page that loads again without its
   * token goes back to the URL that carries it.
   */
  const guard = (contents: WebContents, url: string) => {
    contents.setWindowOpenHandler(({ url: opened }) => {
      const target = new URL(opened);
      const command = target.origin === origin ? /^\/preview-window\/(open|close|fullscreen)$/.exec(target.pathname)?.[1] : undefined;
      const file = target.origin === origin ? exported(target.pathname) : null;
      const folder = target.origin === origin ? folderOf(target.pathname) : null;
      if (target.origin === origin && target.pathname === "/main-window/focus") {
        // A notification's click brings back the window it came from.
        if (shown.isMinimized()) shown.restore();
        shown.show();
        shown.focus();
      } else if (folder !== null) {
        // A folder nothing has written yet, such as skill-backups before the first backup, opens its parent instead.
        void shell.openPath(existsSync(folder) ? folder : dirname(folder));
      } else if (command === "open") openPreview();
      else if (command === "close") preview?.close();
      else if (command === "fullscreen") {
        const w = openPreview();
        w.setFullScreen(!w.isFullScreen());
      } else if (file) shell.showItemInFolder(join(exports, file));
      else if (/^https?:$/.test(target.protocol) && target.origin !== origin) void shell.openExternal(opened);
      return { action: "deny" };
    });
    // will-frame-navigate also covers the canvas iframe, which block code could otherwise point at any URL.
    contents.on("will-frame-navigate", (event) => {
      if (new URL(event.url).origin !== origin) event.preventDefault();
    });
    // The page keeps the UI token only in memory and wipes it from the URL, so a page that loads again (a reload, or a
    // renderer brought back after a crash) would come up without it. Each such load goes back to the URL that carries it.
    contents.on("did-navigate", (_event, at) => {
      const target = new URL(at);
      if (target.origin === origin && !target.hash.startsWith("#ui=")) void contents.loadURL(url);
    });
    contents.on("render-process-gone", (_event, details) => {
      if (!closing && details.reason !== "clean-exit") void contents.loadURL(url);
    });
  };

  /** Brings the preview window forward, opening it where it was last if it isn't open. */
  const openPreview = (): BrowserWindow => {
    if (preview !== null) {
      if (preview.isMinimized()) preview.restore();
      preview.show();
      preview.focus();
      return preview;
    }
    const place = readPlace();
    const opened = new BrowserWindow({
      ...(place?.bounds ?? { width: 1280, height: 800 }),
      minWidth: 360,
      minHeight: 360,
      title: "Brainstorm preview",
      autoHideMenuBar: true,
      backgroundColor: theme()["app"],
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    preview = opened;
    if (place?.fullScreen) opened.setFullScreen(true);
    guard(opened.webContents, previewUrl);
    // F11 fills the screen, as in a browser, and Escape leaves it, wherever focus is, the canvas frame included.
    opened.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if (input.key === "F11") {
        event.preventDefault();
        opened.setFullScreen(!opened.isFullScreen());
      } else if (input.key === "Escape" && opened.isFullScreen()) opened.setFullScreen(false);
    });
    const repaint = () => opened.setBackgroundColor(theme()["app"] ?? "#000000");
    nativeTheme.on("updated", repaint);
    opened.on("close", () => writePlace(opened));
    opened.on("closed", () => {
      nativeTheme.off("updated", repaint);
      if (preview === opened) preview = null;
    });
    void opened.loadURL(previewUrl);
    return opened;
  };
  // macOS hides the traffic lights in full screen, so the page gives their room back. The renderer has no preload, so
  // the main process marks the page itself.
  if (MAC) {
    const mark = (on: boolean) => void contents.executeJavaScript(`document.documentElement.toggleAttribute("data-fullscreen", ${on})`).catch(() => {});
    shown.on("enter-full-screen", () => mark(true));
    shown.on("leave-full-screen", () => mark(false));
    contents.on("did-finish-load", () => mark(shown.isFullScreen()));
  }
  // The renderer has no preload, so Show in folder is a link to /reveal-export/<file> that never opens a window.
  guard(contents, server.url);
  await window.loadURL(server.url);
}
