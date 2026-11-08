// The installed app, end to end. Installs this build as version A and checks that it installs the use-brainstorm skill,
// opened directly and started by the brainstorm command. Then the in-app update: serves an A+1 build from a local feed
// (BRAINSTORM_UPDATE_FEED, in place of GitHub's), waits for the sidebar's Restart to update, presses it, and checks that
// the installed app is now A+1 and runs. Then it uninstalls. npm run verify:update
//
// Windows installs the NSIS installer into a temp folder. macOS installs the .pkg with sudo into /Applications, as Rob's
// Mac would, so it needs passwordless sudo (CI has it) and refuses to run over an installed Brainstorm.
//
// The Windows installer reopens the app with the user's environment, which has no BRAINSTORM_HOME, so on a test feed the
// app doesn't ask to be reopened; this script opens the updated app itself, on the temp home.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright";
import { build, checks, root } from "./electron.mjs";

const mac = process.platform === "darwin";
if (process.platform !== "win32" && !mac) {
  console.log("skip: the update check drives the Windows installer or the Mac app bundle");
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "bs-update-"));
const home = join(work, "home");
const target = mac
  ? {
      dir: "/Applications/Brainstorm.app",
      exe: "/Applications/Brainstorm.app/Contents/MacOS/Brainstorm",
      app: "/Applications/Brainstorm.app/Contents/Resources/app",
    }
  : { dir: join(work, "installed"), exe: join(work, "installed", "Brainstorm.exe"), app: join(work, "installed", "resources", "app") };
const existing = mac ? target.dir : join(process.env.LOCALAPPDATA ?? "", "Programs", "brainstorm");
if (existsSync(existing)) {
  console.log(`refusing to run: ${existing} is an installed Brainstorm, which this check would replace`);
  process.exit(1);
}

const { check, finish } = checks();
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const next = version.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const shots = join(root, "test-results", "update");
mkdirSync(shots, { recursive: true });

build();
const pack = (v) => {
  const out = join(work, `release-${v}`);
  // Ad hoc signed, as CI's unsigned Mac build is, since Apple Silicon won't launch an unsigned app; this Mac's arch only.
  const platform = mac ? ["--mac", `--${process.arch}`, "-c.mac.identity=-", "-c.mac.hardenedRuntime=false"] : ["--win"];
  execFileSync(
    process.execPath,
    [join(root, "node_modules", "electron-builder", "cli.js"), ...platform, "--publish", "never", `-c.extraMetadata.version=${v}`, `-c.directories.output=${out}`],
    { cwd: root, stdio: "inherit", env: { ...process.env, CSC_FOR_PULL_REQUEST: "true", CSC_IDENTITY_AUTO_DISCOVERY: "false" } },
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
const installedVersion = () => {
  try {
    return JSON.parse(readFileSync(join(target.app, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
};
const install = () => {
  if (mac) execFileSync("sudo", ["installer", "-pkg", join(from, `Brainstorm-${version}-mac-${process.arch}.pkg`), "-target", "/"], { stdio: "inherit" });
  // /D must come last, unquoted.
  else execFileSync(join(from, `Brainstorm-${version}-win-x64.exe`), ["/S", `/D=${target.dir}`], { stdio: "inherit" });
};
const uninstall = () => {
  if (mac) execFileSync("sudo", ["rm", "-rf", target.dir, "/usr/local/bin/brainstorm"], { stdio: "inherit" });
  else if (existsSync(join(target.dir, "Uninstall Brainstorm.exe"))) execFileSync(join(target.dir, "Uninstall Brainstorm.exe"), ["/S"], { stdio: "inherit" });
};

const { ELECTRON_RUN_AS_NODE: _, BRAINSTORM_HOME: __, ...baseEnv } = process.env;
const open = () => _electron.launch({ executablePath: target.exe, env: { ...baseEnv, BRAINSTORM_HOME: home, BRAINSTORM_UPDATE_FEED: feedUrl } });
const macLog = join(homedir(), "Library", "Logs", "Brainstorm", "update.log");

// Rob's own environment on a fake user folder: no BRAINSTORM_HOME, so the app keeps its default home and installs the
// use-brainstorm skill into <user>/.claude/skills, as it does on his machine.
const user = join(work, "user");
const userEnv = {
  ...baseEnv,
  BRAINSTORM_DISABLE_AUTO_UPDATE: "1",
  ...(mac ? { HOME: user } : { USERPROFILE: user, APPDATA: join(user, "AppData", "Roaming") }),
};
const userHome = mac ? join(user, "Library", "Application Support", "brainstorm") : join(user, "AppData", "Roaming", "brainstorm");
const skill = join(user, ".claude", "skills", "use-brainstorm", "SKILL.md");
const brainstormCommand = mac ? ["/usr/local/bin/brainstorm"] : ["cmd.exe", "/d", "/c", join(target.dir, "resources", "bin", "brainstorm.cmd")];
const readOr = (path, otherwise) => (existsSync(path) ? readFileSync(path, "utf8") : otherwise);

async function skillChecks() {
  mkdirSync(user, { recursive: true });
  // Opened as the Dock or Start menu opens it.
  const direct = await _electron.launch({ executablePath: target.exe, env: userEnv });
  let stderr = "";
  direct.process().stderr?.on("data", (d) => (stderr += d));
  await direct.firstWindow();
  const installed = await until(() => existsSync(skill) || null, 30_000);
  check("the app opened directly installs the use-brainstorm skill", installed, true);
  if (!installed) console.log(`the app's stderr:\n${stderr}`);
  await direct.close();

  // Started by the brainstorm command, as an agent in a T3 thread starts it.
  rmSync(join(user, ".claude"), { recursive: true, force: true });
  try {
    const [command, ...args] = brainstormCommand;
    execFileSync(command, [...args, "session", "list", "--thread", "11111111-1111-1111-1111-111111111111", "--json"], {
      env: userEnv,
      stdio: "inherit",
      timeout: 60_000,
    });
  } catch (e) {
    console.log(`brainstorm session list failed: ${e.message}`);
  }
  const viaCli = await until(() => existsSync(skill) || null, 30_000);
  check("the app the brainstorm command starts installs the skill", viaCli, true);
  if (!viaCli) console.log(`server.log:\n${readOr(join(userHome, "server.log"), "(none)")}`);
  try {
    process.kill(JSON.parse(readFileSync(join(userHome, "api.json"), "utf8")).pid);
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

let app = null;
try {
  install();
  await skillChecks();
  app = await open();
  const window = await app.firstWindow();
  check("the installed app runs version A", (await until(health, 30_000))?.version, version);

  // The first check runs 15 s after start; the download is the whole installer.
  const button = window.locator("[data-update-install]");
  await button.waitFor({ timeout: 120_000 });
  check("the sidebar offers the downloaded update", await button.textContent(), "Restart to update");
  await window.screenshot({ path: join(shots, `ready-${process.platform}.png`) });

  const logFrom = existsSync(macLog) ? readFileSync(macLog, "utf8").length : 0;
  const closed = new Promise((r) => app.once("close", r));
  await button.click();
  await closed;
  app = null;
  check("the update puts version A+1 in place", await until(() => (installedVersion() === next ? next : null), 120_000), next);
  if (mac) {
    // The Mac swap runs in a script after the app quits, which logs installed once the new bundle is in place.
    const log = () => (existsSync(macLog) ? readFileSync(macLog, "utf8").slice(logFrom) : "");
    check("the update script says installed", await until(() => (/^installed$/m.test(log()) ? true : null), 60_000), true);
    console.log(`update.log:\n${log()}`);
  }

  app = await open();
  await app.firstWindow();
  check("the updated app runs version A+1", await until(async () => ((await health())?.version === next ? next : null), 30_000), next);
} finally {
  feed.close();
  await app?.close().catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  uninstall();
  await new Promise((r) => setTimeout(r, 3000));
  rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
finish();
