// ADR 009 end to end: the built CLI and the headless server, with a fake T3 that has a main-checkout thread and a
// worktree thread on one project, and a thread on a new project. The window's routes are driven with the UI token the
// server prints, as the window would.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect, isDeepStrictEqual } from "node:util";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });

const tmp = mkdtempSync(join(tmpdir(), "bs-verify12-"));
const shots = join(root, "test-results", "project-system");
mkdirSync(shots, { recursive: true });
const home = join(tmp, "home");
// The main-checkout thread runs in the repo that holds the library, as an app's own design system does.
const mainCheckout = root;
const worktree = join(tmp, "worktrees", "app", "t3-1234");
const fresh = join(tmp, "fresh");
for (const dir of [mainCheckout, worktree, fresh]) mkdirSync(dir, { recursive: true });
// Inside the repo, so the library resolves react and tailwindcss from the repo's node_modules.
const kit = mkdtempSync(join(root, "test", ".kit-verify-"));
cpSync(join(root, "test", "kit-lib"), kit, { recursive: true });

// Brainstorm names a project after its repo's main checkout, which holds the library.
const repoName = basename(dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim()));

const MAIN = "11111111-1111-4111-8111-111111111111";
const WORKTREE = "22222222-2222-4222-8222-222222222222";
const FRESH = "33333333-3333-4333-8333-333333333333";
const statePath = join(tmp, "t3.json");
const thread = (projectId, title) => ({ projectId, title, status: "completed", activeRunId: null, latestRunId: null, pendingRequestCount: 0, messages: [] });
writeFileSync(
  statePath,
  JSON.stringify({ threads: { [MAIN]: thread("proj-app", "Main"), [WORKTREE]: thread("proj-app", "Worktree"), [FRESH]: thread("proj-fresh", "Fresh") } }),
);
const env = {
  ...process.env,
  BRAINSTORM_HOME: home,
  BRAINSTORM_T3_CLI: join(root, "test", "fake-t3", process.platform === "win32" ? "t3.cmd" : "t3"),
  BRAINSTORM_FAKE_T3_STATE: statePath,
  BRAINSTORM_APP: "headless",
};

let failures = 0;
function check(label, actual, expected) {
  if (isDeepStrictEqual(actual, expected)) console.log(`ok   ${label}`);
  else {
    failures += 1;
    console.log(`FAIL ${label}\n  expected ${inspect(expected, { depth: 8 })}\n  actual   ${inspect(actual, { depth: 8 })}`);
  }
}
const lines = (text) => text.trimEnd().split("\n").map((l) => l.replace(/\r$/, ""));
function cli(args, { thread, cwd }) {
  const r = spawnSync(process.execPath, [join(root, "bin", "brainstorm.mjs"), ...args], { cwd, env: { ...env, T3CODE_THREAD_ID: thread }, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: lines(r.stdout), err: lines(r.stderr) };
}

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "dist", "server", "headless.js")], { env, stdio: ["ignore", "pipe", "inherit"] });
const url = await new Promise((resolve, reject) => {
  let buffer = "";
  server.stdout.on("data", (chunk) => {
    buffer += chunk;
    const m = /running at (\S+)/.exec(buffer);
    if (m) resolve(new URL(m[1]));
  });
  server.on("exit", () => reject(new Error("the server exited")));
});
const token = new URLSearchParams(url.hash.slice(1)).get("ui");
const ui = async (method, path, body) => {
  const res = await fetch(new URL(path, url.origin), { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json();
};

try {
  const added = cli(["system", "add", kit], { thread: MAIN, cwd: mainCheckout });
  const system = added.out[0]?.match(/\bds_[a-z0-9]+/)?.[0];
  check("system add makes the new system its project's", [added.code, added.out.slice(-2)], [
    0,
    [`brainstorms on ${repoName} build with it`, "next: report to Rob and wait; Rob's review may send changes back to this thread"],
  ]);

  const early = cli(["session", "new", "--title", "Early"], { thread: WORKTREE, cwd: worktree });
  check("a worktree thread's brainstorm waits for Rob to confirm the project's system", [early.code, early.err.join(" ")], [
    1,
    `error invalid_action: Rob hasn't confirmed the design system "@fixture/kit" yet; he reviews a newly added system on Brainstorm's Design systems page before brainstorms can use it. It is this project's design system; pass --system none for a brainstorm without it`,
  ]);
  const free = cli(["session", "new", "--title", "Free", "--system", "none"], { thread: WORKTREE, cwd: worktree });
  check("--system none makes a freeform brainstorm", [free.code, free.out[2]], [0, "design system: none, as asked"]);

  check("Rob confirms the system in the window", (await ui("POST", `/v1/ui/systems/${system}/review`, { kind: "confirm" })).data?.review?.state, "confirmed");
  const inWorktree = cli(["session", "new", "--title", "In a worktree"], { thread: WORKTREE, cwd: worktree });
  check("a brainstorm in a worktree builds with the project's system", [inWorktree.code, inWorktree.out[2]], [0, `design system: @fixture/kit (${system}) v1, this project's`]);
  const inMain = cli(["session", "new", "--title", "In the main checkout"], { thread: MAIN, cwd: mainCheckout });
  check("so does one in the main checkout", inMain.out[2], `design system: @fixture/kit (${system}) v1, this project's`);

  const before = cli(["session", "new", "--title", "New project"], { thread: FRESH, cwd: fresh });
  check("a new project has no system", before.out[2], "design system: none; this project has none set (brainstorm project use <system> sets one)");
  const use = cli(["project", "use", "@fixture/kit"], { thread: FRESH, cwd: fresh });
  check("project use sets it from the new project's thread", [use.code, use.out], [0, [`this project: brainstorms build with @fixture/kit (${system})`]]);
  const after = cli(["session", "new", "--title", "New project again"], { thread: FRESH, cwd: fresh });
  check("and the new project's next brainstorm builds with it", after.out[2], `design system: @fixture/kit (${system}) v1, this project's`);

  const projects = await ui("GET", "/v1/ui/projects");
  check(
    "the window lists both projects with the system",
    projects.data.map((p) => [p.id, p.system?.id ?? null]).sort(),
    [["proj-app", system], ["proj-fresh", system]],
  );
  const cleared = await ui("POST", "/v1/ui/projects/proj-fresh/system", { system: null });
  check("the window clears the new project's system", cleared.data?.system, null);
  check("project show reads it back", cli(["project", "show"], { thread: FRESH, cwd: fresh }).out, ["this project: no design system; its brainstorms are freeform"]);
  const card = (await ui("GET", "/v1/ui/systems")).data.find((s) => s.id === system);
  check("the system's card lists the project still using it", card.projects.map((p) => p.id), ["proj-app"]);
  const bad = cli(["project", "use", "@fixture/nope"], { thread: FRESH, cwd: fresh });
  check("project use refuses a system Brainstorm doesn't have", [bad.code, bad.err], [1, ['error not_found: no design system @fixture/nope; Brainstorm has "@fixture/kit"']]);

  // The window, in plain Chromium against the same server.
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url.href);
    await page.click("[data-nav-systems]");
    const cardLine = page.locator(`[data-system="${system}"] [data-system-card-projects]`);
    check("the card names the project that builds with the system", await cardLine.textContent(), `Projects: ${repoName}`);
    await page.screenshot({ path: join(shots, "card.png") });
    await page.click(`[data-system="${system}"] button >> nth=0`);
    const trigger = page.locator(`[data-system-projects="${system}"]`);
    check("the header's Projects control names the one project", (await trigger.textContent())?.trim(), repoName);
    await trigger.click();
    const menu = page.locator("[data-system-projects-menu]");
    await menu.waitFor();
    const rows = menu.locator("[data-system-project]");
    check(
      "the menu lists both projects, checked where the system is theirs",
      await rows.evaluateAll((els) => els.map((el) => [el.getAttribute("data-system-project"), el.querySelector("[data-slot=checkbox]")?.hasAttribute("data-checked") ?? false])),
      [["proj-app", true], ["proj-fresh", false]],
    );
    await page.screenshot({ path: join(shots, "projects-menu.png") });
    await menu.locator('[data-system-project="proj-fresh"] [data-slot=checkbox]').click();
    await page.waitForFunction(() => document.querySelector('[data-system-project="proj-fresh"] [data-slot=checkbox]')?.hasAttribute("data-checked"));
    check("checking the new project sets its system", cli(["project", "show"], { thread: FRESH, cwd: fresh }).out, [`this project: brainstorms build with @fixture/kit (${system})`]);
    await page.keyboard.press("Escape");
    check("the trigger counts both projects", (await trigger.textContent())?.trim(), "2 projects");
    await page.screenshot({ path: join(shots, "two-projects.png") });
    check("the page logged no errors", errors, []);
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(kit, { recursive: true, force: true });
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures > 0) {
  console.log(`${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("VERIFIED");
