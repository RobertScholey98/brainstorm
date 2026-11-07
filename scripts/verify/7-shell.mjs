import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, root, settled, shot, workspace } from "./electron.mjs";

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
  writeFileSync(join(work, "brainstorm.json"), JSON.stringify({ ...manifest, slots: [{ id: "result", title: "Wide frame", frame: { width: 980, height: 360 } }] }));
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
        label: g.querySelector("[data-project-label]")?.innerText?.trim(),
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
  const statusWidth = () => window.$eval("[data-home-filters] [data-slot=segmented]", (s) => Math.round(s.getBoundingClientRect().width));
  const loadedStatusWidth = await statusWidth();
  check(
    "at the title step, the one size every page heading takes",
    await window.$eval("[data-home-overview] h1", (h) => [getComputedStyle(h).fontSize, getComputedStyle(h).lineHeight, getComputedStyle(h).fontWeight]),
    ["22px", "28px", "600"],
  );
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
  await window.waitForFunction(() => [...document.querySelectorAll("[data-preview]")].every((p) => p.dataset.preview !== "loading"), null, { timeout: 15_000 });
  check(
    "each card's preview settles: a still for a brainstorm with an iteration, a quiet note for one waiting on its first commit",
    await window.$$eval("[data-overview-session]", (cards) => cards.map((c) => [c.dataset.overviewSession, c.querySelector("[data-preview]")?.dataset.preview])),
    [
      [loose, "empty"],
      [kitchen, "empty"],
      [wide, "still"],
      [roulette, "still"],
    ],
  );
  check(
    "a short block in a tall frame fills its card's still as it fills its frame on the stage, with no page showing under it",
    await window.$eval(`[data-overview-session="${wide}"] [data-preview="still"] img`, (img) => {
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), canvas.height - 2, 1, 1).data;
      return (r + g + b) / 3 < 64;
    }),
    true,
  );
  check(
    "every preview, still, waiting or failed, sits on one mat, and the wide frame, shorter than its well, ends on the mat rather than on a blank band",
    await window.$$eval("[data-overview-session] [data-preview]", (wells) => {
      const mats = new Set(wells.map((w) => getComputedStyle(w).backgroundColor + getComputedStyle(w).backgroundImage));
      const stills = wells.map((w) => w.querySelector("img[data-preview-still]")).filter(Boolean);
      const ends = stills.map((img) => Math.round(img.closest("[data-preview]").getBoundingClientRect().bottom - img.getBoundingClientRect().bottom));
      return [mats.size, ends.some((gap) => gap > 12)];
    }),
    [1, true],
  );
  check(
    "no preview frame is left running once every still is taken",
    await window.$$eval('iframe[title="Preview"]', (frames) => frames.length),
    0,
  );
  check(
    "cards in a row share one height, with each meta line on the card's bottom edge, whether or not it has a brief",
    await window.$$eval("[data-overview-session]", (cards) => {
      const rows = new Map();
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const foot = c.querySelector("[data-overview-footer]").getBoundingClientRect();
        const row = rows.get(Math.round(r.top)) ?? [];
        row.push([Math.round(r.height), Math.round(r.bottom - foot.bottom)]);
        rows.set(Math.round(r.top), row);
      }
      return [...rows.values()].map((row) => [new Set(row.map(([h]) => h)).size, new Set(row.map(([, gap]) => gap)).size, row.length > 1]);
    }),
    [[1, 1, true]],
  );
  check(
    "and every card is the same height, with or without a brief, so no row holds a blank the next doesn't",
    await window.$$eval("[data-overview-session]", (cards) => new Set(cards.map((c) => Math.round(c.getBoundingClientRect().height))).size),
    1,
  );
  check(
    "a card with no brief and no fork gives its title the brief's room, two 20 px lines in 44 px, so a long title wraps instead of cutting beside a blank",
    await window.$$eval("[data-card-title-wraps]", (titles) => [
      titles.length > 0,
      [...new Set(titles.map((t) => Math.round(t.closest("button").getBoundingClientRect().height)))],
      getComputedStyle(titles[0]).webkitLineClamp,
    ]),
    [true, [44], "2"],
  );
  check("the overview is the active row in the sidebar", (await window.$("[data-overview][data-active]")) !== null, true);
  check(
    "one gutter rule: a sidebar row's fill and the overview's cards sit as far off both edges of their pane",
    await settled(() =>
      window.evaluate(() => {
        const inset = (el, pane) => {
          const [e, p] = [el.getBoundingClientRect(), pane.getBoundingClientRect()];
          return [Math.round(e.left - p.left), Math.round(p.right - e.right)];
        };
        const scroller = document.querySelector('[data-slot="sidebar-content"]').getBoundingClientRect();
        return {
          sidebar: inset(document.querySelector("[data-overview]"), document.querySelector('[data-slot="sidebar-inner"]')),
          overview: inset(document.querySelector("[data-home-overview] ul"), document.querySelector("[data-home-overview]")),
          // The thumb is inset 2 px in its 10 px gutter, so a scroller ending 4 px short of the card puts it 6 px off.
          thumbOffCard: Math.round(document.querySelector('[data-slot="sidebar-inset-card"]').getBoundingClientRect().left - scroller.right) + 2,
        };
      }),
    ),
    { sidebar: [8, 8], overview: [24, 24], thumbOffCard: 6 },
  );
  await window.setViewportSize({ width: 1440, height: 400 });
  const filtersTop = () => settled(() => window.$eval("[data-home-filters]", (f) => Math.round(f.getBoundingClientRect().top)));
  const restTop = await filtersTop();
  await window.$eval("[data-home-scroll]", (el) => el.scrollTo(0, el.scrollHeight));
  check(
    "scrolled down the cards, home's search and filters stay where they were, over what scrolls",
    [await window.$eval("[data-home-scroll]", (el) => el.scrollTop > 0), await filtersTop()],
    [true, restTop],
  );
  await window.$eval("[data-home-scroll]", (el) => el.scrollTo(0, 0));
  await window.setViewportSize({ width: 1440, height: 900 });
  check("home shows no Regenerate or Export", [await window.$("[data-regenerate-toggle]"), await window.$("[data-export]")], [null, null]);
  await window.waitForTimeout(300);
  await shot(window, shots, "home-light");

  await window.click('[data-project="kitchen-proj"] [data-project-label]');
  await window.waitForSelector(`[data-session="${kitchen}"]`, { state: "detached" });
  check("a project group collapses", await window.isVisible('[data-project="kitchen-proj"] [data-project-label]'), true);
  check(
    "a collapsed group counts what it hides as a muted count, an open one doesn't, its label starts where its rows' titles do, and every chevron ends its row at one x",
    await window.evaluate(() => {
      const labels = [...document.querySelectorAll("[data-project-label]")];
      const shown = (el) => el.checkVisibility();
      const titleX = Math.round(document.querySelector("[data-session] span").getBoundingClientRect().left);
      return {
        counts: labels.map((l) => l.querySelector("[data-project-count]")).filter(shown).map((c) => [c.textContent, c.dataset.slot]),
        chevrons: new Set(labels.map((l) => Math.round(l.querySelector("svg").getBoundingClientRect().right))).size,
        edge: labels.every((l) => Math.round(l.querySelector("span").getBoundingClientRect().left) === titleX),
      };
    }),
    { counts: [["1", "count"]], chevrons: 1, edge: true },
  );
  await window.click('[data-project="kitchen-proj"] [data-project-label]');
  await window.waitForSelector(`[data-session="${kitchen}"]`);

  // Settle, as T3 settles a thread: the row leaves its project for a shut Settled group at the bottom, and comes back.
  const settledRows = () => window.$$eval("[data-settled-group] [data-session]", (rows) => rows.map((r) => r.dataset.session));
  await window.hover(`[data-session="${kitchen}"]`);
  check(
    "hovering a row swaps its age for the settle control",
    await settled(() =>
      window.evaluate((id) => {
        const item = document.querySelector(`[data-session="${id}"]`).closest("li");
        return [getComputedStyle(item.querySelector("[data-age]")).visibility, getComputedStyle(item.querySelector("[data-settle]")).opacity];
      }, kitchen),
    ),
    ["hidden", "1"],
  );
  await window.hover(`[data-settle="${kitchen}"]`);
  await window.waitForSelector('[data-slot="tooltip-content"]', { state: "visible" });
  check("its hint names the action and T3's chord", (await window.textContent('[data-slot="tooltip-content"]'))?.trim(), "SettleCtrl+Shift+S");
  check(
    "the settle control is the 24 px ghost icon button, centred on its row, with a 14 px glyph and the hover fill",
    await settled(() =>
      window.$eval(`[data-settle="${kitchen}"]`, (b) => {
        const [box, row] = [b.getBoundingClientRect(), b.closest("li").querySelector("[data-session]").getBoundingClientRect()];
        const fill = document.body.appendChild(Object.assign(document.createElement("span"), { style: "background: var(--hover)" }));
        const hover = getComputedStyle(fill).backgroundColor;
        fill.remove();
        return [box.width, box.height, Math.round(box.top + box.height / 2 - (row.top + row.height / 2)), b.querySelector("svg").getBoundingClientRect().width, getComputedStyle(b).backgroundColor === hover];
      }),
    ),
    [24, 24, 0, 14, true],
  );
  check(
    "pointing at the settle control keeps its row's hover fill, so the row still reads as the one in hand",
    await settled(() => window.$eval(`[data-session="${kitchen}"]`, (row) => getComputedStyle(row).backgroundColor !== "rgba(0, 0, 0, 0)")),
    true,
  );
  check(
    "and opens over its own row, covering no control outside it, the home search least of all",
    await settled(() =>
      window.evaluate((id) => {
        const hint = document.querySelector('[data-slot="tooltip-content"]').getBoundingClientRect();
        const row = document.querySelector(`[data-session="${id}"]`).closest("li");
        const over = (r) => hint.left < r.right && hint.right > r.left && hint.top < r.bottom && hint.bottom > r.top;
        return [...document.querySelectorAll('button, a, input, [tabindex="0"]')]
          .filter((c) => !row.contains(c) && c.getClientRects().length > 0 && over(c.getBoundingClientRect()))
          .map((c) => c.getAttribute("aria-label") ?? c.textContent.trim());
      }, kitchen),
    ),
    [],
  );
  await shot(window, shots, "settle-action");
  await window.click(`[data-settle="${kitchen}"]`);
  await window.waitForSelector("[data-settled-group]");
  check(
    "a settled brainstorm leaves its project for the Settled group, which starts shut and shows its count",
    [await window.$('[data-project="kitchen-proj"]'), (await window.textContent("[data-settled-count]"))?.trim(), await window.$(`[data-session="${kitchen}"]`)],
    [null, "1", null],
  );
  check(
    "home shows active brainstorms by default, so the settled card leaves it, and the Settled filter counts it",
    [await window.$(`[data-overview-session="${kitchen}"]`), (await window.textContent('[data-home-status="settled"] [data-status-count]'))?.trim()],
    [null, "1"],
  );
  await window.click('[data-home-status="all"]');
  await window.waitForSelector("[data-overview-settled]");
  check(
    "under All, the overview lists it under the Settled heading, marked, a ghost of an active card with no fill or lift, on the same mat",
    await window.$$eval("[data-overview-settled] [data-overview-session]", (cards) =>
      cards.map((c) => {
        const style = getComputedStyle(c);
        const mat = getComputedStyle(c.querySelector("[data-preview]")).backgroundColor === getComputedStyle(document.querySelector("[data-overview-session]:not([data-settled]) [data-preview]")).backgroundColor;
        return [c.dataset.overviewSession, c.dataset.settled, c.querySelector('[data-session-status="settled"]')?.textContent, style.backgroundColor, style.boxShadow.includes("rgba(0, 0, 0, 0.06)"), mat];
      }),
    ),
    [[kitchen, "true", "Settled", "rgba(0, 0, 0, 0)", false, true]],
  );
  await window.click("[data-settled-label]");
  await window.waitForSelector(`[data-settled-group] [data-session="${kitchen}"][data-settled]`);
  check(
    "opened, it lists the settled row muted, its age counting from the settle",
    await window.$eval(`[data-session="${kitchen}"]`, (r) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--fg-muted)" }));
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return [getComputedStyle(r).color === muted, r.querySelector("[data-age]").textContent];
    }),
    [true, "now"],
  );
  await window.mouse.move(700, 600);
  await window.waitForTimeout(300);
  await shot(window, shots, "settled-sidebar");

  check(
    "an open project group's chevron ink, 4 px inside its box, ends on its rows' ages",
    await window.evaluate(() => {
      const group = document.querySelector("[data-project]");
      const chevron = group.querySelector('[data-sidebar="group-label"] svg').getBoundingClientRect();
      const age = group.querySelector("[data-age]").getBoundingClientRect();
      return Math.round(chevron.right - 4 - age.right);
    }),
    0,
  );
  await window.keyboard.press("Shift");
  await window.focus(`[data-session="${loose}"]`);
  check(
    "a focused sidebar row keeps its focus ring inside its own fill, on the column's inset",
    await window.$eval(`[data-session="${loose}"]`, (row) => getComputedStyle(row).boxShadow.includes("inset")),
    true,
  );
  await window.keyboard.press("Control+Shift+S");
  await window.waitForFunction((id) => document.querySelector(`[data-settled-group] [data-session="${id}"]`) !== null, loose);
  check("Ctrl+Shift+S settles the focused row, and the newest settle lists first", await settledRows(), [loose, kitchen]);
  await window.focus(`[data-session="${loose}"]`);
  await window.keyboard.press("Control+Shift+S");
  await window.waitForFunction((id) => document.querySelector(`[data-project] [data-session="${id}"]`) !== null, loose);
  check("and on a settled row it brings it back to its project", [await settledRows(), (await window.textContent("[data-settled-count]"))?.trim()], [[kitchen], "1"]);
  await window.hover(`[data-overview-session="${roulette}"]`);
  await window.click(`[data-settle="${roulette}"]`);
  await window.waitForFunction((id) => document.querySelector(`[data-settled-group] [data-session="${id}"]`) !== null, roulette);
  await window.hover(`[data-overview-session="${roulette}"]`);
  await window.click(`[data-settle="${roulette}"]`);
  await window.waitForFunction((id) => document.querySelector(`[data-project] [data-session="${id}"]`) !== null, roulette);
  check(
    "a card's own control settles it and brings it back, and Rob's un-settle lists it first, as T3 lists a thread brought back",
    await window.$$eval('[data-project] [data-session]', (rows) => rows[0]?.dataset.session),
    roulette,
  );

  const statusSwitch = () =>
    settled(() =>
      window.$eval("[data-home-filters] [data-slot=segmented]", (group) => ({
        width: Math.round(group.getBoundingClientRect().width),
        air: [...group.querySelectorAll("[data-home-status]")].map((s) => Math.round(s.getBoundingClientRect().width - s.firstElementChild.getBoundingClientRect().width)),
      })),
    );
  const switchAt = [await statusSwitch()];
  check(
    "home's status switch is one 28 px control with the search field's edge, on a track that shows against the page",
    await window.$eval("[data-home-filters] [data-slot=segmented]", (group) => {
      const search = getComputedStyle(document.querySelector("[data-home-search]"));
      const track = getComputedStyle(group);
      let under = group.parentElement;
      while (getComputedStyle(under).backgroundColor === "rgba(0, 0, 0, 0)") under = under.parentElement;
      const page = getComputedStyle(under).backgroundColor;
      return [group.getBoundingClientRect().height, track.boxShadow.includes(search.borderTopColor), track.backgroundColor !== page];
    }),
    [28, true, true],
  );
  check(
    "home's query row holds one text weight: the status segments, the project filter and the sort",
    await window.evaluate(() =>
      ["[data-home-status=active] > span", "[data-project-filter] span", "[data-home-sort] [data-slot=select-value]"].map((s) => getComputedStyle(document.querySelector(s)).fontWeight),
    ),
    ["400", "400", "400"],
  );
  await window.hover('[data-home-status="attention"]');
  check(
    "Attention's hint says it is the part of Active waiting on Rob",
    await window.waitForSelector('[data-slot="tooltip-content"]', { state: "visible" }).then((h) => h.textContent()),
    "The active brainstorms waiting on you",
  );
  await window.click('[data-home-status="attention"]');
  switchAt.push(await statusSwitch());
  check(
    "home's status segments each hug their label, so the gaps between labels are even, and a press moves none of them",
    [new Set(switchAt[0].air).size, switchAt[0].width === switchAt[1].width],
    [1, true],
  );
  await window.setViewportSize({ width: 1100, height: 720 });
  check(
    "at 1100 the search field still shows its whole placeholder",
    await settled(() =>
      window.$eval("[data-home-search]", (el) => {
        const s = getComputedStyle(el);
        const pen = document.createElement("canvas").getContext("2d");
        pen.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
        return el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) >= Math.ceil(pen.measureText(el.placeholder).width);
      }),
    ),
    true,
  );
  await window.setViewportSize({ width: 1440, height: 900 });

  // Search and filters. Each read waits for the grid to settle, since the list refetches on every change event.
  await window.click('[data-home-status="active"]');
  const cards = () => settled(() => window.$$eval("[data-home-results] [data-overview-session]", (cs) => cs.map((c) => c.dataset.overviewSession)));
  const inSearch = () => window.evaluate(() => document.activeElement?.hasAttribute("data-home-search") ?? false);
  await window.click("[data-home-overview] h1");
  await window.keyboard.press("/");
  check("/ puts Rob in home's search", await inSearch(), true);
  await window.keyboard.type("chore");
  check("the search narrows home as Rob types, by title", await cards(), [roulette]);
  await window.fill("[data-home-search]", "PHONE cyberpunk");
  check("and by the words of a brief, in any order and any case", await cards(), [roulette]);
  check(
    "each status counts what the search leaves",
    await window.$$eval("[data-home-status] [data-status-count]", (counts) => counts.map((c) => c.textContent)),
    ["1", "0", "0", "1"],
  );
  await window.waitForTimeout(300);
  await shot(window, shots, "search-results");
  await window.fill("[data-home-search]", "zebra");
  await window.waitForSelector('[data-home-none="no-match"]');
  check(
    "a search with no match says so, naming only the search, with one way out",
    [
      (await window.textContent('[data-home-none="no-match"] [data-slot=empty-description]'))?.trim(),
      (await window.textContent('[data-home-none="no-match"] [data-home-none-action]'))?.trim(),
    ],
    ["No active brainstorm matches the search.", "Clear search"],
  );
  check(
    "and sits under the query row, not down the page",
    await window.evaluate(() => Math.round(document.querySelector("[data-home-none]").getBoundingClientRect().top - document.querySelector("[data-home-filters]").getBoundingClientRect().bottom)),
    20,
  );
  check(
    "it starts on the page's left edge, under the search, its title and its action too, as the heading does",
    await window.evaluate(() => {
      const left = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
      const edge = left("[data-home-search]");
      return ['[data-home-none] [data-slot="empty-icon"]', "[data-home-none] [data-slot=empty-title]", "[data-home-none-action]"].map((sel) => left(sel) - edge);
    }),
    [0, 0, 0],
  );
  await shot(window, shots, "search-empty");
  await window.keyboard.press("Escape");
  check("Escape clears the search, and every active brainstorm is back", [await window.inputValue("[data-home-search]"), (await cards()).length], ["", 3]);
  await window.keyboard.press("Escape");
  check("a second Escape leaves the field", await inSearch(), false);
  await window.keyboard.press("Control+f");
  check("Ctrl+F puts Rob in the search too", await inSearch(), true);
  await window.keyboard.press("Escape");

  await window.click("[data-project-filter]");
  await window.waitForSelector("[data-project-menu]");
  check(
    "the project filter lists every project by name, with how many brainstorms each would show under the status, so a settled one isn't counted under Active",
    await window.$$eval("[data-project-option]", (rows) => rows.map((r) => r.textContent)),
    ["chores2", "kitchen0", "Other project1"],
  );
  await window.waitForTimeout(300);
  await shot(window, shots, "filter-menu");
  await window.click('[data-project-option="chore-roulette"]');
  check(
    "checking a project shows only its brainstorms, and the filter names it",
    [await cards(), (await window.textContent("[data-project-filter]"))?.trim()],
    [[roulette, wide], "chores"],
  );
  await window.keyboard.press("Escape");
  await window.click("[data-home-sort]");
  await window.click('[data-sort-option="title"]');
  check("sorting by title reorders the cards", await cards(), [roulette, wide]);
  await window.click('[data-home-status="settled"]');
  await window.waitForSelector('[data-home-none="no-match"]');
  await window.click("[data-home-none-action]");
  check(
    "clearing brings back every active brainstorm and keeps the sort",
    [await cards(), await window.getAttribute('[data-home-status="active"]', "aria-pressed"), (await window.textContent("[data-home-sort] [data-slot=select-value]"))?.trim()],
    [[roulette, loose, wide], "true", "Title"],
  );
  // Left as Rob would leave it, to come back after the restart below.
  await window.click("[data-project-filter]");
  await window.click('[data-project-option="chore-roulette"]');
  await window.keyboard.press("Escape");
  await window.click('[data-home-status="all"]');
  await window.fill("[data-home-search]", "roulette");

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
  check(
    "every section head in the brainstorm panel takes one style, the selected slot's too, its variant count muted",
    await window.evaluate(() => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--fg-muted)" }));
      const muted = getComputedStyle(probe).color;
      probe.remove();
      const heads = [...document.querySelectorAll('[data-sidebar-panel="session"] [data-sidebar="group-label"]')].map((h) => `${getComputedStyle(h).color} ${getComputedStyle(h).fontWeight}`);
      const counts = [...document.querySelectorAll("[data-slot-id] [data-slot-count]")];
      return [heads.length >= 2, new Set(heads).size, counts.every((c) => getComputedStyle(c).color === muted)];
    }),
    [true, 1, true],
  );
  check(
    "in the brainstorm panel every row's lead mark, dot or icon, centres on one line, and every row's text starts at one edge",
    await window.evaluate(() => {
      const panel = '[data-sidebar-panel="session"]';
      const marks = [...document.querySelectorAll(`${panel} [data-back] > svg, ${panel} [data-slot="sidebar-menu-mark"]`)].map((m) => {
        const r = m.getBoundingClientRect();
        return Math.round(r.left + r.width / 2);
      });
      const texts = [...document.querySelectorAll(`${panel} [data-back] > span, ${panel} [data-thread-link] .truncate, ${panel} [data-variant-title]`)].map((t) => Math.round(t.getBoundingClientRect().left));
      return [marks.length >= 3 && new Set(marks).size, texts.length >= 2 && new Set(texts).size];
    }),
    [1, 1],
  );

  await canvas.waitForSelector('[data-bid="result/card"]');
  await window.waitForSelector("[data-inspector-header]");
  await window.waitForSelector("[data-control]");
  check(
    "the canvas bar and the Inspector header rule off at one height across the seam",
    await window.evaluate(() => Math.round(document.querySelector("[data-inspector-header]").getBoundingClientRect().bottom - document.querySelector("[data-canvas-bar]").getBoundingClientRect().bottom)),
    0,
  );
  check(
    "the Inspector header sits above its scrolling body, not in it, so nothing scrolls into view over it",
    await window.evaluate(() => [document.querySelector("[data-inspector-header]").closest("[data-inspector-body]"), document.querySelector("[data-block]").closest("[data-inspector-body]") !== null]),
    [null, true],
  );
  check(
    "the Inspector's content and its rules sit 16 px off both edges, the scrollbar gutter counted",
    await window.evaluate(() => {
      const aside = document.querySelector("aside[aria-label=Inspector]");
      const pane = { left: aside.getBoundingClientRect().left + aside.clientLeft, right: aside.getBoundingClientRect().right };
      const inset = (el) => [Math.round(el.getBoundingClientRect().left - pane.left), Math.round(pane.right - el.getBoundingClientRect().right)];
      return { control: inset(document.querySelector("[data-control]")), rule: inset(document.querySelector("[data-feedback-panel]")) };
    }),
    { control: [16, 16], rule: [16, 16] },
  );
  check(
    "the Inspector's type steps down from block title to control label",
    await window.evaluate(() =>
      ["[data-inspector-header] h2", "[data-feedback-panel] h2", "[data-control-label]"].map((s) => {
        const c = getComputedStyle(document.querySelector(s));
        return `${c.fontSize} ${c.fontWeight}`;
      }),
    ),
    ["14px 600", "14px 600", "13px 400"],
  );
  check("a brainstorm with one slot shows no slot arrows", await window.$("[data-slot-step]"), null);
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
  check(
    "an accent button paints the full 28 px box its outline neighbour does",
    await window.evaluate(() => {
      const paint = (el) => {
        const c = getComputedStyle(el);
        return { height: Math.round(el.getBoundingClientRect().height), filled: c.borderTopColor === c.backgroundColor };
      };
      return [paint(document.querySelector("[data-regenerate-toggle]")), Math.round(document.querySelector("[data-export]").getBoundingClientRect().height)];
    }),
    [{ height: 28, filled: true }, 28],
  );
  check("the Inspector toggle sits in the header, pressed while the Inspector shows", await window.getAttribute("[data-topbar] [data-inspector-toggle]", "aria-pressed"), "true");
  check(
    "every pane toggle follows one rule, pressed while its pane shows: the sidebar's, the history's and the Inspector's",
    await window.$$eval('[data-sidebar="trigger"], [data-history-toggle], [data-inspector-toggle]', (toggles) => toggles.map((t) => t.getAttribute("aria-pressed"))),
    ["true", "true", "true"],
  );
  check("the canvas region ends where the Inspector starts", iframe.right <= inspector.left, true);
  const zoomShown = () => window.getAttribute("[data-canvas-bar] [data-canvas-zoom]", "data-canvas-zoom");
  const fit = async () => ({
    ...(await canvas.evaluate(() => {
      const body = document.querySelector(".bs-frame:not([data-offstage]) .bs-frame-body").getBoundingClientRect();
      const de = document.documentElement;
      return { sideways: de.scrollWidth > de.clientWidth, fits: body.left >= 0 && body.right <= de.clientWidth };
    })),
    zoom: await zoomShown(),
  });
  check("a brainstorm opens on the stage", await window.getAttribute("[data-canvas-region]", "data-canvas-view"), "stage");
  check("with one slot both views are the same, so the bar shows no view switch", await window.$("[data-view-option]"), null);
  check("the stage zooms the 980 px frame to fit, says by how much in the canvas bar, and never scrolls sideways at 1440", await fit(), { sideways: false, zoom: "83", fits: true });
  const centring = () =>
    settled(() =>
      canvas.evaluate(() => {
        const body = document.querySelector(".bs-frame:not([data-offstage]) .bs-frame-body").getBoundingClientRect();
        return { scrolls: document.documentElement.scrollHeight > innerHeight, sides: [Math.round(body.left), Math.round(innerWidth - body.right)] };
      }),
    );
  check("a stage frame that doesn't scroll sits centred, 24 px off each side of the canvas", await centring(), { scrolls: false, sides: [24, 24] });
  await window.setViewportSize({ width: 1100, height: 720 });
  const applied = () => canvas.$eval(".bs-frame:not([data-offstage]) .bs-frame-body", (b) => getComputedStyle(b).zoom);
  const at1100 = [];
  for (let i = 0; i < 3; i++) {
    await window.setViewportSize({ width: 1100, height: 720 });
    await settled(zoomShown);
    at1100.push({ ...(await fit()), applied: await applied() });
    await window.setViewportSize({ width: 1440, height: 900 });
    await window.waitForFunction(() => document.querySelector("[data-canvas-zoom]")?.dataset.canvasZoom === "83");
  }
  check(
    "and at 1100, to one zoom every time the window comes back to it, the one the bar names",
    at1100,
    Array(3).fill({ sideways: false, zoom: "53", fits: true, applied: "0.534694" }),
  );
  check(
    "the page never scrolls sideways",
    await window.evaluate(() => [document.documentElement.scrollWidth <= innerWidth, document.body.scrollWidth <= innerWidth, scrollX]),
    [true, true, 0],
  );
  await window.waitForTimeout(300);
  await shot(window, shots, "session-light");
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
  check(
    "a stage frame that scrolls sits centred too, its gutter mirrored on the left",
    await settled(() =>
      rouletteCanvas.evaluate(() => {
        const body = document.querySelector(".bs-frame:not([data-offstage]) .bs-frame-body").getBoundingClientRect();
        return { scrolls: document.documentElement.scrollHeight > innerHeight, off: Math.round(body.left + body.width / 2 - innerWidth / 2) };
      }),
    ),
    { scrolls: true, off: 0 },
  );
  await window.click('[data-slot-tab="result"]');
  await rouletteCanvas.waitForSelector('.bs-frame[data-slot="result"]:not([data-offstage])');
  check("a tab puts its slot on the stage and its block in the Inspector", [await staged(), await window.getAttribute("[data-block]", "data-block")], [["result"], "result/card"]);
  await window.focus('[data-slot-tab="result"]');
  await window.keyboard.press("ArrowLeft");
  await rouletteCanvas.waitForSelector('.bs-frame[data-slot="wheel"]:not([data-offstage])');
  check("arrow keys on the tabs move between slots", await staged(), ["wheel"]);
  check(
    "a slot tab is a 28 px control centred in the 40 px bar, its underline on the bar's rule",
    await window.$eval('[data-slot-tab="wheel"]', (tab) => {
      const t = tab.getBoundingClientRect();
      const bar = tab.closest("[data-canvas-bar]").getBoundingClientRect();
      return [Math.round(t.height), Math.round(t.top - bar.top), Math.round(bar.bottom - t.bottom), getComputedStyle(tab, "::after").bottom, getComputedStyle(tab).borderRadius];
    }),
    [28, 6, 6, "-6px", "6px"],
  );
  check(
    "the breadcrumb starts 16 px into the card, on the first ink of the canvas bar and of the Inspector's header",
    await window.evaluate(() => {
      const card = document.querySelector('[data-slot="sidebar-inset-card"]').getBoundingClientRect();
      const crumb = document.querySelector('nav[aria-label="Breadcrumb"]').getBoundingClientRect();
      const inspector = document.querySelector("[data-inspector-header]");
      const pad = parseFloat(getComputedStyle(inspector).paddingLeft);
      return [Math.round(crumb.left - card.left), pad];
    }),
    [16, 16],
  );
  await window.keyboard.press("Shift");
  await window.focus('[data-slot-tab="wheel"]');
  check(
    "a focused slot tab draws its ring inside itself, 4 px clear of the accent underline",
    await window.$eval('[data-slot-tab="wheel"]', (tab) => getComputedStyle(tab).boxShadow.includes("inset")),
    true,
  );
  // The pointer may still rest on the toggle from collapsing the sidebar, so come at it fresh.
  await window.mouse.move(700, 20);
  await window.hover('[data-slot="sidebar"] [data-sidebar="trigger"]');
  await window.waitForSelector('[data-slot="tooltip-content"]', { state: "visible" });
  check("a hint is 24 px tall, under the 28 px controls it labels, so it never reads as one more of them", await window.$eval('[data-slot="tooltip-content"]', (t) => Math.round(t.getBoundingClientRect().height)), 24);
  await window.hover('[data-slot="resize-handle"][aria-label="Inspector width"]');
  check(
    "under the pointer, the resize line is a 2 px fg-muted edge, darker than a scrollbar thumb",
    await window.$eval('[data-slot="resize-handle"][aria-label="Inspector width"]', (h) => [getComputedStyle(h, "::after").backgroundColor, getComputedStyle(h, "::after").width]),
    ["rgb(102, 101, 95)", "2px"],
  );
  await window.mouse.move(700, 600);
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
      // Centred on the corner, or, where the corner is at the frame's edge, held inside the frame with the corner under it.
      return p.left <= a.right && a.right <= p.right && Math.abs(p.top + p.height / 2 - a.top) <= 2;
    }, id);
  await window.click("[data-pick-toggle]");
  check("pick mode says so in the canvas bar, where it covers no frame", await window.$eval("[data-pick-hint]", (h) => h.closest("[data-canvas-bar]") !== null), true);
  check(
    "a divider stands between pick mode's Cancel and the view switch, so the bar reads as two groups",
    await window.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const [cancel, divider, view] = [r("[data-pick-hint] button"), r("[data-pick-divider]"), r("[data-view-option]")];
      return divider !== undefined && cancel.right < divider.left && divider.right < view.left;
    }),
    true,
  );
  await rouletteCanvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-composer]");
  await window.keyboard.type("Spin should be bigger");
  await window.keyboard.press("Control+Enter");
  await window.waitForSelector('[data-feedback="1"]');
  await rouletteCanvas.waitForSelector('.bs-pin[data-pin="1"][data-placed]');
  check("a pin picked on the stage lands on its element's corner", await pinAt(1), true);
  await window.hover('[data-feedback="1"]');
  check(
    "hovering a feedback item lifts its pin on the canvas",
    await rouletteCanvas.waitForSelector('.bs-pin[data-pin="1"][data-hovered]').then(() => true, () => false),
    true,
  );
  // Off the item onto the window's own header: a single synthetic move straight into the iframe leaves the panel's
  // hover state behind, which no real pointer crossing the gap does.
  await window.mouse.move(700, 20);
  await rouletteCanvas.waitForSelector('.bs-pin[data-pin="1"]:not([data-hovered])', { state: "attached" });
  // Measured unscrolled: on the board the canvas scrolls the picked pin into view, which the history strip's height can call for.
  const labelTop = () =>
    rouletteCanvas.evaluate(() => {
      const label = document.querySelector('.bs-frame[data-slot="wheel"] .bs-frame-title');
      let top = label.getBoundingClientRect().top;
      for (let p = label.parentElement; p !== null; p = p.parentElement) top += p.scrollTop;
      return Math.round(top);
    });
  check(
    "the view switch shows both labels whole, in segments of one width",
    await window.$$eval("[data-view-option]", (els) => [els.every((e) => e.scrollWidth <= e.clientWidth), new Set(els.map((e) => Math.round(e.getBoundingClientRect().width))).size]),
    [true, 1],
  );
  const stageLabel = await labelTop();
  await window.click('[data-view-option="board"]');
  await rouletteCanvas.waitForSelector('#canvas[data-view="board"]');
  check(
    "on the board both slots sit side by side and fit at 1440, and the pin stays on its element",
    [await staged(), await rouletteCanvas.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), await pinAt(1)],
    [["wheel", "result"], true, true],
  );
  check("a frame's label sits as far off the canvas bar on the board as on the stage", [stageLabel, await labelTop()], [24, 24]);
  const row = () =>
    rouletteCanvas.evaluate(() => {
      const de = document.documentElement;
      const bodies = [...document.querySelectorAll(".bs-frame-body")].map((b) => b.getBoundingClientRect());
      return { sideways: de.scrollWidth > de.clientWidth, tops: new Set(bodies.map((b) => Math.round(b.top))).size, inside: bodies.every((b) => b.left >= 0 && b.right <= de.clientWidth) };
    });
  await window.setViewportSize({ width: 1100, height: 720 });
  await window.waitForSelector("[data-canvas-bar] [data-canvas-zoom]");
  // The panels ease to their new widths, so the canvas refits a few times before it settles.
  check(
    "at 1100 beside the Inspector the board zooms both frames to fit one row, says so in the bar, and never scrolls sideways",
    await settled(async () => [await row(), await pinAt(1)]),
    [{ sideways: false, tops: 1, inside: true }, true],
  );
  check(
    "a pin on the zoomed board keeps its 20 px face and 26 px hit area, on its element",
    await settled(async () => [
      await window.getAttribute("[data-canvas-zoom]", "data-canvas-zoom"),
      await rouletteCanvas.$eval('.bs-pin[data-pin="1"]', (p) => {
        const r = p.getBoundingClientRect();
        const hit = (x, y) => document.elementFromPoint(x, y) === p;
        return { face: [Math.round(r.width), Math.round(r.height)], hit: [hit(r.left - 2.5, r.top + r.height / 2), hit(r.left + r.width / 2, r.bottom + 2.5)] };
      }),
      await pinAt(1),
    ]).then(([zoom, ...rest]) => [Number(zoom) < 100, ...rest]),
    [true, { face: [20, 20], hit: [true, true] }, true],
  );
  // A short window, so the Inspector has more than both fades' worth to scroll.
  await window.setViewportSize({ width: 1100, height: 520 });
  await settled(() => window.$eval("[data-inspector-body]", (el) => [el.scrollHeight, el.clientHeight]));
  check(
    "the Inspector's edges fade only while there is more that way: none at rest, 32 px at the top once scrolled, past a switch's track and ring, and 32 px at the bottom short of the end",
    await window.$eval("[data-inspector-body]", async (el) => {
      const read = () => ["--fade-top", "--fade-bottom"].map((p) => getComputedStyle(el).getPropertyValue(p));
      const at = async (y) => {
        el.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return read();
      };
      const result = { room: el.scrollHeight - el.clientHeight >= 60, top: await at(0), down: await at(32), end: await at(el.scrollHeight) };
      await at(0);
      return result;
    }),
    { room: true, top: ["0px", "32px"], down: ["32px", "32px"], end: ["32px", "0px"] },
  );
  await window.setViewportSize({ width: 1100, height: 720 });
  await window.click("[data-pick-toggle]");
  await window.waitForSelector("[data-pick-hint]");
  check(
    "in pick mode at 1100 the hint's text gives way, and every slot tab still shows whole",
    await window.$$eval("[data-slot-tab]", (tabs) => tabs.map((t) => t.querySelector("span").scrollWidth <= t.querySelector("span").clientWidth && t.getBoundingClientRect().width > 40)),
    [true, true],
  );
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-pick-hint]", { state: "detached" });
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForSelector("[data-canvas-zoom]", { state: "detached" });
  await window.click('[data-view-option="stage"]');
  await rouletteCanvas.waitForSelector('#canvas[data-view="stage"]');

  await window.click('[data-slot-tab="result"]');
  await window.click('[data-view-option="board"]');
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
  check(
    "the Inspector collapses to a 40 px rail that counts the open feedback in the chip",
    [await inspectorWidth(), (await window.textContent("[data-rail-count]"))?.trim(), await window.getAttribute("[data-rail-count]", "data-slot")],
    [40, "1", "badge"],
  );
  check(
    "the rail's head carries the canvas bar's rule, its button centred on the bar's line with the count on its lower corner, 4 px in from the card's edge and clear of its 12 px radius",
    await settled(() =>
      window.evaluate(() => {
        const box = (sel) => document.querySelector(sel).getBoundingClientRect();
        const [bar, head, button, count] = [box("[data-canvas-bar]"), box("[data-rail-head]"), box("[data-rail-feedback]"), box("[data-rail-count]")];
        return {
          rule: Math.round(head.bottom) === Math.round(bar.bottom) && parseFloat(getComputedStyle(document.querySelector("[data-rail-head]")).borderBottomWidth) > 0,
          centred: Math.round(button.top + button.height / 2) === Math.round(bar.top + bar.height / 2),
          corner: [Math.round(head.right - count.right), Math.round(count.top - head.top), Math.round(count.bottom - button.bottom)],
        };
      }),
    ),
    { rule: true, centred: true, corner: [4, 20, 2] },
  );
  await window.click("[data-rail-feedback]");
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
  check(
    "variant notes stay removed: each variant row is its button alone, and no note text reaches the sidebar",
    await window.$$eval('[data-slot="sidebar-content"] [data-variant]', (rows) => ({
      alone: rows.every((r) => r.closest("li").children.length === 1),
      notes: rows.some((r) => /Hypothesis|Tradeoff|Try this|Recommended/.test(r.closest("[data-slot-id]").textContent)),
      about: document.querySelectorAll("[data-about], [data-about-more]").length,
    })),
    { alone: true, notes: false, about: 0 },
  );
  check(
    "the sidebar ends in a 32 px fade that sticks to its bottom edge, so a row cut there reads as cut",
    await window.$eval('[data-slot="sidebar-content"] [data-sidebar-fade]', (fade) => [Math.round(fade.getBoundingClientRect().height), getComputedStyle(fade).position, getComputedStyle(fade).bottom]),
    [32, "sticky", "0px"],
  );
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
    "a notice sits in the canvas region, off the Inspector, as far off the canvas scrollbar as off the bottom",
    // Read once its entrance has finished moving it.
    await settled(() => window.evaluate(() => {
      const toast = document.querySelector("[data-slot=toast]").getBoundingClientRect();
      const inspector = document.querySelector("aside[aria-label=Inspector]").getBoundingClientRect();
      const region = document.querySelector("[data-canvas-region]").getBoundingClientRect();
      return {
        inRegion: document.querySelector("[data-canvas-region] [data-slot=toast]") !== null,
        clear: toast.right <= inspector.left,
        offScrollbar: Math.round(region.right - 10 - toast.right),
        offBottom: Math.round(region.bottom - toast.bottom),
      };
    })),
    { inRegion: true, clear: true, offScrollbar: 16, offBottom: 16 },
  );
  check(
    "a notice leads with the step that failed, in a medium title over its reason",
    await window.$eval("[data-slot=toast]", (t) => {
      const title = t.querySelector("[data-toast-title]");
      return [title.textContent, getComputedStyle(title).fontWeight, title.nextElementSibling.textContent.length > 0];
    }),
    ["Couldn't switch the variant", "500", true],
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
  await window.waitForSelector("[data-home-filters]");
  check(
    "home's status, projects and sort survive the restart, and the search starts empty",
    [
      await window.getAttribute('[data-home-status="all"]', "aria-pressed"),
      (await window.textContent("[data-project-filter]"))?.trim(),
      (await window.textContent("[data-home-sort] [data-slot=select-value]"))?.trim(),
      await window.inputValue("[data-home-search]"),
    ],
    ["true", "chores", "Title", ""],
  );
  await window.click("[data-project-filter]");
  await window.waitForSelector("[data-project-all]");
  check(
    "in the project menu, Show all's words end on the counts' edge above them",
    await settled(() =>
      window.evaluate(() => {
        const ink = (el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return Math.round(range.getBoundingClientRect().right);
        };
        const counts = [...document.querySelectorAll("[data-project-option] > span:last-child")].map(ink);
        return [new Set(counts).size, Math.abs(ink(document.querySelector("[data-project-all]")) - counts[0]) <= 1];
      }),
    ),
    [1, true],
  );
  await window.click("[data-project-all]");
  check("Show all shows every project, then leaves the footer, since with none checked it has nothing to do", await window.$("[data-project-all]"), null);
  await window.keyboard.press("Escape");
  await window.click('[data-home-status="active"]');
  await window.click("[data-home-sort]");
  await window.click('[data-sort-option="recent"]');
  const again = await openSession(window, roulette);
  await again.waitForSelector('#canvas[data-view="board"]');
  check(
    "after a restart the sidebar width, the rail and this brainstorm's board come back as Rob left them",
    [await sidebarWidth(), (await window.$("[data-inspector-rail]")) !== null, await window.getAttribute('[data-view-option="board"]', "aria-pressed")],
    [widths.sidebar, true, "true"],
  );
  await window.click("[data-rail-feedback]");
  await window.waitForSelector("[data-feedback-panel]");
  check("and so does the Inspector width", await inspectorWidth(), widths.inspector);
  await window.setViewportSize({ width: 1100, height: 720 });
  await window.waitForTimeout(300);
  check(
    "in a narrower window the kept widths give way, so the canvas keeps its 560 px",
    await window.$eval("[data-canvas-region]", (el) => el.getBoundingClientRect().width >= 560 - 16),
    true,
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForTimeout(300);
  check("and come back when it widens", [await sidebarWidth(), await inspectorWidth()], [widths.sidebar, widths.inspector]);
  check("the window logged no errors or warnings across the restart", errors, []);
  await window.click("[data-back]");
  await window.waitForSelector("[data-settled-group]");
  check("a settle survives the restart", [(await window.textContent("[data-settled-count]"))?.trim(), await window.$(`[data-project] [data-session="${kitchen}"]`)], ["1", null]);
  await window.click("[data-settled-label]");
  await window.hover(`[data-session="${kitchen}"]`);
  await window.click(`[data-settle="${kitchen}"]`);
  await window.waitForSelector("[data-settled-group]", { state: "detached" });
  check("un-settling the last one removes the Settled group and puts the row back under its project", await window.$(`[data-project="kitchen-proj"] [data-session="${kitchen}"]`) !== null, true);

  // A fresh app asks T3 about each thread on first view, which is how a thread that vanished is found.
  await app.close();
  t3.setMissing(LOOSE_THREAD, true);
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForSelector("[data-home-overview]");
  await window.click(`[data-session="${loose}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"] [data-thread="lost"]');
  check("a brainstorm whose thread is gone says Thread lost in its sidebar", (await window.textContent('[data-thread="lost"]'))?.trim(), "Thread lost");
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
  check(
    "and keeps its frame: the Inspector's header row and the canvas bar still rule off at one height",
    await window.evaluate(() => {
      const header = document.querySelector("[data-inspector-header]");
      const bar = document.querySelector("[data-canvas-bar]");
      return [header?.textContent.trim(), header === null || bar === null ? null : Math.round(header.getBoundingClientRect().bottom - bar.getBoundingClientRect().bottom)];
    }),
    ["Settings", 0],
  );
  await window.click("[data-back]");
  await window.waitForSelector(`[data-session="${loose}"][data-lost] [data-session-status="thread_lost"]`);
  check("its home row carries the lost marker", (await window.textContent(`[data-session="${loose}"] [data-session-status="thread_lost"]`))?.trim(), "Thread lost");
  check("the window logged no errors or warnings after the restart", errors, []);

  await app.close();
  let serverDown = true;
  let answer;
  const answered = new Promise((r) => (answer = r));
  ({ app, window, errors } = await launch(home, env, {
    sessions: async (route) => {
      if (!serverDown) return route.continue();
      await answered;
      await route.abort();
    },
  }));
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.waitForSelector("[data-overview-skeleton]");
  check(
    "while the first list loads, each status is named with no count, since none is known yet",
    await window.$$eval("[data-home-status]", (items) => items.map((i) => i.textContent)),
    ["Active", "Attention", "Settled", "All"],
  );
  check("and keeps a count's room, so the row doesn't move when the counts land", await statusWidth(), loadedStatusWidth);
  const loadingTop = await filtersTop();
  answer();
  await window.waitForSelector("[data-home-error]");
  check(
    "a failed home keeps the subtitle and the query row where loading had them, the row off at the disabled opacity",
    [await window.isVisible("[data-home-hint]"), await filtersTop(), await window.$eval("[data-home-filters]", (f) => [f.inert, getComputedStyle(f).opacity])],
    [true, loadingTop, [true, "0.5"]],
  );
  check(
    "a list that fails at launch shows its error with Try again, and the sidebar stops loading and points at Try again",
    [await window.isVisible("[data-home-retry]"), await window.isVisible("[data-home-loading]"), (await window.textContent('[data-sidebar-panel="home"]'))?.includes("The list didn't load. Use Try again on the right.")],
    [true, false, true],
  );
  check("a failed home keeps its page heading over the error", (await window.textContent("[data-home-overview] h1"))?.trim(), "All brainstorms");
  check(
    "and its message sits under the query row as a no-match does, not down the page",
    await window.evaluate(() => Math.round(document.querySelector("[data-home-error]").getBoundingClientRect().top - document.querySelector("[data-home-filters]").getBoundingClientRect().bottom)),
    20,
  );
  check(
    "its icon tile takes the chip recipe, so it reads off the canvas",
    await window.$eval('[data-home-error] [data-slot="empty-icon"]', (tile) => {
      const style = getComputedStyle(tile);
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--border-strong); background: var(--card)" }));
      const [edge, card] = [getComputedStyle(probe).color, getComputedStyle(probe).backgroundColor];
      probe.remove();
      return [style.backgroundColor === card, style.boxShadow.includes(edge)];
    }),
    [true, true],
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
