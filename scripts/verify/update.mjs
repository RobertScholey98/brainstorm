// The in-app update, end to end on Windows: installs this build's NSIS installer as version A into a temp folder, serves
// an A+1 installer from a local feed (BRAINSTORM_UPDATE_FEED, in place of GitHub's), waits for the sidebar's Restart to
// update, presses it, and checks that the installed app is now A+1 and runs. Then it uninstalls. npm run verify:update
//
// The installer reopens the app with the user's environment, which has no BRAINSTORM_HOME, so on a test feed the app
// doesn't ask it to; this script opens the updated app itself, on the temp home.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright";
import { build, checks, root } from "./electron.mjs";

if (process.platform !== "win32") {
  console.log("skip: the update check drives the NSIS installer, so it runs on Windows");
  process.exit(0);
}

const { check, finish } = checks();
const work = mkdtempSync(join(tmpdir(), "bs-update-"));
const home = join(work, "home");
const installDir = join(work, "installed");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const next = version.replace(/\d+$/, (patch) => String(Number(patch) + 1));

build();
const pack = (v) => {
  const out = join(work, `release-${v}`);
  execFileSync(
    process.execPath,
    [join(root, "node_modules", "electron-builder", "cli.js"), "--win", "--publish", "never", `-c.extraMetadata.version=${v}`, `-c.directories.output=${out}`],
    { cwd: root, stdio: "inherit" },
  );
  return out;
};
const from = pack(version);
const feedDir = pack(next);

const feed = createServer((req, res) => {
  const file = join(feedDir, decodeURIComponent(new URL(req.url, "http://x").pathname.slice(1)));
  if (!existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200);
  createReadStream(file).pipe(res);
});
await new Promise((r) => feed.listen(0, "127.0.0.1", r));
const feedUrl = `http://127.0.0.1:${feed.address().port}/`;

const health = async () => {
  try {
    const { port } = JSON.parse(readFileSync(join(home, "api.json"), "utf8"));
    return (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).data;
  } catch {
    return null;
  }
};
const until = async (read, ms) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
};

const uninstaller = join(installDir, "Uninstall Brainstorm.exe");
const installedVersion = () => {
  try {
    return JSON.parse(readFileSync(join(installDir, "resources", "app", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
};
const { ELECTRON_RUN_AS_NODE: _, ...baseEnv } = process.env;
const open = () =>
  _electron.launch({ executablePath: join(installDir, "Brainstorm.exe"), env: { ...baseEnv, BRAINSTORM_HOME: home, BRAINSTORM_UPDATE_FEED: feedUrl } });
let app = null;
try {
  // /D must come last, unquoted.
  execFileSync(join(from, `Brainstorm-${version}-win-x64.exe`), ["/S", `/D=${installDir}`], { stdio: "inherit" });
  app = await open();
  const window = await app.firstWindow();
  check("the installed app runs version A", (await until(health, 30_000))?.version, version);

  // The first check runs 15 s after start; the download is the whole installer.
  const button = window.locator("[data-update-install]");
  await button.waitFor({ timeout: 120_000 });
  check("the sidebar offers the downloaded update", await button.textContent(), "Restart to update");
  await window.screenshot({ path: join(root, "test-results", "update", "ready.png") });

  const closed = new Promise((r) => app.once("close", r));
  await button.click();
  await closed;
  app = null;
  check("the installer puts version A+1 in place", await until(() => (installedVersion() === next ? next : null), 120_000), next);

  app = await open();
  await app.firstWindow();
  check("the updated app runs version A+1", (await until(async () => ((await health())?.version === next ? next : null), 30_000)), next);
} finally {
  feed.close();
  await app?.close().catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  if (existsSync(uninstaller)) execFileSync(uninstaller, ["/S"], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 3000));
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
finish();
