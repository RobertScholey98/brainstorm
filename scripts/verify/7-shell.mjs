// Proves the app shell on the seeded demo: the home sidebar groups every brainstorm under its project's name, a
// click swaps in that brainstorm's sidebar and the back control returns home, a frame wider than the canvas scrolls
// inside the canvas and never under the Inspector, the page never scrolls sideways, and no Radix is bundled.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, checks, launch, root, shot, workspace } from "./electron.mjs";

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

/** A one-slot session in the demo's project, whose frame is wider than the canvas column. */
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

/** A repo named kitchen, with the session started from a worktree folder of it, as an agent in T3 would. */
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
    { label: "Other project", rows: ["Loose notesNo iterations yet"] },
    { label: "kitchen", rows: ["Kitchen rotaNo iterations yet"] },
    { label: "chores", rows: ["Start a taskIteration 1", "Chore rouletteIteration 1"] },
  ]);
  check(
    "with nothing open, the main panel says how to start one",
    (await window.textContent("[data-home-empty]"))?.includes("run /ux-brainstorm in a T3 thread on your project"),
    true,
  );
  check("home shows no Regenerate or Export", [await window.$("[data-regenerate-toggle]"), await window.$("[data-export]")], [null, null]);
  await window.waitForTimeout(300);
  await shot(window, shots, "home-light");

  await window.click('[data-project="kitchen-proj"] [data-project-label]');
  await window.waitForSelector(`[data-session="${kitchen}"]`, { state: "detached" });
  check("a project group collapses", await window.isVisible('[data-project="kitchen-proj"] [data-project-label]'), true);
  await window.click('[data-project="kitchen-proj"] [data-project-label]');
  await window.waitForSelector(`[data-session="${kitchen}"]`);

  await window.click(`[data-session="${wide}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  check(
    "clicking a brainstorm swaps the sidebar to it",
    [await window.$('[data-sidebar-panel="home"]'), (await window.textContent("[data-session-title]"))?.trim(), (await window.textContent("[data-topbar] h1"))?.trim()],
    [null, "Start a task", "Start a task"],
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

  const canvas = await canvasFrame(window);
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
  check("the back control returns home", [await window.isVisible("[data-home-empty]"), await window.$("iframe[title=Canvas]")], [true, null]);

  await window.click(`[data-session="${roulette}"]`);
  await (await canvasFrame(window)).waitForSelector('[data-bid="wheel/neon"]');
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
  await window.waitForSelector("[data-home-empty]");
  await window.click(`[data-session="${loose}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"] [data-thread="lost"]');
  check("a brainstorm whose thread is gone says so in its sidebar", (await window.textContent('[data-thread="lost"]'))?.trim(), "Unattached");
  await window.click("[data-back]");
  await window.waitForSelector(`[data-session="${loose}"][data-lost] [data-session-lost]`);
  check("its home row carries the lost marker", (await window.textContent(`[data-session="${loose}"] [data-session-lost]`))?.trim(), "Thread lost");
  check("the window logged no errors or warnings after the restart", errors, []);
} finally {
  await app.close();
}
finish();
