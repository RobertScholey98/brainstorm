import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, checks, inBlock, launch, openSession, outsideBox, pixels, settled, showBoard, shot, showSlot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-8");
const { check, finish } = checks();
const t3 = fakeT3(env.BRAINSTORM_FAKE_T3_STATE);
const PHASE_MS = 15_000;
const ODDS = "Odds lean towards whoever has done least.";
const WEIGHTED = "Every spin is weighted by chores done.";

function must(step, r) {
  if (r.code !== 0 || r.json?.ok !== true) throw new Error(`${step} failed (exit ${r.code}): ${r.stdout}${r.stderr}`);
  return r.json.data;
}

let copies = 0;
/** The agent's side: a fresh working copy, `change` applied to it, then a commit. */
function agentCommit(session, change, args = []) {
  const copy = join(home, "agent", String(++copies));
  must("agent pull", brainstorm(env, ["pull", session, "--out", copy, "--json"]));
  change(copy);
  return must("agent commit", brainstorm(env, ["commit", session, "--from", copy, ...args, "--json"]));
}

function replaceIn(path, from, to) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${path} no longer contains ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}

const context = (session) => must("context", brainstorm(env, ["context", session, "--json"]));

/** The shot in the light theme it runs in, then its dark twin, so the new surfaces are judged in both. */
async function shots2(window, shots, name) {
  await shot(window, shots, name);
  await window.emulateMedia({ colorScheme: "dark" });
  await shot(window, shots, `${name}-dark`);
  await window.emulateMedia({ colorScheme: "light" });
}
const stripHeight = (window) => window.$eval("[data-history]", (el) => Math.round(el.getBoundingClientRect().height));
/** The first frame label's distance below the canvas's top edge, as Rob sees it. */
const labelOffset = (canvas) => canvas.evaluate(() => Math.round(document.querySelector(".bs-frame-title").getBoundingClientRect().top));
const strip = (window) =>
  window.$$eval("[data-history-list] [data-history-n]", (els) =>
    els.map((e) => ({ n: Number(e.dataset.historyN), selected: e.getAttribute("aria-selected") === "true", origin: e.querySelector("[data-history-origin]").textContent.trim() })),
  );
/**
 * How the strip rests: which entries are in view, any of them cut or under the 16 px fade at either end, whether the
 * shown iteration is among them, the insets of the first and last in view, and whether its arrows show.
 */
const stripRest = (window) =>
  window.evaluate(() => {
    const scroller = document.querySelector("[data-history-scroll]");
    const box = scroller.getBoundingClientRect();
    const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyBranch !== undefined ? "branch" : "stub");
    const inView = [...document.querySelectorAll("[data-history-list] > *:not([data-off])")].filter((el) => el.getBoundingClientRect().right > box.left + 1 && el.getBoundingClientRect().left < box.right - 1);
    const [first, last] = [inView.at(0).getBoundingClientRect(), inView.at(-1).getBoundingClientRect()];
    return {
      inView: inView.map(name),
      cut: inView.filter((el) => el.getBoundingClientRect().left < box.left + 15.5 || el.getBoundingClientRect().right > box.right - 15.5).map(name),
      shown: inView.some((el) => el.getAttribute("aria-selected") === "true"),
      insets: [Math.round(first.left - box.left), Math.round(box.right - last.right)],
      scrolled: Math.round(scroller.scrollLeft),
      arrows: [...document.querySelectorAll("[data-history-step]")].filter((el) => el.getClientRects().length > 0).length,
    };
  });
/**
 * The strip's head: how much wider it is than its widest line, and where its heading sits below the strip's top edge,
 * which should be one place whether or not the arrows show.
 */
const stripHead = (window) =>
  window.evaluate(() => {
    const head = document.querySelector("[data-history-head]");
    const inner = head.getBoundingClientRect().width - parseFloat(getComputedStyle(head).paddingLeft) - parseFloat(getComputedStyle(head).paddingRight);
    const ink = (line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      return range.getBoundingClientRect().width;
    };
    return {
      spare: Math.round(inner - Math.max(...[...head.children].map(ink))),
      heading: Math.round(head.querySelector("h2").getBoundingClientRect().top - document.querySelector("[data-history]").getBoundingClientRect().top),
    };
  });
/**
 * Each iteration entry in view, by number: whether its age reads whole, cut or gone, and whether "latest" reads whole,
 * cut or gone. Gone means wrapped out of its line, whole, as the line gives way.
 */
const firstLines = (window) =>
  window.evaluate(() => {
    const box = document.querySelector("[data-history-scroll]").getBoundingClientRect();
    const read = (el, line, entry) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      if (r.top >= line.bottom - 0.5) return "gone";
      return r.right <= entry.right + 0.5 && r.right <= line.right + 0.5 ? "whole" : "cut";
    };
    return [...document.querySelectorAll("[data-history-list] [data-history-n]")]
      .filter((el) => el.getBoundingClientRect().right > box.left + 1 && el.getBoundingClientRect().left < box.right - 1)
      .map((el) => {
        const line = el.querySelector("[data-history-age]").parentElement.getBoundingClientRect();
        const entry = el.getBoundingClientRect();
        return [Number(el.dataset.historyN), read(el.querySelector("[data-history-age]"), line, entry), read(el.querySelector("[data-history-latest]"), line, entry)];
      });
  });
/** Which ends of the strip show their cue that more waits that way, once the cues have faded in or out. */
const edgeCues = (window) =>
  settled(() => window.$$eval("[data-history-cue]", (els) => els.filter((el) => getComputedStyle(el).opacity === "1").map((el) => el.dataset.historyCue)));
/**
 * The strip's entries with a line cut, and, while any is, the ones wider than their lines need, which hold room a cut
 * line could use.
 */
const stripLines = (window) =>
  window.$$eval("[data-history-list] > *", (entries) => {
    const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyBranch !== undefined ? "branch" : "stub");
    const cut = entries.filter((el) => [...el.querySelectorAll('[data-slot="truncate"]')].some((t) => t.scrollWidth > t.clientWidth));
    const spare = entries.filter((el) => {
      const width = el.getBoundingClientRect().width;
      el.style.width = "max-content";
      const need = el.getBoundingClientRect().width;
      el.style.removeProperty("width");
      return width > Math.max(180, need) + 1;
    });
    return { cut: cut.map(name), spare: cut.length === 0 ? [] : spare.map(name), wide: spare.map(name) };
  });
/**
 * The edge of every entry, link and stub in the strip, and of the loading entry while it shows: whether it is drawn
 * in `border-strong`, and its contrast on the card.
 */
const stripEdges = (window) =>
  window.evaluate(() => {
    const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (...colours) => {
      paint.clearRect(0, 0, 1, 1);
      for (const c of colours) {
        paint.fillStyle = c;
        paint.fillRect(0, 0, 1, 1);
      }
      return [...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = (c) => c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
    const token = (name) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: `color: var(--${name})` }));
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    const [strong, card] = [token("border-strong"), token("card")];
    const name = (el) =>
      el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyBranch !== undefined ? "branch" : "loading";
    return [...document.querySelectorAll("[data-history-list] > *, [data-history-skeleton-entry]")].map((el) => {
      const s = getComputedStyle(el);
      const ring = s.boxShadow.split(/,(?![^(]*\))/).find((layer) => / 0px 0px 0px 1px( inset)?$/.test(layer.trim()));
      const edge = parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : ring?.trim().replace(/ 0px 0px 0px 1px( inset)?$/, "");
      const [a, b] = [lum(rgb(card)), lum(rgb(card, edge))].sort((x, y) => y - x);
      return [name(el), rgb(edge).join() === rgb(strong).join(), Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 >= 1.3];
    });
  });
/** The entries, links and stubs, and the loading entry, whose edge reaches past the strip's clip at its top or bottom, so it draws as brackets. */
const edgesClipped = (window) =>
  window.evaluate(() => {
    const clip = (el) => el.closest("[data-history-scroll], [data-history-loading] .overflow-x-auto, [data-history-loading]").getBoundingClientRect();
    const name = (el) =>
      el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyBranch !== undefined ? "branch" : "loading";
    return [...document.querySelectorAll("[data-history-list] > *, [data-history-skeleton-entry]")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const outset = parseFloat(s.borderTopWidth) > 0 || /inset/.test(s.boxShadow) ? 0 : 1;
        const [r, c] = [el.getBoundingClientRect(), clip(el)];
        return r.top - outset < c.top - 0.01 || r.bottom + outset > c.bottom + 0.01;
      })
      .map(name);
  });
/**
 * One page of the strip as it rests: the entries in view, the ones with a line cut, whether the latest names itself
 * "latest" in full, and whether a branch's tile is wider than its words, which would take room an entry's line needs.
 */
const pageRead = (window) =>
  window.evaluate(() => {
    const box = document.querySelector("[data-history-scroll]").getBoundingClientRect();
    const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyBranch !== undefined ? "branch" : "stub");
    const inView = [...document.querySelectorAll("[data-history-list] > *:not([data-off])")].filter((el) => el.getBoundingClientRect().right > box.left + 1 && el.getBoundingClientRect().left < box.right - 1);
    const latest = inView.find((el) => el.querySelector("[data-history-latest]") !== null)?.querySelector("[data-history-latest]");
    const line = latest?.parentElement.getBoundingClientRect();
    const wide = inView.filter((el) => el.dataset.historyBranch !== undefined).filter((el) => {
      const width = el.getBoundingClientRect().width;
      el.style.width = "max-content";
      const need = el.getBoundingClientRect().width;
      el.style.removeProperty("width");
      return width > need + 1;
    });
    return {
      inView: inView.map(name),
      cut: inView.filter((el) => el.querySelector("[data-slot=truncate][data-cut]") !== null).map(name),
      latest: latest === undefined ? null : latest.getBoundingClientRect().top < line.bottom - 0.5 && latest.getBoundingClientRect().right <= line.right + 0.5,
      wideBranch: wide.length > 0,
    };
  });
/** Every page of the strip, from the start to the end, read by `pageRead`. */
async function stripPages(window) {
  while (!(await window.isDisabled('[data-history-step="start"]'))) await stripScroll(window, () => window.click('[data-history-step="start"]'));
  const pages = [await settled(() => pageRead(window))];
  while (!(await window.isDisabled('[data-history-step="end"]'))) {
    await stripScroll(window, () => window.click('[data-history-step="end"]'));
    pages.push(await settled(() => pageRead(window)));
  }
  return pages;
}
/** Runs `act`, then waits for the strip's `scrollend`, so a read never lands while the strip is still moving. */
async function stripScroll(window, act) {
  await window.$eval("[data-history-scroll]", (el) => {
    el.dataset.scrolling = "";
    el.addEventListener("scrollend", () => delete el.dataset.scrolling, { once: true });
  });
  await act();
  await window.waitForSelector("[data-history-scroll]:not([data-scrolling])", { timeout: 5000 });
}
const canvasAt = (window) =>
  window.$eval("[data-canvas-iteration]", (el) => ({ n: Number(el.dataset.canvasIteration), past: el.dataset.canvasPast === undefined ? null : Number(el.dataset.canvasPast) }));
const pool = (canvas) => canvas.textContent(inBlock("wheel/neon", "pool"));
const rows = (window, group) => window.$$eval(`[${group}] [data-variant]`, (els) => els.map((e) => e.dataset.variant));
/**
 * The sidebar's variant radio groups: one per slot, named for it, with Main and the options as named sections in it,
 * which radios it holds, which is checked and which says it is Main, and how many radios sit outside any group.
 */
const radioGroups = (window) =>
  window.evaluate(() => {
    const panel = document.querySelector('[data-sidebar-panel="session"]');
    const groups = [...panel.querySelectorAll('[role="radiogroup"]')].map((g) => ({
      name: g.getAttribute("aria-label"),
      sections: [...g.querySelectorAll('[role="group"]')].map((x) => x.getAttribute("aria-label")),
      radios: g.querySelectorAll('[role="radio"]').length,
      checked: [...g.querySelectorAll('[role="radio"][aria-checked="true"]')].map((r) => r.dataset.variant),
      tabStops: [...g.querySelectorAll('[role="radio"][tabindex="0"]')].map((r) => r.dataset.variant),
      main: [...g.querySelectorAll('[role="radio"]')].filter((r) => r.getAttribute("aria-description") === "Main").map((r) => r.dataset.variant),
    }));
    return { groups, loose: [...panel.querySelectorAll('[role="radio"]')].filter((r) => r.closest('[role="radiogroup"]') === null).length };
  });
/**
 * Each line of the pick popover's note and whether it reads whole: no line or box around it wider or taller than it
 * shows, none cut to an ellipsis, none past the popover's edge. "Runs past its box" passed while the note was cut.
 */
const pickNote = () =>
  settled(() =>
    window.$eval("[data-graft-composer]", (composer) => {
      const box = composer.getBoundingClientRect();
      const cut = (el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
      return [...composer.querySelectorAll("[data-graft-note] p")].map((p) => {
        const ink = document.createRange();
        ink.selectNodeContents(p);
        const r = ink.getBoundingClientRect();
        let whole = !p.textContent.trim().endsWith("…") && r.left >= box.left && r.right <= box.right && r.bottom <= box.bottom;
        for (let el = p; el !== composer; el = el.parentElement) whole &&= !cut(el) && getComputedStyle(el).textOverflow !== "ellipsis";
        return [p.textContent.trim(), whole];
      });
    }),
  );
/** A row's marks show on hover, as T3 Code's row actions do. */
async function mark(window, kind, variant) {
  await window.hover(`[data-slot-id] [data-variant="${variant}"]`);
  await window.click(`[data-${kind}="${variant}"]`);
}
/** A held mark is `aria-disabled`, which Playwright won't press, so the pointer presses it as Rob's would. */
async function press(window, kind, variant) {
  await window.hover(`[data-slot-id] [data-variant="${variant}"]`);
  await window.click(`[data-${kind}="${variant}"]`, { force: true });
}

let { app, window, errors } = await launch(home, env);
let session;
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  ({ session } = seedDemo(home, env));
  let canvas = await openSession(window, session);
  await showBoard(window, canvas);
  await canvas.waitForSelector(inBlock("wheel/neon", "pool"));
  await canvas.waitForSelector(inBlock("result/card", "card"));
  check(
    "with one iteration there is nothing to compare, so the strip starts shut and its toggle reads unpressed",
    [await window.getAttribute("[data-history-toggle]", "aria-pressed"), (await window.$("[data-history], [data-history-loading]")) !== null],
    ["false", false],
  );

  // Rob's own state before the agent's second iteration: a setting, and an open pin on the card.
  await canvas.click(inBlock("result/card", "chore"));
  await window.waitForSelector('[data-block="result/card"]');
  await window.click('[data-control="headline"] input');
  await window.keyboard.press("Control+A");
  await window.keyboard.type("Fate has spoken");
  await window.waitForSelector('[data-control="headline"][data-overridden]');
  await window.click("[data-pick-toggle]");
  await canvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-composer]");
  await window.keyboard.type("Make the headline louder");
  await window.click('[data-composer] button:has-text("Pin comment")');
  await window.waitForSelector('[data-feedback="1"][data-status="open"]');

  agentCommit(session, (copy) => replaceIn(join(copy, "slots", "wheel", "neon", "block.tsx"), ODDS, WEIGHTED), ["--note", "Explain the weighting"]);
  await canvas.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("weighted by chores"), inBlock("wheel/neon", "pool"));

  // History.
  await window.waitForSelector("[data-history]");
  check("once a second iteration lands, the strip opens on its own and its toggle reads pressed", [await window.getAttribute("[data-history-toggle]", "aria-pressed"), (await window.$("[data-history]")) !== null], ["true", true]);
  check(
    "the strip is 84 px tall, its stills landscape cards 48 px tall, and it fades its scrolling edge",
    await window.evaluate(() => {
      const card = document.querySelector("[data-history-n] [data-preview]").getBoundingClientRect();
      return [
        Math.round(document.querySelector("[data-history]").getBoundingClientRect().height),
        Math.round(card.height),
        card.width > card.height,
        getComputedStyle(document.querySelector("[data-history-scroll]")).maskImage.startsWith("linear-gradient"),
      ];
    }),
    [84, 48, true, true],
  );
  check(
    "two iterations fit at 1440, so the strip rests at its start with no arrows, every entry whole, 16 px in from the start and the rest of the strip left empty",
    await settled(async () => ({ ...(await stripRest(window)), insets: (await stripRest(window)).insets.map((inset, i) => (i === 0 ? inset : inset >= 16)) })),
    { inView: ["iteration 1", "iteration 2"], cut: [], shown: true, insets: [16, true], scrolled: 0, arrows: 0 },
  );
  check("with room for both, each entry's lines read whole, and neither holds room its lines don't use", await settled(() => stripLines(window)), { cut: [], spare: [], wide: [] });
  const restHead = await settled(() => stripHead(window));
  check("with no arrows showing, the strip's head is as wide as its words", restHead.spare, 0);
  check("the entries' edges take the strong edge at 1.3:1 or more, so an unselected one holds its shape on the card", await stripEdges(window), [
    ["iteration 1", true, true],
    ["iteration 2", true, true],
  ]);
  check(
    "an entry's first line joins its number, age and latest with the cards' middle dots",
    await window.$eval('[data-history-n="2"] [data-history-age]', (age) => [...age.parentElement.children].map((el) => el.textContent.trim())),
    ["Iteration 2", "·", (await window.textContent('[data-history-n="2"] [data-history-age]')).trim(), "· latest"],
  );
  await window.mouse.move(1, 1);
  await window.hover('[data-history-n="2"]');
  check(
    "an entry's hint names it, then its age, then what made it",
    await window
      .waitForSelector('[data-slot="tooltip-content"]', { state: "visible" })
      .then((h) => h.evaluate((el) => /^Iteration 2·(now|\d+m) · latest · Explain the weighting$/.test(el.textContent.trim()))),
    true,
  );
  await window.mouse.move(1, 1);
  check(
    "and with nothing to scroll neither end fades",
    await window.$eval("[data-history-scroll]", (el) => [getComputedStyle(el).getPropertyValue("--fade-start"), getComputedStyle(el).getPropertyValue("--fade-end")]),
    ["0px", "0px"],
  );
  check(
    "the strip has a still per iteration, oldest first, each saying what made it, with the latest selected",
    await strip(window),
    [
      { n: 1, selected: false, origin: "First designs, from the brief" },
      { n: 2, selected: true, origin: "Explain the weighting" },
    ],
  );
  await window.waitForSelector('[data-history-n="1"] [data-preview="still"]', { timeout: PHASE_MS }).catch(() => null);
  check(
    "each still renders its iteration through the preview pipeline",
    await window.$$eval("[data-history-n] [data-preview]", (els) => els.map((e) => e.dataset.preview)),
    ["still", "still"],
  );
  await shot(window, shots, "1-strip");

  await showSlot(window, "wheel");
  const latestWheel = await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant");
  await window.click('[data-history-n="1"]');
  await window.waitForSelector("[data-past-bar]");
  await canvas.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("Odds lean"), inBlock("wheel/neon", "pool"));
  check("clicking a still shows that iteration, read-only", [await canvasAt(window), (await pool(canvas)).includes("Odds lean")], [{ n: 1, past: 1 }, true]);
  await window.waitForTimeout(400);
  check("under the Viewing bar the frame's label sits 32 px below the canvas's top, as on the latest", await labelOffset(canvas), 32);
  check(
    "under a bar naming it, with Back to latest",
    [(await window.textContent("[data-past-bar]")).startsWith("Viewing iteration 1"), (await window.textContent("[data-back-to-latest]")).trim()],
    [true, "Back to latest"],
  );
  check(
    "Back to latest ends where the canvas bar's last control, Present, ends",
    await window.evaluate(() => {
      const right = (el) => Math.round(el.getBoundingClientRect().right);
      return right(document.querySelector("[data-back-to-latest]")) - right(document.querySelector("[data-canvas-bar] [data-present]"));
    }),
    0,
  );
  check(
    "in the past Regenerate is off, Confirm at the sidebar's foot reads Confirm as a branch, and the badge reads Iteration 1 of 2",
    [await window.isDisabled("[data-regenerate-toggle]"), (await window.textContent("[data-confirm-toggle]")).trim(), (await window.textContent("[data-iteration-past]")).trim()],
    [true, "Confirm as a branch", "Iteration 1 of 2"],
  );
  check("the past shows no pins", await canvas.$$eval(".bs-pin", (els) => els.length), 0);
  await canvas.click(inBlock("result/card", "chore"));
  await window.waitForSelector("[data-inspector-past]");
  check(
    "the inspector says it is the past, and its controls are inert, dimmed as one, with no reset on offer",
    await window.$eval("[data-controls-readonly]", (el) => [el.inert, getComputedStyle(el).opacity, el.querySelectorAll("[data-control-reset]").length]),
    [true, "0.6", 0],
  );
  check(
    "an on switch there fills muted, not in the live accent",
    await window.$eval("[data-controls-readonly]", (el) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--fg-muted)" }));
      const muted = getComputedStyle(probe).color;
      probe.remove();
      const on = [...el.querySelectorAll("[data-slot=switch][data-checked]")];
      return [on.length > 0, on.every((s) => getComputedStyle(s).backgroundColor === muted)];
    }),
    [true, true],
  );
  check(
    "the comments, the latest's, read dimmed as the controls do, and their Edit and Delete can't be pressed, nor a comment opened",
    await window.$$eval("[data-feedback]", (items) =>
      items.map((li) => [li.closest("[inert]") !== null, getComputedStyle(li.closest("[data-group]")).opacity, li.querySelectorAll("[data-feedback-action]").length > 0]),
    ),
    [[true, "0.6", true]],
  );
  check(
    "the past says read-only once, in the Inspector beside what it dims",
    await window.evaluate(() => document.body.innerText.match(/read-only/gi)?.length ?? 0),
    1,
  );
  check("Vary is off in the past", await window.isDisabled("[data-vary-toggle]"), true);
  await shot(window, shots, "2-past");

  // A pick in the past is kept apart: the latest iteration's own pick doesn't move.
  await showSlot(window, "wheel");
  await window.click('[data-slot-id="wheel"] [data-variant="reel"]');
  await canvas.waitForSelector(".bs-frame[data-slot=wheel] div[data-bid='wheel/reel']", { state: "attached" });
  check("the past shows the variant picked there", await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant"), "reel");
  check("showing another variant is no mark, so the Viewing bar doesn't warn of marks going", await window.$("[data-past-marks-note]"), null);

  // Marks in the past are the window's own, for a branch from there (ADR 009).
  check("with nothing marked, Confirm as a branch is still on, since a word on what to try can make a branch alone", await window.isDisabled("[data-confirm-toggle]"), false);
  await mark(window, "approve", "reel");
  await window.waitForSelector('[data-main-group] [data-variant="reel"]');
  check("a thumbs up in the past makes Reel the wheel's Main there, at the top, and the rest its options", [await rows(window, "data-main-group"), await rows(window, "data-options-group")], [["reel"], ["neon", "terminal"]]);
  check(
    "once Rob marks the past, the Viewing bar says in one muted line that the marks go when he leaves",
    await window.$eval("[data-past-marks-note]", (el) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--fg-muted)" }));
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return [el.closest("[data-past-bar]") !== null, el.textContent.trim(), getComputedStyle(el).color === muted, el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1];
    }),
    [true, "Marks here go when you leave. Confirm as a branch to keep them.", true, true],
  );
  check(
    "the wheel's variants are one radio group named for the slot, Main and Options sections in it, with one radio checked and one tab stop, and Main's row says it is Main",
    await radioGroups(window),
    { groups: [{ name: "The wheel variants", sections: ["Main", "Options"], radios: 3, checked: ["reel"], tabStops: ["reel"], main: ["reel"] }], loose: 0 },
  );
  await window.focus('[data-slot-id="wheel"] [data-variant="reel"]');
  await window.keyboard.press("ArrowDown");
  await window.waitForSelector('[data-slot-id="wheel"] [data-variant="neon"][aria-checked="true"]');
  check(
    "ArrowDown from Main's row moves on into the options, which checks that one and moves the one tab stop with it",
    [await window.evaluate(() => document.activeElement?.dataset.variant ?? null), (await radioGroups(window)).groups.map((g) => [g.checked, g.tabStops])],
    ["neon", [[["neon"], ["neon"]]]],
  );
  await window.keyboard.press("ArrowUp");
  await window.waitForSelector('[data-slot-id="wheel"] [data-variant="reel"][aria-checked="true"]');
  check("and ArrowUp goes back up into Main", await window.evaluate(() => document.activeElement?.dataset.variant ?? null), "reel");
  // A pick in the past waits on its Main: taking the Main back hides it, as the service hides a stored one, and
  // choosing it again brings it back.
  await window.click("[data-graft-toggle]");
  await canvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-graft-composer]");
  await window.click("[data-graft-add]");
  await window.waitForSelector("[data-graft]");
  await mark(window, "approve", "reel");
  await window.waitForSelector("[data-main-empty]");
  check("taking Main back in the past hides the pick waiting on it, so the sidebar shows only what Confirm would send", [await window.$$eval("[data-graft]", (els) => els.length), await window.isDisabled("[data-confirm-toggle]")], [0, false]);
  await mark(window, "approve", "reel");
  await window.waitForSelector("[data-graft]");
  await window.click("[data-remove-graft]");
  await window.waitForSelector("[data-graft]", { state: "detached" });
  await window.click("[data-confirm-toggle]");
  await window.waitForSelector("[data-confirm-menu]");
  check(
    "its popover is named for the branch and lists what every slot starts with, the unmarked one as it is",
    await window.$eval("[data-confirm-menu]", (el) => [
      el.querySelector("[data-slot=popover-title]").textContent.trim(),
      [...el.querySelectorAll("[data-confirm-slot]")].map((s) => s.dataset.confirmSlot),
      el.querySelector("[data-confirm-dropped]")?.dataset.confirmDropped ?? null,
      el.querySelector('[data-confirm-slot="result"]').textContent.trim(),
      el.querySelector("[data-confirm-hint]").textContent.trim(),
    ]),
    ["Confirm as a branch", ["wheel", "result"], "2", "The result2 variantsAs it is", "Applies at once"],
  );
  await window.fill("[data-confirm-instruction]", "Try the reel for mornings");
  check("an instruction there goes to the agent instead", (await window.textContent("[data-confirm-hint]")).trim(), "Goes to the agent");
  await window.fill("[data-confirm-instruction]", "");
  check("nothing in the confirm popover runs past its box", await outsideBox(window, "[data-confirm-menu]"), []);
  await shots2(window, shots, "3-confirm-past");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-confirm-menu]", { state: "detached" });
  check("Escape closes the popover and stays in the past", (await canvasAt(window)).past, 1);

  // Keyboard: the strip is one listbox.
  await window.focus('[data-history-n="1"]');
  await window.keyboard.press("ArrowRight");
  await window.waitForSelector("[data-past-bar]", { state: "detached" });
  check("ArrowRight steps to iteration 2, the latest, which drops the bar", (await canvasAt(window)).past, null);
  await window.keyboard.press("Home");
  await window.waitForSelector("[data-past-bar]");
  check("Home jumps to the first", [(await canvasAt(window)).past, await window.evaluate(() => document.activeElement?.dataset.historyN)], [1, "1"]);
  // Off the strip, so its focused still's hint isn't the layer Escape closes first.
  await window.click("[data-past-bar]", { position: { x: 4, y: 4 } });
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-past-bar]", { state: "detached" });
  check("Escape in the past goes back to latest", [await canvasAt(window), (await pool(canvas)).includes("weighted by chores")], [{ n: 2, past: null }, true]);
  check("where the pick made in the past didn't move the latest one", await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant"), latestWheel);
  check("nor did the marks made there: the latest has no Main", (await window.$("[data-main-empty]")) !== null, true);
  await window.click('[data-history-n="1"]');
  await window.waitForSelector("[data-past-bar]");
  check(
    "back on iteration 1 the marks made there are gone, and so is the Viewing bar's line about them",
    [await window.$("[data-past-marks-note]"), await window.$("[data-main-group] [data-variant]")].map((el) => el !== null),
    [false, false],
  );
  await window.click("[data-back-to-latest]");
  await window.waitForSelector("[data-past-bar]", { state: "detached" });
  check("Back to latest does too, with the pins back", await canvas.$$eval(".bs-pin", (els) => els.length), 1);

  // The toggle persists across a restart.
  await window.click("[data-history-toggle]");
  await window.waitForSelector("[data-history]", { state: "detached" });
  await window.waitForTimeout(400);
  check("once the strip folds the frame's label still sits 32 px below the canvas's top", await labelOffset(canvas), 32);
  const prefs = await window.evaluate(async () => (await fetch("/v1/ui/prefs").then((r) => r.json()).catch(() => null)));
  void prefs;
  await app.close();
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1440, height: 900 });
  canvas = await openSession(window, session);
  await canvas.waitForSelector(inBlock("wheel/neon", "pool"), { state: "attached" });
  check("after a restart the strip stays shut as Rob left it in this brainstorm, though its two iterations would open it", [await window.getAttribute("[data-history-toggle]", "aria-pressed"), (await window.$("[data-history]")) !== null], ["false", false]);
  await shot(window, shots, "4-strip-closed");
  await window.click("[data-history-toggle]");
  await window.waitForSelector("[data-history]");

  // Marks at the latest are Rob's, stored, and undone the same way (ADR 009).
  await showSlot(window, "wheel");
  check("at the latest Confirm reads Confirm and waits for a mark", [(await window.textContent("[data-confirm-toggle]")).trim(), await window.isDisabled("[data-confirm-toggle]")], ["Confirm", true]);
  await mark(window, "trash", "terminal");
  await window.waitForSelector("[data-trashed-fold]");
  check("a trashed option leaves the options for a fold below them", await rows(window, "data-options-group"), ["neon", "reel"]);
  await mark(window, "approve", "neon");
  await window.waitForSelector('[data-main-group] [data-variant="neon"]');
  check("a thumbs up makes Neon Main, at the top, and what shows", [await rows(window, "data-main-group"), await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant")], [["neon"], "neon"]);
  check("both marks are stored, so the agent reads them in context", context(session).marks, { mains: { wheel: "neon" }, grafts: [], trashed: ["wheel/terminal"] });
  check(
    "at the latest too the slot is one radio group with exactly one radio checked, Neon in Main, and the trashed option out of it",
    await radioGroups(window),
    { groups: [{ name: "The wheel variants", sections: ["Main", "Options"], radios: 2, checked: ["neon"], tabStops: ["neon"], main: ["neon"] }], loose: 0 },
  );
  check("Confirm is on once there is something to lock in", await window.isDisabled("[data-confirm-toggle]"), false);
  await shots2(window, shots, "5-marks");
  check("the slot picker counts what is left in each slot, the trashed variant out", await window.textContent("[data-slot-count]"), "2 variants");
  // Marks in another slot stay in sight: the trigger notes them, and the open picker says what each slot holds.
  await showSlot(window, "result");
  check(
    "working in the result, the picker's trigger notes that the wheel holds marks, and names it to a screen reader",
    await window.$eval("[data-slot-marks-elsewhere]", (el) => [el.dataset.slotMarksElsewhere, el.textContent]),
    ["The wheel", ", marks in The wheel"],
  );
  await window.click("[data-slot-picker]");
  await window.waitForSelector('[data-slot-marks="wheel"]');
  check(
    "the open picker's rows say what each slot holds, whole: the wheel's Main and its trashed option, nothing under the unmarked result",
    await settled(() =>
      window.$$eval("[data-slot-option]", (els) =>
        els.map((e) => {
          const line = e.querySelector("[data-slot-marks]");
          return [e.dataset.slotOption, line?.textContent ?? null, line === null ? null : line.dataset.cut === undefined];
        }),
      ),
    ),
    [
      ["wheel", "Main: Neon wheel · 1 trashed", true],
      ["result", null, null],
    ],
  );
  await shots2(window, shots, "17-slot-picker-marks");
  await window.keyboard.press("Escape");
  await window.waitForSelector('[data-slot-marks="wheel"]', { state: "hidden" });
  await showSlot(window, "wheel");
  check("the trigger notes no other slot's marks from the wheel, since the result has none", await window.$("[data-slot-marks-elsewhere]"), null);
  await mark(window, "approve", "neon");
  await window.waitForSelector("[data-main-empty]");
  await window.click("[data-trashed-fold] button");
  await window.waitForSelector('[data-restore="terminal"]');
  await shots2(window, shots, "18-trashed-open");
  await window.click('[data-restore="terminal"]');
  await window.waitForSelector("[data-trashed-fold]", { state: "detached" });
  check("a second thumbs up and Restore undo them", context(session).marks, { mains: {}, grafts: [], trashed: [] });

  // Trashing the option on show takes it off the board too: the slot's frame moves to Main, or with none to the first
  // variant left, as the sidebar's showing row does.
  const framed = () =>
    settled(async () => [
      await canvas.$eval('.bs-frame[data-slot="wheel"] .bs-frame-body > [data-bid]', (el) => el.dataset.bid),
      await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant"),
    ]);
  check("before a trash, the wheel's frame and the sidebar both show Neon", await framed(), ["wheel/neon", "neon"]);
  await mark(window, "trash", "neon");
  await window.waitForSelector('[data-trashed-fold="1"]');
  check("trashing Neon while it shows, with no Main, puts the first variant left, Reel, on the wheel's frame", await framed(), ["wheel/reel", "reel"]);
  await window.click("[data-trashed-fold] button");
  await window.click('[data-restore="neon"]');
  await window.waitForSelector("[data-trashed-fold]", { state: "detached" });
  await mark(window, "approve", "terminal");
  await window.waitForSelector('[data-main-group] [data-variant="terminal"]');
  await window.click('[data-slot-id="wheel"] [data-variant="neon"]');
  await window.waitForSelector('[data-slot-id="wheel"] [data-showing][data-variant="neon"]');
  await mark(window, "trash", "neon");
  await window.waitForSelector('[data-trashed-fold="1"]');
  check("trashing Neon while it shows beside a Main puts Main, Terminal, on the wheel's frame", await framed(), ["wheel/terminal", "terminal"]);
  await window.click("[data-trashed-fold] button");
  await window.click('[data-restore="neon"]');
  await window.waitForSelector("[data-trashed-fold]", { state: "detached" });
  await mark(window, "approve", "terminal");
  await window.waitForSelector("[data-main-empty]");
  await window.click('[data-slot-id="wheel"] [data-variant="neon"]');
  await window.waitForSelector('[data-slot-id="wheel"] [data-showing][data-variant="neon"]');
  check("Restore and a second thumbs up leave no marks", context(session).marks, { mains: {}, grafts: [], trashed: [] });

  // Keyboard alone: arrows move along the rows, Tab reaches the row's 👍, Enter presses it.
  await window.focus('[data-slot-id="wheel"] [data-showing]');
  const fromRow = await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant");
  await window.keyboard.press("ArrowDown");
  const toRow = await window.evaluate(() => document.activeElement?.dataset.variant ?? null);
  await window.keyboard.press("Tab");
  const tabbed = await window.evaluate(() => document.activeElement?.dataset.approve ?? null);
  await window.keyboard.press("Enter");
  await window.waitForSelector(`[data-main-group] [data-variant="${toRow}"]`);
  check(
    "with the keyboard alone, ArrowDown moves to the next variant and shows it, Tab reaches its 👍, and Enter makes it Main with focus still on that 👍 in the Main list",
    [
      toRow !== fromRow,
      (await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant")) === toRow,
      tabbed === toRow,
      await window.getAttribute(`[data-approve="${toRow}"]`, "aria-pressed"),
      await window.evaluate(() => [document.activeElement?.dataset.approve ?? null, document.activeElement?.closest("[data-main-group]") !== null]),
    ],
    [true, true, true, "true", [toRow, true]],
  );
  await window.keyboard.press("Enter");
  await window.waitForSelector("[data-main-empty]");
  await window.click(`[data-slot-id="wheel"] [data-variant="${fromRow}"]`);

  // Confirm on a past iteration makes a branch, on the same thread (ADR 009).
  await window.click('[data-history-n="1"]');
  await window.waitForSelector("[data-past-bar]");
  await showSlot(window, "wheel");
  await mark(window, "approve", "reel");
  await window.waitForSelector('[data-main-group] [data-variant="reel"]');
  const sentBefore = t3.sent().length;
  await window.click("[data-confirm-toggle]");
  await window.click("[data-confirm-send]");
  await window.waitForSelector("[data-branch-line]");
  const branchId = await window.getAttribute("[data-branch-line]", "data-branch-line");
  check("the window opened the branch, which says where it left from and offers Make primary", [(await window.textContent("[data-branch-line]")).replace("Make primary", "").trim(), (await window.$("[data-make-primary]")) !== null], ["Branch from iteration 1", true]);
  check(
    "the branch line's way back leads with the back chevron All brainstorms has, so it reads as a way back rather than a label",
    await window.evaluate(() => {
      const glyph = (sel) => [...document.querySelector(`${sel} svg`).classList].find((c) => c.startsWith("lucide-"));
      return [glyph("[data-branch-back]"), glyph("[data-back]")];
    }),
    ["lucide-chevron-left", "lucide-chevron-left"],
  );
  await window.hover("[data-branch-back]");
  check(
    "and its hint still names the line it opens",
    await window.waitForSelector('[data-slot="tooltip-content"]', { state: "visible" }).then((h) => h.evaluate((el) => el.textContent.trim())),
    "Open Chore roulette, the line this branch left",
  );
  await window.mouse.move(1, 1);
  check("keeping a Main needs no agent and no new thread", [t3.sent().length - sentBefore, t3.started()], [0, []]);
  const branched = context(branchId);
  check("the branch is on the brainstorm's own thread", branched.attachedThread, DEMO_THREAD);
  check("its first iteration numbers on from where it left, 2, with only Reel in the wheel and the unmarked result as it was", [branched.latest.n, [...branched.latest.blocks].sort()], [2, ["result/card", "result/receipt", "wheel/reel"]]);
  check("Rob's setting is baked in as a default", branched.branchOf.baked.map((b) => [b.blockId, b.prop, b.value]), [["result/card", "headline", "Fate has spoken"]]);
  const branchCopy = join(home, "branch-copy");
  must("pull branch", brainstorm(env, ["pull", branchId, "--out", branchCopy, "--json"]));
  check(
    "in the block itself, with one variant folder in the wheel",
    [JSON.parse(readFileSync(join(branchCopy, "slots", "result", "card", "block.json"), "utf8")).props.appearance.headline.default, readdirSync(join(branchCopy, "slots", "wheel"))],
    ["Fate has spoken", ["reel"]],
  );
  check("the open pin carries over, and no request is open", [branched.feedback.open.map((f) => [f.text, f.pin.blockId]), branched.request], [[["Make the headline louder", "result/card"]], null]);
  if ((await window.$("[data-history]")) === null) await window.click("[data-history-toggle]");
  await window.waitForSelector("[data-history]");
  check("its strip shows the branch's own run, which starts with the confirm that made it, the app's answer saying what it kept", [await window.getAttribute("[data-strip-run]", "data-strip-run"), (await strip(window)).map((e) => [e.n, e.origin])], ["Confirm 1", [[2, "Kept Slot reel · 2 options dropped"]]]);
  await shot(window, shots, "6-branch");
  await window.click("[data-strip-run]");
  await window.click('[data-run-option="Start"]');
  await window.waitForSelector(`[data-history-branch="${session}"]`);
  check("its Start run is the first line's iteration 1, and the first line carries on from it as an offshoot", [(await strip(window)).map((e) => e.n), await window.$eval(`[data-history-branch="${session}"]`, (el) => el.previousElementSibling.dataset.historyN)], [[1], "1"]);

  // Make primary: the branch becomes the line home shows, and the first line an offshoot it can come back from.
  await window.click("[data-make-primary]");
  await window.waitForSelector("[data-branch-line]", { state: "detached" });
  await window.click("[data-back]");
  await window.waitForSelector(`[data-session="${branchId}"]`);
  check("home lists the brainstorm once, by its first title, opening the primary branch", [(await window.$(`[data-session="${session}"]`)) === null, (await window.textContent(`[data-session="${branchId}"] [data-row-title]`)).trim()], [true, "Chore roulette"]);
  await shot(window, shots, "7-home-primary");
  canvas = await openSession(window, branchId);
  await window.waitForSelector("[data-history]");
  await window.click("[data-strip-run]");
  await window.click('[data-run-option="Start"]');
  await window.click(`[data-history-branch="${session}"]`);
  await window.waitForSelector(`[data-branch-line="${session}"]`);
  check("the first line, now an offshoot, says so and can take its place back", (await window.textContent("[data-branch-line]")).replace("Make primary", "").trim(), "The first line, now an offshoot");
  await window.click("[data-make-primary]");
  await window.waitForSelector("[data-branch-line]", { state: "detached" });
  await window.click("[data-back]");
  await window.waitForSelector(`[data-session="${session}"]`);

  // Vary, back in the parent.
  canvas = await openSession(window, session);
  await canvas.waitForSelector(inBlock("wheel/neon", "spin-button"));
  await window.click("[data-vary-toggle]");
  await window.waitForSelector("[data-pick-hint]");
  check("Vary element starts a pick, with its own hint", (await window.textContent("[data-pick-hint]")).trim(), "Click to vary");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-pick-hint]", { state: "detached" });
  check("Escape ends the vary pick", await window.getAttribute("[data-vary-toggle]", "aria-pressed"), "false");
  await window.click("[data-vary-toggle]");
  await canvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-vary-composer]");
  check(
    "the vary popover names the element and its block, asks for 3 by default, and says where they land",
    await window.$eval("[data-vary-composer]", (el) => [el.querySelector("#vary-title").textContent.trim(), Number(el.querySelector("[data-vary-count]").dataset.varyCount), el.querySelector("[data-vary-hint]").textContent.trim()]),
    ["Vary Spin button", 3, "Variants land in The wheel"],
  );
  check(
    "its description names the block once and leaves the slot to the footer, in the one <context> · <clause> grammar",
    await window.$eval("[data-vary-composer] [data-slot=popover-description]", (el) => el.textContent.trim()),
    "Neon wheel · everything else stays",
  );
  check("while the vary popover is up, Vary element reads open, the accent edge every popover trigger takes", await settled(() => window.$eval("[data-vary-toggle]", (b) => {
      const accent = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--accent)" }));
      const open = [b.getAttribute("aria-expanded"), getComputedStyle(b).borderTopColor === getComputedStyle(accent).color];
      accent.remove();
      return open;
    })), ["true", true]);
  check("nothing in the vary popover runs past its box: the direction field, its optional label and Send all sit inside", await outsideBox(window, "[data-vary-composer]"), []);
  check(
    "every control in the vary popover is the 28 px control height: the stepper, the direction field, Cancel and Send",
    await window.$$eval("[data-vary-composer] button, [data-vary-composer] input", (els) => els.map((el) => [el.textContent.trim() || el.getAttribute("aria-label") || el.tagName, el.getBoundingClientRect().height])),
    [["Fewer", 28], ["More", 28], ["INPUT", 28], ["Cancel", 28], ["Send", 28]],
  );
  check(
    "and it opens clear of the element it varies",
    await settled(async () => {
      const panel = await window.$eval("[data-vary-composer]", (p) => p.getBoundingClientRect().toJSON());
      const outline = await window.$eval("[data-vary-outline]", (o) => o.getBoundingClientRect().toJSON());
      return panel.top >= outline.bottom || panel.bottom <= outline.top;
    }),
    true,
  );
  await shot(window, shots, "8-vary-composer");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-vary-composer]", { state: "detached" });
  check("Escape closes the vary popover and sends nothing", t3.sent().length, 0);

  await window.click("[data-vary-toggle]");
  await canvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-vary-composer]");
  await window.fill("[data-vary-direction]", "bolder");
  await window.click("[data-vary-send]");
  await window.waitForSelector('[data-request-phase="queued"]', { timeout: PHASE_MS });
  check(
    "Send makes a scoped vary request, its variants named after the element",
    t3.sent().map((s) => s.message.split("\n")[0]),
    [`[brainstorm] session ${session} · request 1 · scope: vary wheel/neon [spin-button] as spin-button-a, spin-button-b, spin-button-c · freetext: "bolder"`],
  );
  const asked = context(session).request;
  check(
    "the agent's context carries the vary scope",
    asked?.scope,
    {
      kind: "vary",
      target: { blockId: "wheel/neon", part: "spin-button" },
      variants: [
        { key: "spin-button-a", title: "Spin button A" },
        { key: "spin-button-b", title: "Spin button B" },
        { key: "spin-button-c", title: "Spin button C" },
      ],
    },
  );

  t3.startRun(DEMO_THREAD);
  const committed = agentCommit(session, (copy) => {
    const slot = join(copy, "slots", "wheel");
    for (const { key, title } of asked.scope.variants) {
      cpSync(join(slot, "neon"), join(slot, key), { recursive: true });
      const json = JSON.parse(readFileSync(join(slot, key, "block.json"), "utf8"));
      writeFileSync(join(slot, key, "block.json"), JSON.stringify({ ...json, title }, null, 2));
      // Each option's spin button carries its own mark, so a merge that brings one into Main shows which it brought.
      replaceIn(join(slot, key, "block.tsx"), 'data-part="spin-button"', `data-part="spin-button" data-option-mark="${key}"`);
    }
  }, ["--note", "Three bolder spin buttons"]);
  t3.endRun(DEMO_THREAD, "completed");
  check("the agent's commit adds only the new variants, with no warnings", [committed.iteration.changed.sort(), committed.warnings], [["wheel/spin-button-a", "wheel/spin-button-b", "wheel/spin-button-c"], []]);
  await window.waitForSelector('[data-request-phase="fulfilled"]', { timeout: PHASE_MS });
  check(
    "the new variants land in the slot, marked new",
    await window.$$eval('[data-slot-id="wheel"] [data-variant]', (els) => els.map((e) => [e.dataset.variant, e.querySelector("[data-variant-new]") !== null])),
    [
      ["neon", false],
      ["reel", false],
      ["spin-button-a", true],
      ["spin-button-b", true],
      ["spin-button-c", true],
      ["terminal", false],
    ],
  );
  check(
    "a new variant's mark is an accent ring and the showing one's a filled dot, so form tells them apart, not hue alone",
    await window.$$eval('[data-slot-id="wheel"] [data-variant]', (rows) => {
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style.color = "var(--accent)";
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return rows.map((r) => {
        const mark = getComputedStyle(r.querySelector('[data-slot="sidebar-menu-mark"] > span'));
        const ring = mark.outlineStyle !== "none" && mark.outlineColor === accent;
        const dot = mark.backgroundColor !== "rgba(0, 0, 0, 0)";
        return [r.dataset.variant, ring && dot ? "ring and dot" : ring ? "ring" : dot ? "dot" : "none"];
      });
    }),
    [
      ["neon", "dot"],
      ["reel", "none"],
      ["spin-button-a", "ring"],
      ["spin-button-b", "ring"],
      ["spin-button-c", "ring"],
      ["terminal", "none"],
    ],
  );
  check(
    "a row shows its key only when it says more than the name, so a varied variant's key, its name hyphenated, stays off",
    await window.$$eval('[data-slot-id="wheel"] [data-variant]', (rows) => rows.map((r) => [r.dataset.variant, r.querySelector("[data-variant-key]")?.textContent ?? null])),
    [
      ["neon", "neon"],
      ["reel", "reel"],
      ["spin-button-a", null],
      ["spin-button-b", null],
      ["spin-button-c", null],
      ["terminal", "terminal"],
    ],
  );
  check("the strip says what made the iteration", (await strip(window)).at(-1).origin, "Vary Spin button ×3 · bolder");
  await shot(window, shots, "9-vary-landed");
  await window.setViewportSize({ width: 1100, height: 720 });
  check(
    "at 1100 the new variants' names read whole, the raw key giving way first, and each is marked new by its accent lead mark",
    await settled(() =>
      window.$$eval('[data-slot-id="wheel"] [data-variant^="spin-button"]', (rows) =>
        rows.map((r) => {
          const title = r.querySelector("[data-variant-title]");
          return [title.textContent, title.scrollWidth <= title.clientWidth, r.querySelector("[data-variant-new]") !== null];
        }),
      ),
    ),
    [
      ["Spin button A", true, true],
      ["Spin button B", true, true],
      ["Spin button C", true, true],
    ],
  );
  check(
    "at 1100 the overflowing strip shows the latest whole, 16 px off both ends, with its arrows",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown, rest.insets, rest.arrows];
    }),
    [["iteration 3"], [], true, [16, 16], 2],
  );
  check("the later arrow is off at the end, the earlier one on", [await window.isDisabled('[data-history-step="end"]'), await window.isDisabled('[data-history-step="start"]')], [true, false]);
  check("only the start, where entries hide, shows its cue that more waits that way", await edgeCues(window), ["start"]);
  const cue = await window.$eval('[data-history-cue="start"]', (el) => {
    const [r, strip] = [el.getBoundingClientRect(), document.querySelector("[data-history]").getBoundingClientRect()];
    return { x: Math.ceil(r.left), y: Math.round(r.top), width: Math.floor(r.right) - Math.ceil(r.left), height: Math.round(r.height), stripInner: Math.round(strip.bottom - r.top) };
  });
  check("the cue runs the strip's full height under its rule, not an entry's 56 px", cue.height, cue.stripInner);
  for (const theme of ["light", "dark"]) {
    await window.emulateMedia({ colorScheme: theme });
    await window.waitForTimeout(300);
    const card = await window.evaluate(() => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--card)" }));
      const c = getComputedStyle(probe).color.match(/\d+/g).map(Number);
      probe.remove();
      return c;
    });
    const row = await pixels(app, window, { x: cue.x, y: cue.y + Math.round(cue.height / 2), width: cue.width, height: 1 });
    const grey = row.map(([r, g, b]) => Math.round((r + g + b) / 3));
    const base = Math.round(card.reduce((t, v) => t + v, 0) / 3);
    check(
      `in ${theme} the cue shades the card at the strip's edge and fades into it, no column lighter than the card`,
      { edge: base - grey[0] >= 8, fades: Math.abs(grey.at(-1) - base) <= 2, lighter: grey.filter((v) => v > base + 1).length },
      { edge: true, fades: true, lighter: 0 },
    );
  }
  await window.emulateMedia({ colorScheme: "light" });
  const uncut = async () => (await settled(() => firstLines(window))).map(([n, age, latest]) => [n, age, latest === "cut" ? "cut" : "uncut"]);
  check("at 1100 the latest entry's age reads whole, and latest whole or not at all", await uncut(), [[3, "whole", "uncut"]]);
  const overflowHead = await settled(() => stripHead(window));
  check(
    "with its arrows on the heading's line the head is still only as wide as its words, and the heading keeps its place",
    [overflowHead.spare, overflowHead.heading],
    [0, restHead.heading],
  );
  // Each iteration here needs more than half the strip's 407 px, so each takes a page of its own.
  const restRead = () =>
    settled(async () => {
      const rest = await stripRest(window);
      const offInView = await window.$$eval("[data-history-list] > [data-off]", (els) => {
        const box = document.querySelector("[data-history-scroll]").getBoundingClientRect();
        return els.filter((el) => el.getBoundingClientRect().left < box.right && el.getBoundingClientRect().right > box.left).length;
      });
      return [rest.inView, rest.cut, rest.insets[0], offInView];
    });
  const back = [];
  const backCues = [];
  for (let i = 0; i < 2; i++) {
    await stripScroll(window, () => window.click('[data-history-step="start"]'));
    back.push(await restRead());
    backCues.push(await edgeCues(window));
  }
  check(
    "the earlier arrow steps back a page at a time and rests on each page's start, every entry it shows whole, the cut one out of sight",
    back,
    [
      [["branch", "iteration 2"], [], 16, 1],
      [["iteration 1", "branch"], [], 16, 1],
    ],
  );
  check("between pages both ends show their cue, and at the start only the end", backCues, [["start", "end"], ["end"]]);
  // Focusing the latest scrolls it into view, so the wait spans the focus as well as End.
  await stripScroll(window, async () => {
    await window.focus('[data-history-n="3"]');
    await window.keyboard.press("End");
  });
  check(
    "End on the strip brings the latest back whole",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown];
    }),
    [["iteration 3"], [], true],
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  check(
    "at 1440 the strip shows three whole entries, the latest last",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown, rest.insets, rest.arrows];
    }),
    [["branch", "iteration 2", "iteration 3"], [], true, [16, 16], 2],
  );
  check("and both iterations in view read their age whole, and latest whole or not at all", await uncut(), [
    [2, "whole", "uncut"],
    [3, "whole", "uncut"],
  ]);
  const overflowLines = await settled(() =>
    window.$$eval("[data-history-list] > *:not([data-off])", (entries) => {
      const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : "branch");
      const cut = entries.filter((el) => [...el.querySelectorAll('[data-slot="truncate"]')].some((t) => t.scrollWidth > t.clientWidth));
      const spare = entries.filter((el) => {
        const width = el.getBoundingClientRect().width;
        el.style.width = "max-content";
        const need = el.getBoundingClientRect().width;
        el.style.removeProperty("width");
        return width > Math.max(180, need) + 1;
      });
      return { cut: cut.map(name), spare: cut.length === 0 ? [] : spare.map(name) };
    }),
  );
  console.log(`  strip lines cut at 1440 once it overflows: ${overflowLines.cut.join(", ") || "none"}`);
  check("once the strip overflows, no entry in view holds room while another's line is cut", overflowLines.spare, []);
  for (const [width, height] of [
    [1100, 720],
    [1440, 900],
  ]) {
    await window.setViewportSize({ width, height });
    const pages = await stripPages(window);
    console.log(`  strip pages at ${width}: ${pages.map((page) => page.inView.join(" + ")).join(" | ")}`);
    check(
      `at ${width}, on every page of a branched and varied brainstorm's strip, each iteration's lines read whole, latest names itself in full, and the branch's tile takes no more than its words`,
      pages.filter((page) => page.cut.some((name) => name.startsWith("iteration")) || page.latest === false || page.wideBranch),
      [],
    );
  }
  await window.click('[data-slot-id="wheel"] [data-variant="spin-button-a"]');
  await window.waitForSelector('[data-variant="spin-button-a"] [data-variant-new]', { state: "detached", timeout: PHASE_MS });
  check(
    "a new variant stops being new once it has been on the canvas a moment, and only that one",
    await settled(() => window.$$eval('[data-slot-id="wheel"] [data-variant-new]', (els) => els.map((e) => e.closest("[data-variant]").dataset.variant))),
    ["spin-button-b", "spin-button-c"],
  );

  // Grafts at the latest: with Neon as Main, a vary option's 👍 brings its element in, and Pick brings one from another
  // slot (ADR 009). Confirm then goes to the agent, which merges them and drops the rest.
  await showSlot(window, "wheel");
  // Into a slot with no Main, a pick makes the variant showing there its Main first (`withPick`), and says so.
  await window.click("[data-graft-toggle]");
  await canvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-graft-composer]");
  check(
    "picked into the wheel while it has no Main, the popover says the pick makes Spin button A, the variant showing, its Main, every line of its note whole",
    await pickNote(),
    [
      ["Makes Spin button A Main of The wheel", true],
      ["Without a word, the agent places it where it fits best. Applied when you confirm.", true],
    ],
  );
  await shots2(window, shots, "16-pick-makes-main");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-graft-composer]", { state: "detached" });
  check("Escape closes it with no mark made", context(session).marks, { mains: {}, grafts: [], trashed: [] });
  await showSlot(window, "wheel");
  await mark(window, "approve", "neon");
  await window.waitForSelector('[data-main-group] [data-variant="neon"]');
  check("with Neon as Main, a vary option's 👍 offers to bring its spin button into Main", await window.getAttribute('[data-approve="spin-button-b"]', "data-approve-kind"), "graft");
  await mark(window, "approve", "spin-button-b");
  await window.waitForSelector("[data-graft]");
  await window.click("[data-graft-toggle]");
  check("Pick into Main starts a pick, with its own hint", (await window.textContent("[data-pick-hint]")).trim(), "Click to pick");
  await canvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-graft-composer]");
  check("the pick popover lands in the slot open in the sidebar unless Rob chooses another", await window.getAttribute("[data-graft-into]", "data-graft-into"), "wheel");
  check("nothing in the pick popover runs past its box", await outsideBox(window, "[data-graft-composer]"), []);
  // Its note is the one place a pick says nothing runs until Confirm, so every line of it reads whole.
  const notes = [];
  for (const theme of ["light", "dark"]) {
    await window.emulateMedia({ colorScheme: theme });
    for (const [width, height] of [
      [1440, 900],
      [1100, 720],
    ]) {
      await window.setViewportSize({ width, height });
      for (const words of ["", "above the logo"]) {
        await window.fill("[data-graft-instruction]", words);
        notes.push([`${theme} ${width} ${words === "" ? "no instruction" : "instruction"}`, ...(await pickNote())]);
      }
    }
  }
  await window.emulateMedia({ colorScheme: "light" });
  await window.setViewportSize({ width: 1440, height: 900 });
  const NO_WORD = ["Without a word, the agent places it where it fits best. Applied when you confirm.", true];
  const WORDS = ["Applied when you confirm.", true];
  check(
    "the pick popover's note reads whole, with and without an instruction, in both themes, at 1440 and 1100, and says it applies when you confirm",
    notes,
    ["light", "dark"].flatMap((t) => [1440, 1100].flatMap((w) => [[`${t} ${w} no instruction`, NO_WORD], [`${t} ${w} instruction`, WORDS]])),
  );
  check("the wheel has Neon as Main, so the pick says nothing about making one", await window.$("[data-graft-makes-main]"), null);
  await window.fill("[data-graft-instruction]", "above the logo");
  await shots2(window, shots, "16-pick");
  await window.click("[data-graft-add]");
  await window.waitForSelector("[data-graft-composer]", { state: "detached" });
  check(
    "both elements wait for Main, stored so the agent reads them, and the sidebar lists them under it",
    [context(session).marks.grafts.map((g) => [g.from.blockId, g.from.part, g.into, g.instruction]), await window.$$eval("[data-graft]", (els) => els.length)],
    [
      [
        ["wheel/spin-button-b", "spin-button", "wheel", null],
        ["result/card", "headline", "wheel", "above the logo"],
      ],
      2,
    ],
  );
  await shots2(window, shots, "13-grafts");
  // Leaving a graft out hands focus on, so the keyboard isn't dropped to the page: to the graft before it, and from the
  // last one to Main's 👍. Both come back the way they went in.
  const graftIds = await window.$$eval("[data-graft]", (els) => els.map((e) => e.dataset.graft));
  await window.focus(`[data-remove-graft="${graftIds[1]}"]`);
  await window.keyboard.press("Enter");
  await window.waitForFunction(() => document.querySelectorAll("[data-graft]").length === 1);
  const afterOne = await window.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
  await window.keyboard.press("Enter");
  await window.waitForSelector("[data-graft]", { state: "detached" });
  check(
    "removing a graft by its × moves focus to the graft's × before it, and removing the last to Main's 👍",
    [afterOne, await window.evaluate(() => [document.activeElement?.dataset.approve ?? null, document.activeElement?.closest("[data-main-group]") !== null])],
    ["Leave Spin button out of Main", ["neon", true]],
  );
  await mark(window, "approve", "spin-button-b");
  await window.waitForSelector("[data-graft]");
  await window.click("[data-graft-toggle]");
  await canvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-graft-composer]");
  await window.fill("[data-graft-instruction]", "above the logo");
  await window.click("[data-graft-add]");
  await window.waitForSelector("[data-graft-composer]", { state: "detached" });
  check(
    "both grafts come back as they were",
    context(session).marks.grafts.map((g) => [g.from.blockId, g.from.part, g.into, g.instruction]),
    [
      ["wheel/spin-button-b", "spin-button", "wheel", null],
      ["result/card", "headline", "wheel", "above the logo"],
    ],
  );
  const sentBeforeMerge = t3.sent().length;
  await window.click("[data-confirm-toggle]");
  await window.waitForSelector("[data-confirm-menu]");
  check(
    "the confirm popover counts what goes, lists both grafts, and says it goes to the agent",
    [await window.getAttribute("[data-confirm-dropped]", "data-confirm-dropped"), await window.$$eval("[data-confirm-graft]", (els) => els.length), (await window.textContent("[data-confirm-hint]")).trim()],
    ["5", 2, "Goes to the agent"],
  );
  check(
    "the confirm popover ends above the history strip, clear of its top edge",
    await settled(() => window.evaluate(() => document.querySelector("[data-history]").getBoundingClientRect().top - document.querySelector("[data-confirm-menu]").getBoundingClientRect().bottom >= 4)),
    true,
  );
  await shots2(window, shots, "14-confirm-grafts");
  await window.click("[data-confirm-send]");
  await window.waitForSelector('[data-request-phase="queued"]', { timeout: PHASE_MS });
  check(
    "Confirm sends one confirm request to the agent, and the marks hold while it is open, each still named for what it does with the reason as its description",
    [
      t3.sent().length - sentBeforeMerge,
      t3.sent().at(-1)?.message.split("\n")[0].includes(" · scope: confirm"),
      await window.$eval('[data-approve="neon"]', (b) => [b.getAttribute("aria-disabled"), b.getAttribute("aria-label"), b.getAttribute("aria-description")]),
      await window.$eval("[data-remove-graft]", (b) => b.getAttribute("aria-label")),
    ],
    [1, true, ["true", "Stop keeping this as Main", "The confirm is with the agent, so its marks hold until it lands or you withdraw it"], "Leave Spin button out of Main"],
  );
  // Pressing a held mark does nothing: no mark moves, no request goes, no notice rises, and it still says why.
  const HELD = "The confirm is with the agent, so its marks hold until it lands or you withdraw it";
  const heldState = async () => [context(session).marks, await rows(window, "data-main-group"), await rows(window, "data-options-group"), t3.sent().length];
  const beforeHeld = await heldState();
  await press(window, "trash", "reel");
  await press(window, "approve", "neon");
  await window.waitForTimeout(500);
  check(
    "a held 🗑 and a held 👍, pressed while the confirm is with the agent (the press lands: the 👍 takes focus), change nothing and raise no notice, each giving its reason as its description",
    [
      await window.evaluate(() => document.activeElement?.dataset.approve ?? null),
      await heldState(),
      (await window.$("[data-slot=toast]")) === null,
      await window.$eval('[data-trash="reel"]', (b) => [b.getAttribute("aria-disabled"), b.getAttribute("aria-description")]),
      await window.$eval('[data-approve="neon"]', (b) => [b.getAttribute("aria-disabled"), b.getAttribute("aria-description")]),
    ],
    ["neon", beforeHeld, true, ["true", HELD], ["true", HELD]],
  );
  t3.startRun(DEMO_THREAD);
  const merged = agentCommit(session, (copy) => {
    const wheel = join(copy, "slots", "wheel");
    for (const gone of ["reel", "terminal", "spin-button-a", "spin-button-b", "spin-button-c"]) rmSync(join(wheel, gone), { recursive: true });
    replaceIn(join(wheel, "neon", "block.tsx"), '<div className="logo" data-part="logo">', '<p className="headline" data-part="headline">Up next</p>\n        <div className="logo" data-part="logo">');
    // Spin button B's button replaces Neon's own, mark and all.
    replaceIn(join(wheel, "neon", "block.tsx"), 'data-part="spin-button"', 'data-part="spin-button" data-option-mark="spin-button-b"');
  }, ["--note", "Merged the bolder spin button and the headline into Neon"]);
  t3.endRun(DEMO_THREAD, "completed");
  check("the agent's merge passes the confirm's checks", merged.warnings, []);
  await window.waitForSelector('[data-canvas-iteration="4"]', { timeout: PHASE_MS });
  check("iteration 4 holds only Main in the wheel, the unmarked result as it was, and the marks are spent", [[...context(session).latest.blocks].sort(), context(session).marks], [["result/card", "result/receipt", "wheel/neon"], { mains: {}, grafts: [], trashed: [] }]);
  await showSlot(window, "wheel");
  check(
    "Main on the canvas now carries Spin button B's button and the picked headline",
    [await canvas.$eval(inBlock("wheel/neon", "spin-button"), (el) => el.dataset.optionMark ?? null), (await canvas.textContent(inBlock("wheel/neon", "headline")))?.trim()],
    ["spin-button-b", "Up next"],
  );
  // The wheel's last variant is its Main without a 👍: Main can't be trashed, nor a slot's last variant, so it offers
  // no 🗑, and its 👍 is held, named for why, and does nothing when pressed.
  await press(window, "approve", "neon");
  await window.waitForTimeout(500);
  check(
    "the wheel's last variant, Main with no 👍, offers no 🗑, and its held 👍, pressed, keeps the marks as they were and raises no notice",
    [
      (await window.$('[data-trash="neon"]')) === null,
      await window.$eval('[data-approve="neon"]', (b) => [b.getAttribute("aria-disabled"), b.getAttribute("aria-label")]),
      context(session).marks,
      await rows(window, "data-main-group"),
      (await window.$("[data-slot=toast]")) === null,
    ],
    [true, ["true", "Main, as the only variant left"], { mains: {}, grafts: [], trashed: [] }, ["neon"], true],
  );

  // A confirm with nothing to graft needs no agent: the app narrows the iteration itself.
  await showSlot(window, "result");
  await mark(window, "trash", "receipt");
  const sentBeforeConfirm = t3.sent().length;
  await window.click("[data-confirm-toggle]");
  await window.waitForSelector("[data-confirm-menu]");
  check("the confirm popover counts what goes, and applies at once", [await window.getAttribute("[data-confirm-dropped]", "data-confirm-dropped"), (await window.textContent("[data-confirm-hint]")).trim()], ["1", "Applies at once"]);
  // Ctrl+Enter, the key the popover shows beside Confirm, sends it from wherever focus sits.
  await window.keyboard.press("Control+Enter");
  await window.waitForSelector('[data-canvas-iteration="5"]', { timeout: PHASE_MS });
  check("Confirm writes iteration 5 without the trashed receipt, and no agent turn", [[...context(session).latest.blocks].sort(), t3.sent().length - sentBeforeConfirm], [["result/card", "wheel/neon"], 0]);
  check("the marks are spent", context(session).marks, { mains: {}, grafts: [], trashed: [] });
  check("the strip opens a new run on the latest confirm, named for it, saying what it kept and dropped", [await window.getAttribute("[data-strip-run]", "data-strip-run"), (await strip(window)).map((e) => [e.n, e.origin])], ["Confirm 2", [[5, "Kept Assignment card · 1 option dropped"]]]);
  check(
    "the run toggle reads as the menu it opens, edged like the slot picker and named for the earlier runs behind it",
    await window.$eval("[data-strip-run]", (el) => {
      const edge = getComputedStyle(el).borderTopColor;
      return [el.getAttribute("aria-label"), edge !== "rgba(0, 0, 0, 0)" && edge !== "transparent", el.querySelector("svg") !== null];
    }),
    ["History run: Confirm 2, 1 iteration. Show earlier runs", true, true],
  );
  await window.click("[data-strip-run]");
  await window.waitForSelector("[data-run-option]");
  check("the run picker lists the runs newest first", await window.$$eval("[data-run-option]", (els) => els.map((e) => e.dataset.runOption)), ["Confirm 2", "Confirm 1", "Start"]);
  await shot(window, shots, "11-runs");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-run-option]", { state: "hidden" });

  // Add slot asks the agent for a new slot, as a request like any other.
  await window.click("[data-slot-picker]");
  await window.waitForSelector("[data-add-slot]");
  check("the open slot picker lists each slot with what is left in it, then Add slot", await window.$$eval("[data-slot-option], [data-add-slot]", (els) => els.map((e) => e.textContent.trim())), ["The wheel1", "The result1", "Add slot…"]);
  await shots2(window, shots, "17-slot-picker");
  await window.click("[data-add-slot]");
  await window.waitForSelector("[data-add-slot-dialog]");
  await window.fill("[data-add-slot-prompt]", "A settings sheet for who is on the rota");
  await shots2(window, shots, "15-add-slot");
  await window.click("[data-add-slot-send]");
  await window.waitForSelector('[data-request-phase="queued"]', { timeout: PHASE_MS });
  check("Add slot sends the agent a request scoped to a new slot", t3.sent().at(-1)?.message.split("\n")[0].includes(" · scope: add_slot"), true);
  await window.click('[data-request-action="withdraw"]');
  await window.waitForSelector('[data-request-phase="withdrawn"]', { timeout: PHASE_MS });

  // The thread lives in the top bar, with a fresh thread for a clean context.
  await window.click("[data-thread-chip]");
  await window.waitForSelector("[data-thread-menu]");
  await shots2(window, shots, "12-thread-menu");
  await window.click("[data-refresh-thread]");
  await window.waitForSelector("[data-thread-menu]", { state: "detached" });
  const fresh = t3.started();
  check("a fresh thread starts one T3 thread for the brainstorm, whose first message has the agent attach", [fresh.length, fresh[0]?.message.split("\n")[0]], [1, `[brainstorm] session ${session} · fresh thread for "Chore roulette"`]);
  check("and moves every branch to it", [context(session).attachedThread, context(branchId).attachedThread], [fresh[0]?.thread, fresh[0]?.thread]);

  check("the window logged no errors or warnings", errors, []);

  await app.close();
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1100, height: 720 });
  await openSession(window, session);
  await window.waitForSelector("[data-history-n]");
  check(
    "after a restart at 1100 the strip opens on the latest run, the confirm's, whole, with nothing cut at either end",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown];
    }),
    [["iteration 5"], [], true],
  );
  await shot(window, shots, "10-strip-restart-1100");
} finally {
  await app.close();
}
finish();
