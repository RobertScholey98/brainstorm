import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from "electron";
import { join } from "node:path";
import { solidColours } from "../core/design";
import { brainstormHome } from "../server/appData";
import { startServer, type RunningServer } from "../server/index";

const home = brainstormHome();
// Electron's profile defaults to %APPDATA%\<name>, which is BRAINSTORM_HOME's default too. Keeping it under home also
// scopes the single-instance lock to one home, so a test app on a temp home never focuses Rob's window.
app.setPath("userData", join(home, "electron"));

/** The app draws its own header; the native buttons overlay its right end in the header's own colours. */
const HEADER_HEIGHT = 48;
const theme = () => solidColours(nativeTheme.shouldUseDarkColors ? "dark" : "light");
const overlay = () => ({ color: theme()["app"], symbolColor: theme()["fg"], height: HEADER_HEIGHT });

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

  let server: RunningServer;
  try {
    server = await startServer({ home });
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
    titleBarStyle: "hidden",
    titleBarOverlay: overlay(),
    backgroundColor: theme()["app"],
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const shown = window;
  // The page follows prefers-color-scheme, which is the same setting, so the overlay needs no word from the renderer.
  nativeTheme.on("updated", () => {
    shown.setTitleBarOverlay(overlay());
    shown.setBackgroundColor(theme()["app"] ?? "#000000");
  });
  const contents = window.webContents;
  // The renderer has no preload, so Show in folder is a link to /reveal-export/<file> that never opens a window.
  contents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    const file = decodeURIComponent(/^\/reveal-export\/([^/]+)$/.exec(target.pathname)?.[1] ?? "");
    if (target.origin === origin && /^[\w.-]+\.html$/.test(file)) shell.showItemInFolder(join(home, "exports", file));
    else if (/^https?:$/.test(target.protocol) && target.origin !== origin) void shell.openExternal(url);
    return { action: "deny" };
  });
  // will-frame-navigate also covers the canvas iframe, which block code could otherwise point at any URL.
  contents.on("will-frame-navigate", (event) => {
    if (new URL(event.url).origin !== origin) event.preventDefault();
  });
  await window.loadURL(server.url);
}
