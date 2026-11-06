import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, root, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("shell");
const { check, finish } = checks();

const KITCHEN_THREAD = "c0ffee00-0000-4000-8000-00000000c4a2";
const LOOSE_THREAD = "c0ffee00-0000-4000-8000-00000000c4a3";

function must(step, r) {
  if (r.code !== 0 || r.json?.ok !== true) throw new Error(`${step} failed (exit ${r.code}): ${r.stdout}${r.stderr}`);
  return r.json.data;
}

const newSession = (title, thread, project) =>
  must(`session new ${title}`, brainstorm(env, ["session", "new", "--title", title, "--thread", thread, ...(project ? ["--project", project] : []), "--json"]))
    .session.id;

function gitRepo(name) {
  const repo = join(home, "repos", name);
  mkdirSync(repo, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  return { repo, git };
}

function wideSession() {
  const id = newSession("Start a task", DEMO_THREAD, gitRepo("chores").repo);
  const work = join(home, "work", id);
  must("pull wide", brainstorm(env, ["pull", id, "--out", work, "--json"]));
  cpSync(join(root, "scripts", "demo", "chore-roulette", "slots", "result", "card"), join(work, "slots", "result", "card"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  writeFileSync(join(work, "brainstorm.json"), JSON.stringify({ ...manifest, slots: [{ id: "result", title: "Wide frame", frame: { width: 980, height: 600 } }] }));
  must("commit wide", brainstorm(env, ["commit", id, "--from", work, "--json"]));
  return id;
}

function kitchenWorktree() {
  const { git } = gitRepo("kitchen");
  const worktree = join(home, "repos", "t3-9f2e11aa");
  git("worktree", "add", "-q", worktree);
  return worktree;
}

let { app, window, errors } = await launch(home, env);
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  const t3 = fakeT3(join(home, "fake-t3.json"));
  const { session: roulette } = seedDemo(home, env);
  const wide = wideSession();
  t3.addThread(KITCHEN_THREAD, { projectId: "kitchen-proj", title: "Kitchen rota study" });
  t3.addThread(LOOSE_THREAD, { projectId: "loose-proj", title: "Loose notes" });
  const kitchen = newSession("Kitchen rota", KITCHEN_THREAD, kitchenWorktree());
  const loosePath = join(home, "not-a-repo");
  mkdirSync(loosePath);
  const loose = newSession("Loose notes", LOOSE_THREAD, loosePath);

  await window.waitForSelector(`[data-session="${loose}"]`);
  const groups = () =>
    window.$$eval("[data-project]", (els) =>
      els.map((g) => ({
        label: g.querySelector("[data-project-label]")?.textContent?.trim(),
        rows: [...g.querySelectorAll("[data-session]")].map((r) => r.textContent?.replace(/\s+/g, " ").trim()),
      })),
    );
  check("home groups every brainstorm under its project, newest activity first", await groups(), [
    { label: "Other project", rows: ["Loose notesNo iterations yet·just now"] },
    { label: "kitchen", rows: ["Kitchen rotaNo iterations yet·just now"] },
    { label: "chores", rows: ["Start a taskIteration 1·just now", "Chore rouletteIteration 1·just now"] },
  ]);
  check(
    "with nothing open, the main panel says how to start one",
    (await window.textContent("[data-home-hint]"))?.includes("run /ux-brainstorm in a T3 thread on your project"),
    true,
  );
  check(
    "and shows every brainstorm as a card, newest activity first",
    await window.$$eval("[data-overview-session]", (els) => els.map((e) => e.dataset.overviewSession)),
    [loose, kitchen, wide, roulette],
  );
  check("the overview is the active row in the sidebar", (await window.$("[data-overview][data-active]")) !== null, true);
  check("home shows no Regenerate or Export", [await window.$("[data-regenerate-toggle]"), await window.$("[data-export]")], [null, null]);
  await window.waitForTimeout(300);
  await shot(window, shots, "home-light");

  await window.click('[data-project="kitchen-proj"] [data-project-label]');
  await window.waitForSelector(`[data-session="${kitchen}"]`, { state: "detached" });
  check("a project group collapses", await window.isVisible('[data-project="kitchen-proj"] [data-project-label]'), true);
  await window.click('[data-project="kitchen-proj"] [data-project-label]');
  await window.waitForSelector(`[data-session="${kitchen}"]`);

  const canvas = await openSession(window, wide);
  check(
    "clicking a brainstorm swaps the sidebar to it",
    [
      await window.$('[data-sidebar-panel="home"]'),
      (await window.textContent("[data-topbar] [data-breadcrumb-project]"))?.trim(),
      (await window.textContent("[data-topbar] h1"))?.trim(),
    ],
    [null, "chores", "Start a task"],
  );
  check(
    "the brainstorm sidebar shows the back control, the thread and the slot's variants",
    [
      (await window.textContent("[data-back]"))?.trim(),
      (await window.textContent('[data-thread="attached"]'))?.trim(),
      await window.$$eval('[data-slot-id="result"] [data-variant]', (els) => els.map((e) => e.dataset.variant)),
    ],
    ["All brainstorms", "Attached", ["card"]],
  );

  await canvas.waitForSelector('[data-bid="result/card"]');
  const box = (selector) =>
    window.$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  const iframe = await box("iframe[title=Canvas]");
  const region = await box("[data-canvas-region]");
  const inspector = await box("aside[aria-label=Inspector]");
  check("the canvas frame fills its region", [iframe.left === region.left, iframe.right === region.right], [true, true]);
  check("the canvas region ends where the Inspector starts", iframe.right <= inspector.left, true);
  const frameIn = (scroll) =>
    canvas.evaluate((x) => {
      scrollTo(x === "end" ? document.documentElement.scrollWidth : 0, 0);
      const r = document.querySelector(".bs-frame-body").getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
    }, scroll);
  const start = await frameIn("start");
  check("the 980 px frame is wider than the canvas, so the canvas scrolls", [start.width, start.scrollWidth > start.viewport], [980, true]);
  check("scrolled to the start, the frame begins inside the canvas", start.left >= 0, true);
  const end = await frameIn("end");
  check(
    "scrolled to the end, the frame's right edge is left of the Inspector",
    [iframe.left + end.right <= inspector.left, end.right <= end.viewport],
    [true, true],
  );
  await frameIn("start");
  check(
    "the page never scrolls sideways",
    await window.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, document.body.scrollWidth <= innerWidth, scrollX]),
    [true, true, 0],
  );
  await window.waitForTimeout(300);
  await shot(window, shots, "session-light");

  await window.click('[data-slot="sidebar"] [data-sidebar="trigger"]');
  await window.waitForSelector('[data-slot="sidebar"][data-state="collapsed"]');
  await window.waitForTimeout(400);
  check(
    "the collapse toggle hides the sidebar, gives the main panel its width and moves the toggle to the top bar",
    [(await box("[data-canvas-region]")).left < region.left, await window.isVisible('[data-topbar] [data-sidebar="trigger"]')],
    [true, true],
  );
  await window.click('[data-topbar] [data-sidebar="trigger"]');
  await window.waitForSelector('[data-slot="sidebar"][data-state="expanded"]');
  await window.waitForTimeout(400);

  await window.click("[data-back]");
  await window.waitForSelector('[data-sidebar-panel="home"]');
  check(
    "the back control shows the home list and keeps the open brainstorm on screen",
    [await window.isVisible("iframe[title=Canvas]"), (await window.$(`[data-session="${wide}"][data-active]`)) !== null],
    [true, true],
  );
  await window.click(`[data-session="${wide}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  check("its row goes back to the same brainstorm", (await window.textContent("[data-topbar] h1"))?.trim(), "Start a task");
  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector("[data-home-overview]");
  check("Overview closes it and returns home", await window.$("iframe[title=Canvas]"), null);

  const rouletteCanvas = await openSession(window, roulette);
  await rouletteCanvas.waitForSelector('[data-bid="wheel/neon"]');
  await rouletteCanvas.click(inBlock("wheel/neon", "screen"));
  await window.keyboard.press("Control+r");
  await window.waitForSelector("[data-regenerate-menu]");
  check("Ctrl+R opens Regenerate, even with the canvas focused", await window.isVisible("[data-regenerate-menu] [data-send]"), true);
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-regenerate-menu]", { state: "detached" });

  const inspectorWidth = () => window.$eval("aside[aria-label=Inspector]", (el) => el.getBoundingClientRect().width);
  const narrow = await inspectorWidth();
  await window.focus('[data-slot="resize-handle"][aria-label="Inspector width"]');
  await window.keyboard.press("ArrowLeft");
  await window.keyboard.press("ArrowLeft");
  check("the Inspector's handle widens it 16 px an arrow press", (await inspectorWidth()) - narrow, 32);
  await window.click("[data-back]");
  await (await openSession(window, wide)).waitForSelector('[data-bid="result/card"]');
  check("another brainstorm opens with the same Inspector width", await inspectorWidth(), narrow + 32);
  await window.click("[data-back]");
  await (await openSession(window, roulette)).waitForSelector('[data-bid="wheel/neon"]');
  check(
    "every slot marks its showing variant, and only the selected slot's row is tinted",
    [
      await window.$$eval("[data-variant][data-showing]", (els) => els.map((e) => e.dataset.variant)),
      await window.$$eval("[data-variant][data-active]", (els) => els.map((e) => e.dataset.variant)),
    ],
    [["neon", "card"], ["neon"]],
  );
  await window.emulateMedia({ colorScheme: "dark" });
  await window.waitForTimeout(400);
  await shot(window, shots, "session-dark");
  check(
    "dark mode follows prefers-color-scheme",
    await window.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(28, 28, 26)",
  );

  const bundle = readdirSync(join(root, "dist", "renderer"), { recursive: true })
    .filter((f) => /\.(js|css|html)$/.test(f))
    .flatMap((f) => readFileSync(join(root, "dist", "renderer", f), "utf8").match(/radix|@radix-ui/gi) ?? []);
  check("the built renderer has no Radix", bundle, []);
  check("the window logged no errors or warnings", errors, []);

  // A fresh app asks T3 about each thread on first view, which is how a thread that vanished is found.
  await app.close();
  t3.setMissing(LOOSE_THREAD, true);
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForSelector("[data-home-overview]");
  await window.click(`[data-session="${loose}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"] [data-thread="lost"]');
  check("a brainstorm whose thread is gone says so in its sidebar", (await window.textContent('[data-thread="lost"]'))?.trim(), "Unattached");
  check(
    "before the first iteration, the Inspector says when settings appear and Pin comment is disabled",
    [(await window.textContent("[data-inspector-empty]"))?.includes("first iteration"), await window.isDisabled("[data-pick-toggle]")],
    [true, true],
  );
  await window.click("[data-back]");
  await window.waitForSelector(`[data-session="${loose}"][data-lost] [data-session-lost]`);
  check("its home row carries the lost marker", (await window.textContent(`[data-session="${loose}"] [data-session-lost]`))?.trim(), "Thread lost");
  check("the window logged no errors or warnings after the restart", errors, []);
} finally {
  await app.close();
}
finish();
