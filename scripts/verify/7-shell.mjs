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
    { label: "Other project", rows: ["Loose notesnow"] },
    { label: "kitchen", rows: ["Kitchen rotanow"] },
    { label: "chores", rows: ["Start a tasknow", "Chore roulettenow"] },
  ]);
  check(
    "each home row is one 32 px line, its age at the right end",
    await window.$$eval("[data-session]", (rows) =>
      rows.every((r) => {
        const row = r.getBoundingClientRect();
        const age = r.querySelector("[data-age]").getBoundingClientRect();
        return Math.round(row.height) === 32 && row.right - age.right < 12;
      }),
    ),
    true,
  );
  check("the overview carries the page heading", (await window.textContent("[data-home-overview] h1"))?.trim(), "All brainstorms");
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
  check(
    "the window header moves the window, and every control in it opts out",
    await window.evaluate(() => {
      const region = (el) => getComputedStyle(el).getPropertyValue("-webkit-app-region");
      const header = document.querySelector("[data-topbar]");
      return {
        header: region(header),
        sidebar: region(document.querySelector('[data-sidebar="header"]')),
        controls: [...document.querySelectorAll("[data-topbar] button, [data-topbar] a, [data-sidebar='header'] button")].map(region).filter((r) => r !== "no-drag"),
        top: Math.round(header.getBoundingClientRect().top),
      };
    }),
    { header: "drag", sidebar: "drag", controls: [], top: 0 },
  );
  check("the Inspector toggle sits in the header, pressed while the Inspector shows", await window.getAttribute("[data-topbar] [data-inspector-toggle]", "aria-pressed"), "true");
  check("the canvas region ends where the Inspector starts", iframe.right <= inspector.left, true);
  const frameIn = (scroll) =>
    canvas.evaluate((x) => {
      scrollTo(x === "end" ? document.documentElement.scrollWidth : 0, 0);
      const r = document.querySelector(".bs-frame-body").getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, viewport: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth };
    }, scroll);
  const fit = () =>
    canvas.evaluate(() => {
      const body = document.querySelector('.bs-frame:not([data-offstage]) .bs-frame-body').getBoundingClientRect();
      const de = document.documentElement;
      return { sideways: de.scrollWidth > de.clientWidth, zoom: document.querySelector(".bs-frame-zoom")?.dataset.zoom ?? null, fits: body.left >= 0 && body.right <= de.clientWidth };
    });
  check("a brainstorm opens on the stage", await window.getAttribute("[data-canvas-region]", "data-canvas-view"), "stage");
  check("the stage zooms the 980 px frame to fit, says by how much, and never scrolls sideways at 1440", await fit(), { sideways: false, zoom: "83", fits: true });
  await window.setViewportSize({ width: 1100, height: 720 });
  await canvas.waitForFunction(() => document.querySelector(".bs-frame-zoom")?.dataset.zoom !== "83");
  check("and at 1100", await fit(), { sideways: false, zoom: "49", fits: true });
  await window.setViewportSize({ width: 1440, height: 900 });
  await canvas.waitForFunction(() => document.querySelector(".bs-frame-zoom")?.dataset.zoom === "83");
  await window.click("[data-board-toggle]");
  await canvas.waitForSelector('#canvas[data-view="board"]');
  check("All slots shows the board, where a frame keeps its own size", [await window.getAttribute("[data-board-toggle]", "aria-pressed"), await canvas.$(".bs-frame-zoom")], ["true", null]);
  const start = await frameIn("start");
  check("the 980 px frame is wider than the board, so the board scrolls", [start.width, start.scrollWidth > start.viewport], [980, true]);
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
  await window.click("[data-board-toggle]");
  await canvas.waitForSelector('#canvas[data-view="stage"]');

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
  const staged = () => rouletteCanvas.$$eval(".bs-frame:not([data-offstage])", (els) => els.map((e) => e.dataset.slot));
  check("the stage shows the first slot alone, with a tab per slot", [await staged(), await window.$$eval("[data-slot-tab]", (els) => els.map((e) => e.dataset.slotTab))], [["wheel"], ["wheel", "result"]]);
  await window.click('[data-slot-tab="result"]');
  await rouletteCanvas.waitForSelector('.bs-frame[data-slot="result"]:not([data-offstage])');
  check("a tab puts its slot on the stage and its block in the Inspector", [await staged(), await window.getAttribute("[data-block]", "data-block")], [["result"], "result/card"]);
  await window.focus('[data-slot-tab="result"]');
  await window.keyboard.press("ArrowLeft");
  await rouletteCanvas.waitForSelector('.bs-frame[data-slot="wheel"]:not([data-offstage])');
  check("arrow keys on the tabs move between slots", await staged(), ["wheel"]);
  await window.click('[data-slot-step="next"]');
  await rouletteCanvas.waitForSelector('.bs-frame[data-slot="result"]:not([data-offstage])');
  check("the next arrow steps to the next slot, and stops at the last", [await staged(), await window.isDisabled('[data-slot-step="next"]')], [["result"], true]);
  await window.click('[data-slot-step="previous"]');
  await rouletteCanvas.waitForSelector('.bs-frame[data-slot="wheel"]:not([data-offstage])');

  const pinAt = (id) =>
    rouletteCanvas.evaluate((pinId) => {
      const pin = document.querySelector(`.bs-pin[data-pin="${pinId}"]`);
      const anchor = document.querySelector('[data-bid="wheel/neon"] [data-part="spin-button"]');
      if (pin === null || !pin.hasAttribute("data-placed")) return null;
      const p = pin.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      return Math.abs(p.left + p.width / 2 - a.right) <= 2 && Math.abs(p.top + p.height / 2 - a.top) <= 2;
    }, id);
  await window.click("[data-pick-toggle]");
  await rouletteCanvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-composer]");
  await window.keyboard.type("Spin should be bigger");
  await window.keyboard.press("Control+Enter");
  await window.waitForSelector('[data-feedback="1"]');
  await rouletteCanvas.waitForSelector('.bs-pin[data-pin="1"][data-placed]');
  check("a pin picked on the stage lands on its element's corner", await pinAt(1), true);
  await window.click("[data-board-toggle]");
  await rouletteCanvas.waitForSelector('#canvas[data-view="board"]');
  check(
    "on the board both slots sit side by side and fit at 1440, and the pin stays on its element",
    [await staged(), await rouletteCanvas.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), await pinAt(1)],
    [["wheel", "result"], true, true],
  );
  await window.click("[data-board-toggle]");
  await rouletteCanvas.waitForSelector('#canvas[data-view="stage"]');

  await window.click('[data-slot-tab="result"]');
  await window.click("[data-board-toggle]");
  await rouletteCanvas.waitForSelector('#canvas[data-view="board"]');
  await rouletteCanvas.click(inBlock("wheel/neon", "screen"));
  await window.keyboard.press("Control+r");
  await window.waitForSelector("[data-regenerate-menu]");
  check("Ctrl+R opens Regenerate, even with the canvas focused", await window.isVisible("[data-regenerate-menu] [data-send]"), true);
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-regenerate-menu]", { state: "detached" });

  const inspectorWidth = () => window.$eval("aside[aria-label=Inspector]", (el) => el.getBoundingClientRect().width);
  await window.click("[data-inspector-toggle]");
  await window.waitForSelector("[data-inspector-rail]");
  check("the Inspector collapses to a 40 px rail that counts the feedback", [await inspectorWidth(), (await window.textContent("[data-rail-count]"))?.trim()], [40, "1"]);
  await window.click("[data-rail-expand]");
  await window.waitForSelector("[data-feedback-panel]");
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
  const note = () =>
    window.$eval('[data-slot-id="wheel"] [data-about]', (el) => {
      const body = el.querySelector("[data-about-body]");
      const name = el.closest("li").querySelector("[data-variant-title]");
      return {
        cut: body.scrollHeight > body.clientHeight,
        more: el.querySelector("[data-about-more]")?.textContent ?? null,
        aligned: Math.round(body.getBoundingClientRect().left) === Math.round(name.getBoundingClientRect().left),
        label: body.querySelector("p > strong:first-child")?.textContent ?? null,
      };
    });
  check("a long variant note shows three lines under More, starting where the variant's name does, its label bold", await note(), {
    cut: true,
    more: "More",
    aligned: true,
    label: "Hypothesis:",
  });
  await window.click('[data-slot-id="wheel"] [data-about-more]');
  check("More shows the whole note in place", await note(), { cut: false, more: "Less", aligned: true, label: "Hypothesis:" });
  await window.click('[data-slot-id="wheel"] [data-about-more]');
  check("and Less folds it", (await note()).more, "More");
  check(
    "the sidebar never scrolls sideways",
    await window.$eval('[data-slot="sidebar-content"]', (el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await window.emulateMedia({ colorScheme: "dark" });
  await window.waitForTimeout(400);
  await shot(window, shots, "session-dark");
  check(
    "dark mode follows prefers-color-scheme",
    await window.evaluate(() => getComputedStyle(document.body).backgroundColor),
    "rgb(26, 26, 24)",
  );

  const bundle = readdirSync(join(root, "dist", "renderer"), { recursive: true })
    .filter((f) => /\.(js|css|html)$/.test(f))
    .flatMap((f) => readFileSync(join(root, "dist", "renderer", f), "utf8").match(/radix|@radix-ui/gi) ?? []);
  check("the built renderer has no Radix", bundle, []);
  check("the window logged no errors or warnings", errors, []);

  await window.route("**/v1/ui/sessions/*/actions", (route) => route.abort());
  await window.click('[data-slot-id="wheel"] [data-variant="reel"]');
  await window.waitForSelector("[data-slot=toast]");
  check(
    "a notice sits in the canvas region, off the Inspector",
    await window.evaluate(() => {
      const toast = document.querySelector("[data-slot=toast]").getBoundingClientRect();
      const inspector = document.querySelector("aside[aria-label=Inspector]").getBoundingClientRect();
      return { inRegion: document.querySelector("[data-canvas-region] [data-slot=toast]") !== null, clear: toast.right <= inspector.left };
    }),
    { inRegion: true, clear: true },
  );
  await window.click("[data-toast-close]");
  await window.waitForSelector("[data-slot=toast]", { state: "detached" });
  check("a notice closes from its close button", await window.$("[data-slot=toast]"), null);
  await window.click('[data-slot-id="wheel"] [data-variant="reel"]');
  await window.waitForSelector("[data-slot=toast]");
  await window.waitForTimeout(7000);
  check("and stays until then, however long it has been up", await window.isVisible("[data-slot=toast]"), true);
  await window.unroute("**/v1/ui/sessions/*/actions");
  await window.click('[data-slot-id="wheel"] [data-variant="reel"]');
  await window.waitForSelector("[data-slot=toast]", { state: "detached" });
  check("the next call that succeeds clears it", await window.$("[data-slot=toast]"), null);
  await window.click('[data-slot-id="wheel"] [data-variant="neon"]');
  await window.click("[data-inspector-toggle]");
  await window.waitForSelector("[data-inspector-rail]");
  const sidebarWidth = () => window.$eval('[data-slot="sidebar-container"]', (el) => el.getBoundingClientRect().width);
  await window.focus('[data-slot="resize-handle"][aria-label="Sidebar width"]');
  await window.keyboard.press("ArrowRight");
  await window.waitForTimeout(600);
  const widths = { sidebar: await sidebarWidth(), inspector: narrow + 32 };

  // A restart moves the server to a new port, so the window's origin and its own storage change; the layout must not.
  await app.close();
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1440, height: 900 });
  const again = await openSession(window, roulette);
  await again.waitForSelector('#canvas[data-view="board"]');
  check(
    "after a restart the sidebar width, the rail and this brainstorm's board come back as Rob left them",
    [await sidebarWidth(), (await window.$("[data-inspector-rail]")) !== null, await window.getAttribute("[data-board-toggle]", "aria-pressed")],
    [widths.sidebar, true, "true"],
  );
  await window.click("[data-rail-expand]");
  await window.waitForSelector("[data-feedback-panel]");
  check("and so does the Inspector width", await inspectorWidth(), widths.inspector);
  check("the window logged no errors or warnings across the restart", errors, []);

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
    "the takeover phrase sits on its own line at the sidebar's width, with Copy phrase under it",
    await window.$eval("[data-takeover]", (el) => {
      const phrase = el.querySelector("[data-takeover-phrase]").getBoundingClientRect();
      const copy = el.querySelector("button").getBoundingClientRect();
      return [phrase.width > el.getBoundingClientRect().width * 0.7, copy.top >= phrase.bottom];
    }),
    [true, true],
  );
  check(
    "before the first iteration, the Inspector says when settings appear and Pin comment is disabled",
    [(await window.textContent("[data-inspector-empty]"))?.includes("first iteration"), await window.isDisabled("[data-pick-toggle]")],
    [true, true],
  );
  await window.click("[data-back]");
  await window.waitForSelector(`[data-session="${loose}"][data-lost] [data-session-lost]`);
  check("its home row carries the lost marker", (await window.textContent(`[data-session="${loose}"] [data-session-lost]`))?.trim(), "Thread lost");
  check("the window logged no errors or warnings after the restart", errors, []);

  await app.close();
  let serverDown = true;
  ({ app, window, errors } = await launch(home, env, { sessions: (route) => (serverDown ? route.abort() : route.continue()) }));
  await window.waitForSelector("[data-home-error]");
  check(
    "a list that fails at launch shows its error with Try again, and the sidebar stops loading",
    [await window.isVisible("[data-home-retry]"), await window.isVisible("[data-home-loading]"), (await window.textContent('[data-sidebar-panel="home"]'))?.includes("The list didn't load")],
    [true, false, true],
  );
  serverDown = false;
  await window.click("[data-home-retry]");
  await window.waitForSelector("[data-overview-session]");
  check("Try again loads the overview and the sidebar list", await window.isVisible(`[data-session="${loose}"]`), true);

  // No viewport emulation from here: the page must track the real window, as it does for Rob.
  await app.close();
  ({ app, window, errors } = await launch(home, env));
  await window.waitForSelector("[data-overview-session]");
  const sized = async (width, height) => {
    const content = await app.evaluate(({ BrowserWindow }, [w, h]) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(w, h);
      const b = win.getContentBounds();
      return [b.width, b.height];
    }, [width, height]);
    await window.waitForFunction(([w, h]) => innerWidth === w && innerHeight === h, content).catch(() => {});
    return [content, await window.evaluate(() => [innerWidth, innerHeight])];
  };
  for (const [w, h] of [[1300, 820], [1700, 1050]]) {
    const [content, page] = await sized(w, h);
    check(`resized to ${w} x ${h}, the page fills the window's content area`, page, content);
  }
  check(
    "the window stops at the brief's 1100 x 720",
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(800, 500);
      return [win.getMinimumSize(), win.getContentSize().map((n, i) => n >= [1100, 720][i])];
    }),
    [[1100, 720], [true, true]],
  );
  await sized(1440, 900);
  check(
    "the native buttons overlay the header's right end, past the last control",
    await window.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;top:0;left:env(titlebar-area-x,0px);width:env(titlebar-area-width,100vw);height:1px";
      document.body.append(probe);
      const area = probe.getBoundingClientRect();
      probe.remove();
      const last = [...document.querySelectorAll("[data-topbar] button")].at(-1)?.getBoundingClientRect();
      return { overlay: area.right < innerWidth - 100, clear: last === undefined || last.right <= area.right };
    }),
    { overlay: true, clear: true },
  );
  check("the window logged no errors or warnings at its real size", errors, []);
} finally {
  await app.close();
}
finish();
