import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from "electron";
import { join } from "node:path";
import { brainstormHome } from "../server/appData";
import { startServer, type RunningServer } from "../server/index";

const home = brainstormHome();
// Electron's profile defaults to %APPDATA%\<name>, which is BRAINSTORM_HOME's default too. Keeping it under home also
// scopes the single-instance lock to one home, so a test app on a temp home never focuses Rob's window.
app.setPath("userData", join(home, "electron"));

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
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  let server: RunningServer;
  try {
    server = await startServer({ home });
  } catch (e) {
    dialog.showErrorBox("Brainstorm couldn't start", e instanceof Error ? e.message : String(e));
    app.exit(1);
    return;
  }
  const origin = new URL(server.url).origin;

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
    minWidth: 960,
    minHeight: 600,
    title: "Brainstorm",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#17181b" : "#f7f7f8",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && new URL(url).origin !== origin) void shell.openExternal(url);
    return { action: "deny" };
  });
  // will-frame-navigate also covers the canvas iframe, which block code could otherwise point at any URL.
  contents.on("will-frame-navigate", (event) => {
    if (new URL(event.url).origin !== origin) event.preventDefault();
  });
  await window.loadURL(server.url);
}
