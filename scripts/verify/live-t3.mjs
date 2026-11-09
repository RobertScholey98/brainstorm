// It starts real agent runs, so it is not part of npm test. `--preflight` checks the prerequisites and stops.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, checks, launch, openSession, root, shot } from "./electron.mjs";

const POLL_MS = 15_000;
const DEADLINE = Date.now() + 30 * 60_000;
const IDLE_POLLS = 4;

function preflight() {
  const problems = [];
  const t3 = process.env.T3CODE_CLI_PATH || join(homedir(), ".t3", "bin", "t3.cmd");
  if (!existsSync(t3)) problems.push(`no T3 CLI at ${t3}; set T3CODE_CLI_PATH or install T3 Code`);

  const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).stdout.trim();
  const linked = join(npmRoot, "brainstorm");
  let target = null;
  try {
    target = realpathSync(linked);
  } catch {}
  if (target === null || target.toLowerCase() !== realpathSync(root).toLowerCase()) {
    problems.push(`brainstorm resolves to ${target ?? "nothing"}, not ${root}; run npm link in this repo`);
  }

  const installed = join(homedir(), ".claude", "skills", "use-brainstorm", "SKILL.md");
  const source = join(root, "skills", "use-brainstorm", "SKILL.md");
  if (!existsSync(installed) || readFileSync(installed, "utf8") !== readFileSync(source, "utf8")) {
    problems.push(`the installed use-brainstorm skill differs from this repo's; run node scripts/install-skill.mjs`);
  }

  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch === "HEAD") problems.push("HEAD is detached; check out a branch so the agents' worktrees can start from it");
  // The project is the main checkout, which holds this worktree's shared .git directory.
  const project = dirname(git("rev-parse", "--path-format=absolute", "--git-common-dir"));

  if (problems.length > 0) {
    for (const p of problems) console.log(`FAIL preflight: ${p}`);
    process.exit(1);
  }
  console.log(`ok   preflight: t3 at ${t3}, brainstorm linked to ${root}, skill installed, branch ${branch}, project ${project}`);
  return { t3, branch, project };
}

const { t3, branch, project } = preflight();
if (process.argv.includes("--preflight")) process.exit(0);

/** A .cmd needs cmd.exe, so every argument is quoted verbatim, and anything cmd.exe could misread goes on stdin instead. */
function t3Json(args, input) {
  const bad = args.find((a) => /["%^&|<>]/.test(a));
  if (bad !== undefined) throw new Error(`t3 argument ${JSON.stringify(bad)} has characters cmd.exe would misread`);
  const line = `""${t3}" ${args.map((a) => `"${a}"`).join(" ")}"`;
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", line], { encoding: "utf8", input, windowsHide: true, windowsVerbatimArguments: true });
  if (result.status !== 0) throw new Error(`t3 ${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

const showThread = (thread) => t3Json(["thread", "show", thread, "--json", "--messages", "40"]);

/** `home` reaches the agents' CLI only through their commands, because T3 starts agents with its own environment. */
function envLine(home) {
  return `This is an automated check of Brainstorm against a test app. Every brainstorm command you run must see BRAINSTORM_HOME=${home}: in PowerShell, start each command with \`$env:BRAINSTORM_HOME = '${home}';\`. Keep it short and ask no questions.`;
}

function startThread(title, message) {
  const out = t3Json(["thread", "start", "--worktree", branch, "--title", title, "--json", project, "-"], message);
  const thread = out.threadId ?? out.thread?.threadId ?? out.id;
  if (typeof thread !== "string") throw new Error(`t3 thread start printed no thread id: ${JSON.stringify(out)}`);
  return thread;
}

/**
 * Polls every 15 s until `done()` returns a value. Fails when the thread's run fails, when the thread sits idle for a
 * minute with nothing done, or at the overall 30 minute deadline.
 */
async function waitFor(label, thread, done) {
  let idle = 0;
  for (;;) {
    const value = await done();
    if (value !== undefined && value !== null && value !== false) return value;
    const { thread: info, messages } = showThread(thread);
    const last = messages.filter((m) => m.role === "assistant").at(-1)?.text ?? "";
    console.log(`...  ${label}: thread ${info.status}${info.activeRunId === null ? "" : " (run active)"}`);
    if (info.status === "failed") throw new Error(`${label}: the run failed in T3; last reply: ${last}`);
    idle = info.activeRunId === null && info.status !== "running" ? idle + 1 : 0;
    if (idle >= IDLE_POLLS) throw new Error(`${label}: the thread went idle without it; last reply: ${last}`);
    if (Date.now() > DEADLINE) throw new Error(`${label}: gave up at the 30 minute deadline`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

build();
const home = mkdtempSync(join(tmpdir(), "bs-live-"));
const shots = join(root, "test-results", "verify-live");
rmSync(shots, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const { ELECTRON_RUN_AS_NODE: _a, BRAINSTORM_T3_CLI: _b, BRAINSTORM_FAKE_T3_STATE: _c, BRAINSTORM_APP: _d, T3CODE_THREAD_ID: _e, ...inherited } = process.env;
const env = { ...inherited, BRAINSTORM_HOME: home };
const { check, finish } = checks();
const { app, window, errors, api } = await launch(home, env);

const agent = async (path) => {
  const res = await fetch(`http://127.0.0.1:${api.port}${path}`, { headers: { authorization: `Bearer ${api.agentToken}` } });
  return res.json();
};
const sessionIn = async (thread, title) => (await agent(`/v1/agent/sessions?thread=${thread}`)).data?.find((s) => s.title === title);
const latestOf = async (id) => (await agent(`/v1/agent/sessions/${id}/context`)).data?.latest;
const userTexts = (thread) => showThread(thread).messages.filter((m) => m.role === "user").map((m) => m.text.trim());
/** The message the top bar shows: changed blocks by the title their sidebar row carries, two names then a count. */
async function fulfilledText(latest) {
  const titles = await Promise.all(
    latest.changed.map((id) => {
      const [slot, variant] = id.split("/");
      return window.$eval(`[data-slot-id="${slot}"] [data-variant="${variant}"] [data-variant-title]`, (el) => el.textContent.trim());
    }),
  );
  const shown = titles.slice(0, 2).join(", ");
  const list = titles.length === 0 ? "no blocks changed" : titles.length > 2 ? `changed ${shown} and ${titles.length - 2} more` : `changed ${shown}`;
  return `Iteration ${latest.n} · ${list}`;
}

async function regenerate(scope, freetext) {
  await window.waitForSelector("[data-regenerate-toggle]:not([disabled])", { timeout: 60_000 });
  await window.click("[data-regenerate-toggle]");
  await window.click(`[data-regenerate-menu] [data-scope="${scope}"]`);
  const chosen = scope === "blocks" ? await window.$$eval("[data-choice]", (els) => els.filter((e) => e.querySelector("input")?.checked).map((e) => e.dataset.choice)) : [];
  if (freetext !== null) await window.fill("[data-regenerate-menu] [data-freetext]", freetext);
  await window.click("[data-regenerate-menu] [data-send]");
  await window.waitForSelector("[data-regenerate-menu]", { state: "detached", timeout: 30_000 });
  return chosen;
}

async function fulfilled(id, n) {
  const latest = await latestOf(id);
  return latest?.n === n ? latest : undefined;
}

try {
  await window.setViewportSize({ width: 1440, height: 900 });
  const title = `Live check ${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
  const first = startThread(
    title,
    `/use-brainstorm\n${envLine(home)}\nTask: a "Copy link" button that confirms it copied. Start a session titled exactly "${title}" with one slot and two variants, and commit until it succeeds.`,
  );
  console.log(`...  first thread ${first}`);
  const session = await waitFor("the study's first iteration", first, async () => {
    const s = await sessionIn(first, title);
    return s?.latest === 1 ? s : undefined;
  });
  check("the agent's session has the title and iteration 1", { title: session.title, latest: session.latest }, { title, latest: 1 });
  await window.waitForSelector(`[data-session="${session.id}"]`, { timeout: 30_000 });
  await openSession(window, session.id);
  await shot(window, shots, "1-session");

  const freetext = "make the confirmation easier to notice";
  const [block, ...more] = await regenerate("blocks", freetext);
  check("Selected blocks defaults to one block", more, []);
  const firstMessage = `[brainstorm] session ${session.id} · request 1 · scope: ${block} · freetext: ${JSON.stringify(freetext)}\nHandle with the use-brainstorm skill: run \`brainstorm context ${session.id}\`.`;
  check("the first thread received the exact [brainstorm] message", userTexts(first).includes(firstMessage), true);
  await shot(window, shots, "2-sent");
  const second = await waitFor("iteration 2 from the first thread", first, () => fulfilled(session.id, 2));
  await window.waitForSelector('[data-request-phase="fulfilled"]', { timeout: 60_000 });
  check("the top bar reads the fulfilled iteration", (await window.textContent("[data-request-message]"))?.trim(), await fulfilledText(second));
  await shot(window, shots, "3-fulfilled");

  const takeover = startThread(`${title} takeover`, `${envLine(home)}\nPick up the brainstorm session titled "${title}"`);
  console.log(`...  takeover thread ${takeover}`);
  await waitFor("the takeover", takeover, async () => (await sessionIn(takeover, title))?.attachedThread === takeover);
  check("the second thread holds the session", (await sessionIn(takeover, title))?.attachedThread, takeover);

  await regenerate("all", null);
  const secondMessage = `[brainstorm] session ${session.id} · request 2 · scope: all\nHandle with the use-brainstorm skill: run \`brainstorm context ${session.id}\`.`;
  check("the takeover thread received request 2", userTexts(takeover).includes(secondMessage), true);
  check("the first thread did not", userTexts(first).some((t) => t.includes(`session ${session.id} · request 2`)), false);
  const third = await waitFor("iteration 3 from the takeover thread", takeover, () => fulfilled(session.id, 3));
  await window.waitForSelector('[data-request-phase="fulfilled"]', { timeout: 60_000 });
  check("the top bar reads the takeover's fulfilled iteration", (await window.textContent("[data-request-message]"))?.trim(), await fulfilledText(third));
  await shot(window, shots, "4-takeover-fulfilled");

  // One branch from iteration 2, made by Confirm as a branch with an instruction (ADR 010). It stays on the
  // brainstorm's own thread, so the takeover thread's agent works the branch's first request.
  const instruction = `${title} branch: make the button label shorter. Keep it short and ask no questions.`;
  await window.click('[data-history-n="2"]');
  await window.waitForSelector("[data-past-bar]");
  await window.click("[data-confirm-toggle]");
  await window.fill("[data-confirm-instruction]", instruction);
  await window.click("[data-confirm-send]");
  await window.waitForSelector("[data-branch-line]", { timeout: 60_000 });
  const branchId = await window.getAttribute("[data-branch-line]", "data-branch-line");
  console.log(`...  branch ${branchId}`);
  check(
    "the branch's request 1 went to the brainstorm's own thread, saying what it branches from",
    userTexts(takeover)
      .find((t) => t.includes(`session ${branchId} · request 1 · `))
      ?.split("\n")[0]
      .startsWith(`[brainstorm] session ${branchId} · request 1 · branch of ${session.id} iteration 2 · `),
    true,
  );
  const branched = await waitFor("the branch's first iteration, 3, from the same thread", takeover, () => fulfilled(branchId, 3));
  check("the agent fulfilled it as iteration 3, numbering on from where the branch left", branched.n, 3);
  await window.waitForSelector('[data-request-phase="fulfilled"]', { timeout: 60_000 });
  await shot(window, shots, "5-branch-fulfilled");

  console.log(`thread ${first}: ${showThread(first).thread.link}`);
  console.log(`thread ${takeover}: ${showThread(takeover).thread.link}`);
  console.log(`screenshots in ${shots}`);
  check("the window logged no errors or warnings", errors, []);
} catch (e) {
  await shot(window, shots, "failure").catch(() => {});
  check("the live check ran to the end", String(e instanceof Error ? e.message : e), "");
} finally {
  await app.close();
}
finish();
