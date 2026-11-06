// Captures every screen and state of the app for a design review round:
//
//   npm run capture -- --round <n>
//
// Writes design-review/round-<n>/app/<theme>/<width>/<NN-name>.png, a manifest.json reviewers read, and contact
// sheets at 1440 for a quick check that every shot settled. Those outputs are rebuilt on every run, and the round's reviews
// and worklist beside them are kept.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { _electron, chromium } from "playwright";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, demoEnv } from "../seed-demo.mjs";
import { build, canvasFrame, inBlock, launch, root } from "../verify/electron.mjs";

const { values } = parseArgs({ options: { round: { type: "string" } } });
const round = Number(values.round);
if (values.round === undefined || !Number.isInteger(round) || round < 0) {
  console.error("usage: npm run capture -- --round <n>");
  process.exit(1);
}

const COMBOS = [
  { theme: "light", width: 1440, height: 900 },
  { theme: "dark", width: 1440, height: 900 },
  { theme: "light", width: 1100, height: 720 },
  { theme: "dark", width: 1100, height: 720 },
];
const SETTLE_MS = 10_000;
const PHASE_MS = 20_000;

const SHOTS = [
  ["home-empty", "empty", "Home on a fresh install: no brainstorms in the sidebar, and the empty state says how to start one"],
  ["home", "home", "Home: the overview of every brainstorm as cards, beside three project groups (chores, kitchen, Other project), a lost thread, and a long title that truncates"],
  ["home-collapsed-group", "home", "Home with the kitchen project group collapsed"],
  ["sidebar-collapsed", "canvas", "The Chore roulette brainstorm with the sidebar collapsed, so the toggle sits in the top bar"],
  ["state-hover-row", "home", "Home with the pointer over the Chore roulette session row"],
  ["session", "canvas", "The Chore roulette brainstorm as it opens: on the stage, the first slot alone under the slot tabs, its controls in the Inspector"],
  ["session-multi-slot", "views", "A brainstorm with three slots and several variants each, where the showing variants carry long about text"],
  ["session-wide-frame", "views", "All slots: the 980 px frame beside a phone frame, both scaled to fit one row, with the zoom in the canvas bar"],
  ["session-block-error", "views", "A block that throws in the canvas: the frame shows the failure, and the Inspector names the error"],
  ["session-no-iteration", "views", "A brainstorm whose agent hasn't committed yet: waiting state, Regenerate and Export disabled"],
  ["inspector-overridden", "inspector", "The Inspector on the assignment card with the headline, accent and name size overridden"],
  ["inspector-inapplicable", "inspector", "The Inspector banner for an override that no longer applies, after the agent removed the card's accent"],
  ["state-regenerate-open-all", "canvas", "The Regenerate popover with Everything selected, free text typed and one open comment attached"],
  ["state-regenerate-open-blocks", "canvas", "The Regenerate popover with Selected blocks, the block checklist and free text"],
  ["state-regenerate-open-described", "canvas", "The Regenerate popover with Describe it and its required free text"],
  ["state-regenerate-blocked", "phases", "Regenerate disabled while request 1 is open, with its tooltip showing"],
  ["state-export-open", "canvas", "The Export popover while the file is still being written"],
  ["state-export-done", "canvas", "The Export popover once the file is written, with its path and Show in folder"],
  ["state-pick-mode", "canvas", "Pin mode: the hint pill over the canvas and the highlight on the hovered headline"],
  ["state-pin-composer", "canvas", "The pin composer over the canvas with a comment typed"],
  ["state-tooltip", "canvas", "A tooltip on an ordinary control: the sidebar toggle, with its Ctrl+B shortcut"],
  ["state-notice", "canvas", "The failure notice, with its close button, after an action fails because Brainstorm's server didn't answer"],
  ["feedback-list", "canvas", "Feedback with open, addressed and confirmed comments, and comment 1 focused from its pin"],
  ["phase-sending", "phases", "Request phase: sending to T3, with Regenerate already disabled"],
  ["phase-queued", "phases", "Request phase: queued in T3"],
  ["phase-working", "phases", "Request phase: the agent is working"],
  ["phase-asking", "phases", "Request phase: the agent is asking something in T3"],
  ["phase-run-failed", "phases", "Request phase: the agent's run failed, with Retry and Withdraw, and the strip links to the thread"],
  ["phase-send-failed", "phases", "Request phase: the send failed; the bar names it with Retry, and the strip under it holds the whole error"],
  ["phase-no-change", "phases", "Request phase: the agent replied without changing the design; the bar names it, the strip says it in full"],
  ["phase-fulfilled", "phases", "Request phase: fulfilled, naming the new iteration and the block that changed"],
  ["phase-withdrawn", "phases", "Request phase: withdrawn"],
  ["phase-thread-lost", "phases", "Request phase: the thread is gone; the strip holds the takeover phrase on its own mono line with Copy phrase beside it"],
  ["session-unattached", "phases", "The lost-thread session once its request is withdrawn: the sidebar shows the takeover phrase and Copy phrase"],
  ["phase-previous-thread", "phases", "Request phase: sent to the previous thread after another thread took the session over; the strip says what Resend does"],
  ["home-loading", "launch", "Home while the first list loads: skeleton rows in the sidebar and skeleton cards in the overview"],
  ["home-server-down", "launch", "Home when Brainstorm's server doesn't answer at launch: the error and Try again"],
  ["home-sidebar-collapsed", "home", "Home with the sidebar collapsed, so the toggle sits in the top bar"],
  ["home-session-kept", "home", "Back to all brainstorms from Chore roulette: the home list, with that brainstorm still on the canvas and its row marked"],
  ["session-loading", "views", "A brainstorm opening: skeletons in the sidebar and the Inspector while its view loads"],
  ["state-select-open", "canvas", "The Palette select open in the Inspector"],
  ["state-slider-focus", "canvas", "The Glow slider focused from the keyboard"],
  ["state-focus-row", "canvas", "Keyboard focus on a variant row in the sidebar"],
  ["state-hover-variant", "canvas", "The pointer over a variant row that isn't showing"],
  ["state-resize-handle", "canvas", "The Inspector's resize handle under the pointer, with its line"],
  ["state-shortcut-hint", "canvas", "The Regenerate hint, naming its Ctrl+R shortcut"],
  ["state-hover-pin", "canvas", "The pointer over a pin on the canvas"],
  ["state-hover-feedback", "canvas", "The pointer over a feedback item in the Inspector"],
  ["state-feedback-edit", "canvas", "A feedback item in Edit mode"],
  ["state-regenerate-invalid", "canvas", "Regenerate with Describe it and no text yet, so Send is disabled"],
  ["state-export-failed", "canvas", "Export when the server doesn't answer: the popover closes and the failure toast says why"],
  ["state-copied", "phases", "Copy phrase just after a click, reading Copied"],
  ["phase-long-title", "phases", "A long brainstorm title beside a queued request in the top bar"],
  ["home-many-projects", "overflow", "Home with nine projects, so the sidebar and the overview both scroll"],
  ["state-colour-picker", "canvas", "The colour picker on the Accent control"],
  ["window-title-bar", "window", "The whole window at its real size, from the screen: the app's own header with the native buttons overlaid at its right end, in the theme's colours"],
  ["state-escape", "canvas", "Escape closing an overlay, pick mode and the composer"],
  ["session-board", "canvas", "All slots: the Chore roulette board, both frames side by side"],
  ["stage-wide-frame", "views", "The 980 px frame on the stage, scaled to fit with its zoom in the canvas bar and no sideways scroll"],
  ["stage-desktop-frame", "views", "A 1440 px frame on the stage, scaled to fit"],
  ["stage-tabs-focus", "canvas", "Keyboard focus on a slot tab in the canvas bar"],
  ["about-more-open", "views", "A long variant note opened with More, so it reads Less"],
  ["inspector-rail", "canvas", "The Inspector collapsed to its rail, with the feedback count"],
  ["feedback-delete-confirm", "canvas", "Delete on a feedback item asking in place, with Cancel focused"],
  ["prefs-restored", "restart", "After a restart: the wider sidebar and Inspector, and the board, come back as Rob left them"],
].map(([name, scene, about], i) => ({ name, scene, about, file: `${String(i + 1).padStart(2, "0")}-${name}` }));
const byName = new Map(SHOTS.map((s) => [s.name, s]));
/** name -> { status: "captured" } | { status: "missing" | "partial", reason } */
const outcomes = new Map();

const out = join(root, "design-review", `round-${round}`);
const comboDir = (c) => join(out, "app", c.theme, String(c.width));
for (const own of ["app", "manifest.json", "contact-light-1440.png", "contact-dark-1440.png"]) rmSync(join(out, own), { recursive: true, force: true });
for (const c of COMBOS) mkdirSync(comboDir(c), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotOf = (name) => {
  const shot = byName.get(name);
  if (shot === undefined) throw new Error(`no shot named ${name} in the registry`);
  return shot;
};

function missing(name, reason) {
  const shot = shotOf(name);
  for (const c of COMBOS) writeFileSync(join(comboDir(c), `${shot.file}.missing.txt`), `${reason}\n`);
  outcomes.set(name, { status: "missing", reason });
  console.log(`MISSING ${shot.file}: ${reason}`);
}

const RUNNING_ANIMATIONS = () =>
  document
    .getAnimations()
    // A scroll-driven animation runs for as long as its scroller exists, so only time-driven ones count.
    .filter((a) => a.timeline === document.timeline && a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity)
    .map((a) => a.animationName || a.transitionProperty || "animation");

const inFrames = (page, fn) => Promise.all(page.frames().map((f) => f.evaluate(fn).catch(() => null)));

/** Null once no finite animation or transition is running in any frame, else what still is at the deadline. */
async function untilStill(page, deadline = Date.now() + SETTLE_MS) {
  for (;;) {
    const running = (await inFrames(page, RUNNING_ANIMATIONS)).flat().filter(Boolean);
    if (running.length === 0) return null;
    if (Date.now() > deadline) return `animations still running after ${SETTLE_MS / 1000} s: ${[...new Set(running)].join(", ")}`;
    await sleep(50);
  }
}

/** Null once the page is settled, else why it never did. A `loading` shot is of the skeletons, so it doesn't wait them out. */
async function settle(page, { keepFocus, loading = false }) {
  const deadline = Date.now() + SETTLE_MS;
  await inFrames(page, () => document.fonts.ready.then(() => null));
  let clearSince = Date.now();
  while (!loading && Date.now() - clearSince < 1000) {
    if (Date.now() > deadline) return "a loading skeleton kept showing";
    if (await page.evaluate(() => document.querySelector("[data-slot=skeleton], .animate-pulse") !== null)) clearSince = Date.now();
    await sleep(100);
  }
  if (!keepFocus) await inFrames(page, () => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const moving = await untilStill(page, deadline);
  if (moving !== null) return moving;
  await inFrames(page, () => Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 500))]));
  return null;
}

/**
 * Moves the pointer into the 8 px of window under the main card, where nothing reacts to hover. The top bar's middle
 * holds the request phase and its actions, so a pointer parked there left a hover fill on the lead action.
 */
const park = (page, c) => page.mouse.move(Math.round(c.width * 0.55), c.height - 3);

async function setCombo(page, c) {
  await page.setViewportSize({ width: c.width, height: c.height });
  await page.emulateMedia({ colorScheme: c.theme });
}

/**
 * Shoots the current state in every theme and width. `each` re-enters anything a resize or a parked pointer undoes. A
 * `brief` state reverts on a timer shorter than settling takes, so it is shot as soon as `each` has entered it.
 */
async function capture(page, name, { keepFocus = false, loading = false, brief = false, each } = {}) {
  const shot = shotOf(name);
  const problems = [];
  for (const c of COMBOS) {
    await setCombo(page, c);
    await park(page, c);
    // A hover or click aimed while the layout is still moving lands on where an element was.
    await untilStill(page);
    if (each !== undefined) await each(c);
    const unsettled = brief ? null : await settle(page, { keepFocus, loading });
    if (unsettled === null) {
      await page.screenshot({ path: join(comboDir(c), `${shot.file}.png`) });
    } else {
      writeFileSync(join(comboDir(c), `${shot.file}.missing.txt`), `Never settled: ${unsettled}\n`);
      problems.push(`${c.theme} ${c.width}: never settled (${unsettled})`);
    }
  }
  await setCombo(page, COMBOS[0]);
  outcomes.set(name, problems.length === 0 ? { status: "captured" } : { status: problems.length === COMBOS.length ? "missing" : "partial", reason: problems.join("; ") });
  console.log(`${problems.length === 0 ? "shot   " : "PARTIAL"} ${shot.file}${problems.length === 0 ? "" : `: ${problems.join("; ")}`}`);
}

function must(step, r) {
  if (r.code !== 0 || r.json?.ok !== true) throw new Error(`${step} failed (exit ${r.code}): ${r.stdout}${r.stderr}`);
  return r.json.data;
}

/**
 * Page shots render at one device pixel per CSS pixel. On a scaled display a 1 px rule is one device pixel, which a
 * shot at CSS size blends to about two thirds of its token, and reviewers measured those blends as the colours.
 */
const PIXELS = ["--force-device-scale-factor=1"];

/** The fake T3's environment for a home, minus ELECTRON_RUN_AS_NODE, which would start Electron as plain Node. */
const appEnv = (home) => (({ ELECTRON_RUN_AS_NODE: _, ...rest }) => rest)(demoEnv(home));

/**
 * Launches with `route` on the session list from the first request, for the states only a fresh launch shows. The
 * route goes on before the window's first load.
 */
async function startRouted(env, route) {
  const app = await _electron.launch({ args: [root, ...PIXELS], env, cwd: root });
  await app.context().route("**/v1/ui/sessions", route);
  const window = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true));
  await setCombo(window, COMBOS[0]);
  return { app, window };
}

async function start(home, env) {
  const run = await launch(home, env, { args: PIXELS });
  // The window is real and on screen, so the desk's own pointer would otherwise leave hover states in the shots.
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true));
  await setCombo(run.window, COMBOS[0]);
  return run;
}

const demo = (slot, variant) => join(root, "scripts", "demo", "chore-roulette", "slots", slot, variant);

const LONG_ABOUT = {
  neon: [
    "**Hypothesis:** a loud, arcade-style wheel makes the draw feel like a game the whole flat watches, so nobody argues with the result afterwards, even when it lands on the same person twice in one week.",
    "**Tradeoff:** the neon look is fun on the first spin and tiring by the tenth. It also hides how the odds are weighted, which is the part people actually distrust.",
    "**Try:** the calmer palette, a shorter spin, and turning the glow down to see whether it still feels fair without the theatre.",
  ].join("\n\n"),
  card: [
    "**Hypothesis:** the result sticks when the person picked has to accept it in front of everyone, with one swap a week as the only way out and the points shown before and after.",
    "**Tradeoff:** one swap is a guess. Too strict and people stop opening the app; too loose and the bins never go out on time.",
    "**Try:** the compact density on smaller phones, a calmer stamp word, and a headline that names the chore instead of the wheel.",
  ].join("\n\n"),
  ledger: [
    "**Hypothesis:** a running points ledger answers \"why me again?\" before anyone asks it, because the history is right there under the result.",
    "**Tradeoff:** a ledger invites point-scoring between flatmates, and it is one more thing to read on a small screen.",
  ].join("\n\n"),
};

function gitRepo(home, name) {
  const repo = join(home, "repos", name);
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  return { repo, git };
}

/**
 * Creates a session the way an agent does: session new, then pull, write the blocks and commit when it has slots.
 * Each variant copies a demo block (`from`) and then writes `files` over it.
 */
function seed(home, env, { title, thread, project, brief, slots, note = "First pass" }) {
  const args = ["session", "new", "--title", title, "--thread", thread, "--project", project, ...(brief ? ["--brief", brief] : []), "--json"];
  const id = must(`session new ${title}`, brainstorm(env, args)).session.id;
  if (slots === undefined) return { id };
  const work = join(home, "work", id);
  must(`pull ${title}`, brainstorm(env, ["pull", id, "--out", work, "--json"]));
  for (const slot of slots) {
    for (const [variant, { from, files = {} }] of Object.entries(slot.variants)) {
      const dir = join(work, "slots", slot.id, variant);
      if (from !== undefined) cpSync(from, dir, { recursive: true });
      mkdirSync(dir, { recursive: true });
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    }
  }
  const manifest = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  const shape = slots.map(({ id: slotId, title: slotTitle, frame }) => ({ id: slotId, title: slotTitle, frame }));
  writeFileSync(join(work, "brainstorm.json"), `${JSON.stringify({ ...manifest, slots: shape }, null, 2)}\n`);
  must(`commit ${title}`, brainstorm(env, ["commit", id, "--from", work, "--thread", thread, "--note", note, "--json"]));
  return { id, work };
}

let agentCopies = 0;
/** The agent pulls a fresh copy, edits one file and commits it. */
function agentCommit(home, env, session, { file, from, to, args = [] }) {
  const copy = join(home, "agent", String(++agentCopies));
  must("agent pull", brainstorm(env, ["pull", session, "--out", copy, "--json"]));
  const path = join(copy, ...file.split("/"));
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} no longer contains ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
  return must("agent commit", brainstorm(env, ["commit", session, "--from", copy, ...args, "--json"]));
}

function retitled(slot, variant, title) {
  const json = JSON.parse(readFileSync(join(demo(slot, variant), "block.json"), "utf8"));
  return JSON.stringify({ ...json, title }, null, 2);
}

const BROKEN_BLOCK = `import { useEffect } from "react";

export default function RotaPreview({ label }) {
  useEffect(() => {
    const rota = undefined;
    document.title = String(rota.members.length);
  }, []);
  return (
    <div data-part="screen" style={{ padding: 24, fontFamily: "system-ui" }}>
      {label}
    </div>
  );
}
`;
const BROKEN_JSON = JSON.stringify(
  { title: "Rota preview", props: { data: {}, appearance: { label: { type: "text", label: "Label", default: "This week" } } } },
  null,
  2,
);

const KITCHEN_THREAD = "c0ffee00-0000-4000-8000-00000000c4a2";
const LOOSE_THREAD = "c0ffee00-0000-4000-8000-00000000c4a3";
const LIST_THREAD = "c0ffee00-0000-4000-8000-00000000c4a4";
const TAKEOVER_THREAD = "33333333-3333-4333-8333-333333333333";
const LONG_TITLE = "Onboarding a new flatmate into the rota, the shared shopping list and the bills split all at once";

function seedAll(home, env, t3) {
  t3.addThread(KITCHEN_THREAD, { projectId: "kitchen-proj", title: "Kitchen rota study" });
  t3.addThread(LOOSE_THREAD, { projectId: "loose-proj", title: "Loose notes" });
  t3.addThread(LIST_THREAD, { projectId: "loose-proj", title: "Shopping list sketch" });
  const chores = gitRepo(home, "chores").repo;
  const { git } = gitRepo(home, "kitchen");
  const kitchen = join(home, "repos", "t3-9f2e11aa");
  git("worktree", "add", "-q", kitchen);
  const loose = join(home, "not-a-repo");
  mkdirSync(loose, { recursive: true });

  const demoSlots = [
    { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 }, variants: { neon: { from: demo("wheel", "neon") }, reel: { from: demo("wheel", "reel") }, terminal: { from: demo("wheel", "terminal") } } },
    { id: "result", title: "The result", frame: { width: 390 }, variants: { card: { from: demo("result", "card") }, receipt: { from: demo("result", "receipt") } } },
  ];
  const brief =
    "Give one chore an owner by spinning, and make the result stick. A cyberpunk phone app for a shared flat: " +
    "the pick has to feel fair, the person picked has to accept it, and the crew has to see how it was decided.";

  const sessions = {};
  sessions.loose = seed(home, env, { title: "Loose notes", thread: LOOSE_THREAD, project: loose }).id;
  sessions.list = seed(home, env, { title: "Shopping list sketch", thread: LIST_THREAD, project: loose }).id;
  sessions.longTitle = seed(home, env, {
    title: LONG_TITLE,
    thread: KITCHEN_THREAD,
    project: kitchen,
    slots: [{ id: "result", title: "The result", frame: { width: 390 }, variants: { card: { from: demo("result", "card") } } }],
  });
  sessions.kitchen = seed(home, env, { title: "Kitchen rota", thread: KITCHEN_THREAD, project: kitchen, slots: demoSlots });
  sessions.broken = seed(home, env, {
    title: "Rota preview",
    thread: DEMO_THREAD,
    project: chores,
    slots: [
      { id: "preview", title: "Preview", frame: { width: 390, height: 320 }, variants: { broken: { files: { "block.tsx": BROKEN_BLOCK, "block.json": BROKEN_JSON } } } },
      { id: "result", title: "The result", frame: { width: 390 }, variants: { card: { from: demo("result", "card") } } },
    ],
  }).id;
  sessions.wide = seed(home, env, {
    title: "Start a task",
    thread: DEMO_THREAD,
    project: chores,
    slots: [
      { id: "result", title: "Wide frame", frame: { width: 980, height: 600 }, variants: { card: { from: demo("result", "card") } } },
      { id: "wheel", title: "Phone frame", frame: { width: 390, height: 600 }, variants: { neon: { from: demo("wheel", "neon") } } },
    ],
  }).id;
  sessions.desktop = seed(home, env, {
    title: "Rota on the desktop",
    thread: DEMO_THREAD,
    project: chores,
    slots: [{ id: "result", title: "Desktop frame", frame: { width: 1440, height: 600 }, variants: { card: { from: demo("result", "card") } } }],
  }).id;
  sessions.multi = seed(home, env, {
    title: "Rota handover",
    thread: DEMO_THREAD,
    project: chores,
    slots: [
      {
        id: "wheel",
        title: "The wheel",
        frame: { width: 390, height: 760 },
        variants: {
          neon: { from: demo("wheel", "neon"), files: { "about.md": LONG_ABOUT.neon } },
          reel: { from: demo("wheel", "reel") },
          terminal: { from: demo("wheel", "terminal") },
        },
      },
      {
        id: "result",
        title: "The result",
        frame: { width: 390 },
        variants: { card: { from: demo("result", "card"), files: { "about.md": LONG_ABOUT.card } }, receipt: { from: demo("result", "receipt") } },
      },
      {
        id: "history",
        title: "The history",
        frame: { width: 390 },
        variants: {
          ledger: { from: demo("result", "receipt"), files: { "about.md": LONG_ABOUT.ledger, "block.json": retitled("result", "receipt", "Points ledger") } },
          stamp: { from: demo("result", "card"), files: { "block.json": retitled("result", "card", "Stamp history") } },
        },
      },
    ],
  }).id;
  sessions.roulette = seed(home, env, { title: "Chore roulette", thread: DEMO_THREAD, project: chores, brief, slots: demoSlots, note: "Three wheels and two results" });
  return sessions;
}

const HEADLINE = inBlock("result/card", "headline");

function scenes(page, home, env, t3, sessions) {
  const phase = (name) => page.waitForSelector(`[data-request-phase="${name}"]`, { timeout: PHASE_MS });

  /** Back to the overview with nothing open. Back alone keeps the open brainstorm on the canvas. */
  async function goHome() {
    await page.keyboard.press("Escape");
    if ((await page.$("[data-back]")) !== null) await page.click("[data-back]");
    await page.waitForSelector('[data-sidebar-panel="home"]');
    if ((await page.$("[data-home-overview]")) === null) await page.click("[data-overview]");
    await page.waitForSelector("[data-home-overview]");
  }

  /**
   * Opens a session from home in `view` and returns its canvas frame, or null when it has no iteration yet. A slot
   * off the stage is mounted but hidden, so its blocks are waited for as attached.
   */
  async function open(id, waitFor, view = "stage") {
    await goHome();
    await page.click(`[data-session="${id}"]`);
    await page.waitForSelector('[data-sidebar-panel="session"]');
    if (waitFor === undefined) return null;
    const canvas = await canvasFrame(page);
    for (const selector of waitFor) await canvas.waitForSelector(selector, { state: "attached" });
    await showView(canvas, view);
    return canvas;
  }

  async function showView(canvas, view) {
    if ((await page.$(`[data-view-option="${view}"]`)) !== null) await page.click(`[data-view-option="${view}"]`);
    await canvas.waitForSelector(`#canvas[data-view="${view}"]`);
  }

  async function ensurePicking() {
    if ((await page.getAttribute("[data-pick-toggle]", "aria-pressed")) !== "true") await page.click("[data-pick-toggle]");
    await page.waitForSelector("[data-pick-hint]");
  }

  async function pinComment(canvas, selector, text) {
    await ensurePicking();
    await canvas.click(selector);
    await page.waitForSelector("[data-composer]");
    await page.keyboard.type(text);
  }

  async function openRegenerate(scope, freetext) {
    if ((await page.$("[data-regenerate-menu]")) === null) await page.click("[data-regenerate-toggle]");
    await page.click(`[data-regenerate-menu] [data-scope="${scope}"]`);
    if (freetext !== undefined) await page.fill("[data-regenerate-menu] [data-freetext]", freetext);
  }

  async function regenerate(scope, freetext) {
    await openRegenerate(scope, freetext);
    await page.click("[data-regenerate-menu] [data-send]");
  }

  return {
    async home() {
      await page.waitForSelector(`[data-session="${sessions.roulette.id}"]`);
      await open(sessions.loose);
      await page.waitForSelector('[data-thread="lost"]', { timeout: PHASE_MS });
      await goHome();
      await page.waitForSelector(`[data-session="${sessions.loose}"] [data-session-status="thread_lost"]`);
      await capture(page, "home");

      await page.click('[data-project="kitchen-proj"] [data-project-label]');
      await page.waitForSelector(`[data-session="${sessions.kitchen.id}"]`, { state: "detached" });
      await capture(page, "home-collapsed-group");
      await page.click('[data-project="kitchen-proj"] [data-project-label]');
      await page.waitForSelector(`[data-session="${sessions.kitchen.id}"]`);

      await capture(page, "state-hover-row", { each: () => page.hover(`[data-session="${sessions.roulette.id}"]`) });

      await page.click('[data-slot="sidebar"] [data-sidebar="trigger"]');
      await page.waitForSelector('[data-slot="sidebar"][data-state="collapsed"]');
      await capture(page, "home-sidebar-collapsed");
      await page.click('[data-topbar] [data-sidebar="trigger"]');
      await page.waitForSelector('[data-slot="sidebar"][data-state="expanded"]');
      await untilStill(page);

      await open(sessions.roulette.id, [inBlock("wheel/neon", "screen")]);
      await page.click("[data-back]");
      await page.waitForSelector('[data-sidebar-panel="home"]');
      await capture(page, "home-session-kept");
      await goHome();
    },

    async views() {
      let release;
      const viewed = new Promise((r) => (release = r));
      await page.route(`**/v1/ui/sessions/${sessions.multi}`, async (route) => {
        await viewed;
        await route.continue();
      });
      await goHome();
      await page.click(`[data-session="${sessions.multi}"]`);
      await page.waitForSelector("[data-session-loading]");
      await capture(page, "session-loading", { loading: true });
      release();
      await page.waitForSelector("[data-session-loading]", { state: "detached" });
      await page.unroute(`**/v1/ui/sessions/${sessions.multi}`);

      await open(sessions.multi, [inBlock("wheel/neon", "screen"), inBlock("result/card", "card"), inBlock("history/ledger", "footer")], "board");
      await capture(page, "session-multi-slot");
      await page.click('[data-slot-id="wheel"] [data-about-more]');
      await capture(page, "about-more-open");
      await page.click('[data-slot-id="wheel"] [data-about-more]');

      await open(sessions.wide, [inBlock("result/card", "card")], "stage");
      await page.waitForSelector("[data-canvas-zoom]");
      await capture(page, "stage-wide-frame");
      await open(sessions.desktop, [inBlock("result/card", "card")]);
      await page.waitForSelector("[data-canvas-zoom]");
      await capture(page, "stage-desktop-frame");

      await open(sessions.wide, [inBlock("result/card", "card"), inBlock("wheel/neon", "screen")], "board");
      await capture(page, "session-wide-frame");

      await open(sessions.broken, [".bs-failure", inBlock("result/card", "card")]);
      await page.waitForSelector('aside[aria-label=Inspector] [role="alert"]');
      await capture(page, "session-block-error");

      await open(sessions.list);
      await page.waitForSelector("[data-regenerate-toggle][disabled]");
      await capture(page, "session-no-iteration");
    },

    async inspector() {
      const { id, work } = sessions.kitchen;
      const canvas = await open(id, [inBlock("wheel/neon", "screen"), inBlock("result/card", "card")]);
      await page.click('[data-slot-tab="result"]');
      await canvas.waitForSelector(inBlock("result/card", "chore"));
      await canvas.click(inBlock("result/card", "chore"));
      await page.waitForSelector('[data-block="result/card"]');
      await page.click('[data-control="headline"] input');
      await page.keyboard.press("Control+A");
      await page.keyboard.type("Fate has spoken");
      await page.keyboard.press("Enter");
      await page.click('[data-control="accent"] input[type="text"]');
      await page.keyboard.press("Control+A");
      await page.keyboard.type("#ff2bd6");
      await page.keyboard.press("Enter");
      await page.focus('[data-control="nameSize"] input[type="range"]');
      for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
      for (const prop of ["headline", "accent", "nameSize"]) await page.waitForSelector(`[data-control="${prop}"][data-overridden]`);
      await capture(page, "inspector-overridden");

      const card = join(work, "slots", "result", "card");
      const json = JSON.parse(readFileSync(join(card, "block.json"), "utf8"));
      delete json.props.appearance.accent;
      writeFileSync(join(card, "block.json"), JSON.stringify(json, null, 2));
      const tsx = readFileSync(join(card, "block.tsx"), "utf8");
      const signature = "headline, accent, nameSize";
      if (!tsx.includes(signature)) throw new Error("the card block no longer takes accent as expected");
      writeFileSync(join(card, "block.tsx"), tsx.replace(signature, "headline, nameSize").replace("  const [state, setState]", '  const accent = "#00f0ff";\n  const [state, setState]'));
      must("drop the card's accent", brainstorm(env, ["commit", id, "--from", work, "--thread", KITCHEN_THREAD, "--note", "Fix the card accent to cyan", "--json"]));
      await page.waitForSelector('[data-banner="inapplicable"] [data-override="result/card:accent"]', { timeout: PHASE_MS });
      await capture(page, "inspector-inapplicable");
    },

    async canvas() {
      const { id } = sessions.roulette;
      const canvas = await open(id, [inBlock("wheel/neon", "screen"), inBlock("result/card", "card")]);
      await capture(page, "session");
      await capture(page, "stage-tabs-focus", {
        keepFocus: true,
        each: async () => {
          await page.focus('[data-slot-tab="wheel"]');
          await page.keyboard.press("Shift");
        },
      });
      // The rest of this scene pins and selects across both slots, as the board shows them.
      await showView(canvas, "board");
      await capture(page, "session-board");

      await capture(page, "state-select-open", {
        each: async () => {
          if (!(await page.isVisible('[data-slot="select-content"]'))) await page.click('[data-control="palette"] [data-slot="select-trigger"]');
          await page.waitForSelector('[data-slot="select-content"]', { state: "visible" });
        },
      });
      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-slot="select-content"]', { state: "hidden" });

      await capture(page, "state-slider-focus", {
        keepFocus: true,
        each: async () => {
          await page.focus('[data-control="glow"] input[type="range"]');
          await page.keyboard.press("Shift");
        },
      });
      await capture(page, "state-focus-row", {
        keepFocus: true,
        each: async () => {
          await page.focus('[data-slot-id="wheel"] [data-variant="neon"]');
          await page.keyboard.press("Shift");
        },
      });
      await capture(page, "state-hover-variant", { each: () => page.hover('[data-slot-id="wheel"] [data-variant="reel"]') });
      await capture(page, "state-resize-handle", { each: () => page.hover('[data-slot="resize-handle"][aria-label="Inspector width"]') });
      await capture(page, "state-tooltip", {
        each: async () => {
          await page.hover('[data-slot="sidebar"] [data-sidebar="trigger"]');
          await page.waitForSelector('[data-slot="tooltip-content"]', { state: "visible" });
        },
      });
      await capture(page, "state-shortcut-hint", {
        each: async () => {
          await page.hover("[data-regenerate-toggle]");
          await page.waitForSelector('[data-slot="tooltip-content"]:has-text("Ctrl+R")', { state: "visible" });
        },
      });
      missing("state-colour-picker", "The Accent swatch opens the operating system's colour dialog, a separate window the page can't screenshot.");
      missing("state-escape", "Escape is behaviour rather than a look: each overlay, pick mode and the composer close to a state already shot. verify:7 and verify:4 press it.");

      await page.click('[data-slot="sidebar"] [data-sidebar="trigger"]');
      await page.waitForSelector('[data-slot="sidebar"][data-state="collapsed"]');
      await capture(page, "sidebar-collapsed");
      await page.click('[data-topbar] [data-sidebar="trigger"]');
      await page.waitForSelector('[data-slot="sidebar"][data-state="expanded"]');
      await untilStill(page);

      await ensurePicking();
      await capture(page, "state-pick-mode", {
        each: async () => {
          await canvas.hover(HEADLINE);
          await canvas.waitForSelector(".bs-pick[data-on]");
        },
      });

      const firstComment = "Make the headline louder; right now it reads like a footnote";
      await capture(page, "state-pin-composer", {
        keepFocus: true,
        each: async () => {
          if ((await page.$("[data-composer]")) !== null) await page.click('[data-composer] button:has-text("Cancel")');
          await pinComment(canvas, HEADLINE, firstComment);
        },
      });
      await page.click('[data-composer] button:has-text("Pin comment")');
      await page.waitForSelector('[data-feedback="1"][data-status="open"]');
      await pinComment(canvas, inBlock("wheel/neon", "spin-button"), "The spin button is too quiet next to the wheel");
      await page.keyboard.press("Control+Enter");
      await page.waitForSelector('[data-feedback="2"]');
      await pinComment(canvas, inBlock("result/card", "chore"), "The chore should read bigger than the winner's name");
      await page.keyboard.press("Control+Enter");
      await page.waitForSelector('[data-feedback="3"]');
      agentCommit(home, env, id, {
        file: "slots/wheel/neon/block.tsx",
        from: "Odds lean towards whoever has done least.",
        to: "Every spin is weighted by chores done.",
        args: ["--addresses", "2,3", "--note", "Louder spin, bigger chore"],
      });
      await page.waitForSelector('[data-feedback="3"][data-status="addressed"]', { timeout: PHASE_MS });
      await page.click('[data-feedback="3"] button:has-text("Confirm")');
      await page.waitForSelector('[data-feedback="3"][data-status="confirmed"]');
      await canvas.click('.bs-pin[data-pin="1"]');
      await page.waitForSelector('[data-feedback="1"][data-focused]');
      await capture(page, "feedback-list", {
        each: () => page.$eval("[data-feedback-panel]", (el) => el.scrollIntoView({ block: "end" })),
      });
      await capture(page, "state-hover-pin", { each: () => canvas.hover('.bs-pin[data-pin="2"]') });
      // Hovering scrolls pin 2 into view; later shots start from the top like the earlier ones.
      await canvas.evaluate(() => scrollTo(0, 0));
      await capture(page, "state-hover-feedback", {
        each: async () => {
          await page.$eval("[data-feedback-panel]", (el) => el.scrollIntoView({ block: "end" }));
          await page.hover('[data-feedback="2"]');
        },
      });
      await page.click('[data-feedback="1"] [data-feedback-action="edit"]');
      await capture(page, "state-feedback-edit", {
        keepFocus: true,
        each: () => page.$eval("[data-feedback-panel]", (el) => el.scrollIntoView({ block: "end" })),
      });
      await page.click('[data-feedback="1"] button:has-text("Cancel")');
      await page.click('[data-feedback="1"] [data-feedback-action="delete"]');
      await capture(page, "feedback-delete-confirm", {
        keepFocus: true,
        each: async () => {
          await page.$eval("[data-feedback-panel]", (el) => el.scrollIntoView({ block: "end" }));
          await page.focus('[data-feedback="1"] [data-feedback-cancel]');
          await page.keyboard.press("Shift");
        },
      });
      await page.click('[data-feedback="1"] [data-feedback-cancel]');
      await page.click("[data-inspector-toggle]");
      await page.waitForSelector("[data-inspector-rail]");
      await capture(page, "inspector-rail");
      await page.click("[data-rail-feedback]");
      await page.waitForSelector("[data-feedback-panel]");

      await openRegenerate("all", "Make the whole flow feel calmer, especially the spin");
      await capture(page, "state-regenerate-open-all", { keepFocus: true });
      await openRegenerate("blocks", "Keep the stamp, rework the layout");
      await capture(page, "state-regenerate-open-blocks", { keepFocus: true });
      await openRegenerate("described", "Try a calmer palette on every screen that shows the winner");
      await capture(page, "state-regenerate-open-described", { keepFocus: true });
      await openRegenerate("described", "");
      await capture(page, "state-regenerate-invalid", { keepFocus: true });
      await page.click('[data-regenerate-menu] button:has-text("Cancel")');
      await page.waitForSelector("[data-regenerate-menu]", { state: "detached" });


      // An aborted request is how the renderer meets a server that isn't answering, the case its notice is for.
      await page.route("**/v1/ui/sessions/*/actions", (route) => route.abort());
      await capture(page, "state-notice", {
        each: async (c) => {
          if ((await page.$("[data-slot=toast]")) !== null) await page.click("[data-toast-close]");
          await page.click('button[data-variant="reel"]');
          await page.waitForSelector("[data-slot=toast]");
          await park(page, c);
        },
      });
      await page.unroute("**/v1/ui/sessions/*/actions");
      if ((await page.$("[data-slot=toast]")) !== null) await page.click("[data-toast-close]");
      await page.waitForSelector("[data-slot=toast]", { state: "detached" });

      let release;
      const written = new Promise((r) => (release = r));
      await page.route("**/v1/ui/sessions/*/export", async (route) => {
        await written;
        await route.continue();
      });
      await page.click("[data-export]");
      await page.waitForSelector('[data-slot="popover-content"]:has-text("Writing the file")');
      await capture(page, "state-export-open", { keepFocus: true });
      release();
      await page.waitForSelector("[data-exported]");
      await capture(page, "state-export-done", { keepFocus: true });
      await page.click('[data-exported] button:has-text("Done")');
      await page.waitForSelector("[data-exported]", { state: "detached" });
      await page.unroute("**/v1/ui/sessions/*/export");

      await page.route("**/v1/ui/sessions/*/export", (route) => route.abort());
      await capture(page, "state-export-failed", {
        each: async (c) => {
          if ((await page.$("[data-slot=toast]")) !== null) await page.click("[data-toast-close]");
          await page.click("[data-export]");
          await page.waitForSelector("[data-slot=toast]");
          await page.keyboard.press("Escape");
          await park(page, c);
        },
      });
      await page.unroute("**/v1/ui/sessions/*/export");
      // The thread check every 15 s is a successful call, which may already have cleared the notice.
      if ((await page.$("[data-slot=toast]")) !== null) await page.click("[data-toast-close]");
      await page.waitForSelector("[data-slot=toast]", { state: "detached" });
    },

    async phases() {
      const { id } = sessions.roulette;
      const canvas = await open(id, [inBlock("wheel/neon", "screen"), inBlock("result/card", "card")], "board");

      t3.setHold(["send"]);
      await regenerate("all", "Make the spin feel less random");
      await phase("sending");
      await capture(page, "phase-sending", { keepFocus: true });
      t3.setHold([]);
      await phase("queued");
      await page.waitForSelector("[data-regenerate-menu]", { state: "detached" });
      await capture(page, "phase-queued");
      await capture(page, "state-regenerate-blocked", {
        each: async () => {
          await page.hover("[data-regenerate-blocked]");
          await page.waitForSelector('[data-slot="tooltip-content"]', { state: "visible" });
        },
      });

      t3.startRun(DEMO_THREAD);
      await phase("working");
      await capture(page, "phase-working");
      t3.ask(DEMO_THREAD);
      await phase("asking");
      await capture(page, "phase-asking");
      t3.endRun(DEMO_THREAD, "failed");
      await phase("run_failed");
      await capture(page, "phase-run-failed");

      await page.click('[data-request-action="retry"]');
      await phase("queued");
      t3.startRun(DEMO_THREAD);
      await phase("working");
      t3.endRun(DEMO_THREAD, "completed");
      await phase("no_change");
      await capture(page, "phase-no-change");
      await page.click('[data-request-action="withdraw"]');
      await phase("withdrawn");
      await capture(page, "phase-withdrawn");

      await regenerate("blocks");
      await phase("queued");
      t3.startRun(DEMO_THREAD);
      await phase("working");
      agentCommit(home, env, id, {
        file: "slots/result/card/block.tsx",
        from: "{chore.name}",
        to: "{chore.name.toUpperCase()}",
        args: ["--note", "Shout the chore"],
      });
      t3.endRun(DEMO_THREAD, "completed");
      await phase("fulfilled");
      await canvas.waitForSelector(inBlock("result/card", "card"));
      await capture(page, "phase-fulfilled");

      t3.setFailAfter(["send"]);
      await regenerate("described", "Try a calmer palette everywhere");
      await phase("send_failed");
      await capture(page, "phase-send-failed");
      t3.setFailAfter([]);
      await page.click('[data-request-action="retry"]');
      await phase("queued");

      t3.addThread(TAKEOVER_THREAD, { projectId: "chore-roulette", title: "Takeover thread" });
      must("take the session over", brainstorm(env, ["session", "attach", "Chore roulette", "--thread", TAKEOVER_THREAD, "--json"]));
      await phase("previous_thread");
      await capture(page, "phase-previous-thread");
      await page.click('[data-request-action="resend"]');
      await phase("queued");
      t3.setMissing(TAKEOVER_THREAD, true);
      await phase("thread_lost");
      await capture(page, "phase-thread-lost");
      await capture(page, "state-copied", {
        keepFocus: true,
        brief: true,
        each: async () => {
          // The clipboard only takes a write from a focused document.
          await page.bringToFront();
          await page.click('[data-request-detail] [data-request-action="copy_phrase"]');
          await page.waitForSelector('[data-request-detail] [data-request-action="copy_phrase"] [data-copied]');
        },
      });
      await page.click('[data-request-action="withdraw"]');
      await page.waitForSelector("[data-takeover]");
      await capture(page, "session-unattached");

      await open(sessions.longTitle.id, [inBlock("result/card", "card")]);
      await regenerate("all");
      await phase("queued");
      await page.waitForSelector("[data-regenerate-menu]", { state: "detached" });
      await capture(page, "phase-long-title");
      await page.click('[data-request-action="withdraw"]');
      await phase("withdrawn");
    },

    async overflow() {
      const names = ["bins", "laundry", "garden", "pantry", "bikes", "recycling"];
      for (const [i, name] of names.entries()) {
        const thread = `c0ffee00-0000-4000-8000-0000000d00${String(i).padStart(2, "0")}`;
        t3.addThread(thread, { projectId: `${name}-proj`, title: `${name} study` });
        seed(home, env, { title: `${name[0].toUpperCase()}${name.slice(1)} rota`, thread, project: gitRepo(home, name).repo, brief: `Who does the ${name} this week, and how the flat sees it was fair.` });
      }
      await goHome();
      await page.waitForSelector('[data-project="recycling-proj"]', { timeout: PHASE_MS });
      await capture(page, "home-many-projects");
    },

    /** Widens both panes for the restart shot; the roulette board is already kept from the canvas scene. */
    async widen() {
      await open(sessions.roulette.id, [inBlock("wheel/neon", "screen")], "board");
      await page.focus('[data-slot="resize-handle"][aria-label="Sidebar width"]');
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      await page.focus('[data-slot="resize-handle"][aria-label="Inspector width"]');
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
      await sleep(600);
    },
  };
}

/** Runs one scene; when it stops, every shot it hadn't reached yet is missing, with the scene's error as the reason. */
async function runScene(name, fn) {
  try {
    await fn();
  } catch (e) {
    const reason = `the ${name} scene stopped before this state: ${e.message.split("\n")[0]}`;
    console.log(`scene ${name} stopped: ${e.message}`);
    for (const shot of SHOTS) if (shot.scene === name && !outcomes.has(shot.name)) missing(shot.name, reason);
  }
}

/** Copies a physical-pixel rectangle of the screen to a PNG, as a DPI-aware process so the rectangle isn't rescaled. */
function screenGrab({ x, y, width, height }, path) {
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -Namespace Grab -Name Dpi -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();'",
    "[Grab.Dpi]::SetProcessDPIAware() | Out-Null",
    `$b = New-Object System.Drawing.Bitmap ${width}, ${height}`,
    "$g = [System.Drawing.Graphics]::FromImage($b)",
    `$g.CopyFromScreen(${x}, ${y}, 0, 0, $b.Size)`,
    `$b.Save('${path.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join("; ");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
}

const consoleNotes = [];
const firstLine = (label) => (e) => `${label}: ${e.split("\n")[0]}`;

build();

const emptyHome = mkdtempSync(join(tmpdir(), "bs-capture-empty-"));
const emptyEnv = appEnv(emptyHome);
{
  const run = await start(emptyHome, emptyEnv);
  try {
    await runScene("empty", async () => {
      await run.window.waitForSelector("[data-home-empty]");
      await capture(run.window, "home-empty");
    });
    consoleNotes.push(...run.errors.map(firstLine("empty home")));
  } finally {
    await run.app.close();
  }
  await runScene("launch", async () => {
    let held = await startRouted(emptyEnv, () => {});
    try {
      await held.window.waitForSelector("[data-home-loading]");
      await capture(held.window, "home-loading", { loading: true });
    } finally {
      await held.app.close();
    }
    held = await startRouted(emptyEnv, (route) => route.abort());
    try {
      await held.window.waitForSelector("[data-home-error]");
      await capture(held.window, "home-server-down");
    } finally {
      await held.app.close();
    }
  });
}

const home = mkdtempSync(join(tmpdir(), "bs-capture-"));
const env = appEnv(home);
const t3 = fakeT3(env.BRAINSTORM_FAKE_T3_STATE);
let run = await start(home, env);
try {
  const sessions = seedAll(home, env, t3);
  // The app remembers each thread it has already found, so only a fresh app notices one that vanished.
  t3.setMissing(LOOSE_THREAD, true);
  consoleNotes.push(...run.errors.map(firstLine("seeding")));
  await run.app.close();
  run = await start(home, env);
  for (const [name, fn] of Object.entries(scenes(run.window, home, env, t3, sessions))) {
    await runScene(name, fn);
    await run.window.keyboard.press("Escape").catch(() => {});
  }
  consoleNotes.push(...run.errors.map(firstLine("scenes")));
  await run.app.close();
  run = await start(home, env);
  await runScene("restart", async () => {
    await run.window.click(`[data-session="${sessions.roulette.id}"]`);
    const canvas = await canvasFrame(run.window);
    await canvas.waitForSelector('#canvas[data-view="board"]');
    await canvas.waitForSelector(inBlock("result/card", "card"));
    await capture(run.window, "prefs-restored");
  });
  consoleNotes.push(...run.errors.map(firstLine("restart")));
  await run.app.close();
  // Page screenshots stop at the web contents, and the native buttons are drawn outside them, so this shot is taken
  // from the screen, of a window with no viewport emulation, sized and themed through Electron itself.
  run = await launch(home, env);
  await runScene("window", async () => {
    await run.window.click(`[data-session="${sessions.roulette.id}"]`);
    await (await canvasFrame(run.window)).waitForSelector(inBlock("result/card", "card"));
    const shot = shotOf("window-title-bar");
    for (const c of COMBOS) {
      const { rect, size } = await run.app.evaluate(({ BrowserWindow, nativeTheme, screen }, [w, h, theme]) => {
        nativeTheme.themeSource = theme;
        const win = BrowserWindow.getAllWindows()[0];
        win.setContentSize(w, h);
        win.center();
        win.setAlwaysOnTop(true);
        win.setIgnoreMouseEvents(true);
        win.focus();
        const content = win.getContentBounds();
        return { rect: screen.dipToScreenRect(win, content), size: [content.width, content.height] };
      }, [c.width, c.height, c.theme]);
      // Playwright pins the page to light until told otherwise; nativeTheme alone themes the native buttons.
      await run.window.emulateMedia({ colorScheme: c.theme });
      // Scaled displays round the content size, so the page is waited on to match what the window really is.
      await run.window.waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 1 && Math.abs(innerHeight - h) <= 1, size);
      await untilStill(run.window);
      await sleep(800);
      screenGrab(rect, join(comboDir(c), `${shot.file}.png`));
    }
    await run.app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = "system"));
    outcomes.set("window-title-bar", { status: "captured" });
    console.log(`shot    ${shot.file}`);
  });
  consoleNotes.push(...run.errors.map(firstLine("window")));
} finally {
  await run.app.close();
}

for (const shot of SHOTS) {
  if (outcomes.has(shot.name)) continue;
  missing(shot.name, "the capture script never reached this state");
}

const manifest = {
  round,
  capturedAt: new Date().toISOString(),
  sizes: COMBOS.map((c) => `${c.theme} ${c.width}x${c.height}`),
  layout: "app/<theme>/<width>/<file>.png, or <file>.missing.txt saying why the shot isn't there",
  consoleNotes,
  shots: SHOTS.map((s) => ({ file: s.file, name: s.name, about: s.about, ...outcomes.get(s.name) })),
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

async function contactSheet(theme) {
  const dir = comboDir({ theme, width: 1440 });
  const tiles = SHOTS.map((s) => {
    const png = join(dir, `${s.file}.png`);
    const body = existsSync(png)
      ? `<img src="data:image/png;base64,${readFileSync(png).toString("base64")}">`
      : `<div class="gap">${(outcomes.get(s.name)?.reason ?? "missing").replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</div>`;
    return `<figure>${body}<figcaption>${s.file}</figcaption></figure>`;
  }).join("");
  const [bg, fg, muted] = theme === "dark" ? ["#151515", "#eee", "#333"] : ["#fafafa", "#111", "#ddd"];
  const html = `<!doctype html><style>
    body { margin: 0; padding: 16px; background: ${bg}; color: ${fg}; font: 13px system-ui; }
    main { display: grid; grid-template-columns: repeat(5, 352px); gap: 16px; }
    figure { margin: 0; }
    img, .gap { display: block; width: 352px; height: 220px; outline: 1px solid ${muted}; }
    .gap { box-sizing: border-box; padding: 12px; font-size: 11px; overflow: hidden; background: repeating-linear-gradient(45deg, transparent 0 8px, ${muted} 8px 9px); }
    figcaption { padding-top: 4px; font-weight: 600; }
  </style><main>${tiles}</main>`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 5 * 352 + 4 * 16 + 32, height: 800 } });
    await page.setContent(html);
    await page.screenshot({ path: join(out, `contact-${theme}-1440.png`), fullPage: true });
  } finally {
    await browser.close();
  }
}
await contactSheet("light");
await contactSheet("dark");

const captured = SHOTS.filter((s) => outcomes.get(s.name)?.status === "captured").length;
console.log(`\n${captured} of ${SHOTS.length} shots captured in each of ${COMBOS.length} sizes, in ${out}`);
for (const note of consoleNotes) console.log(`console: ${note}`);
