import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, checks, inBlock, launch, openSession, outsideBox, pixels, settled, showBoard, shot, workspace } from "./electron.mjs";

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
    const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyFork !== undefined ? "fork" : "stub");
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
    const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyFork !== undefined ? "fork" : "stub");
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
      el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyFork !== undefined ? "fork" : el.dataset.forkStub !== undefined ? "stub" : "loading";
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
      el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyFork !== undefined ? "fork" : el.dataset.forkStub !== undefined ? "stub" : "loading";
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
 * "latest" in full, and whether a fork's tile is wider than its words, which would take room an entry's line needs.
 */
const pageRead = (window) =>
  window.evaluate(() => {
    const box = document.querySelector("[data-history-scroll]").getBoundingClientRect();
    const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : el.dataset.historyFork !== undefined ? "fork" : "stub");
    const inView = [...document.querySelectorAll("[data-history-list] > *:not([data-off])")].filter((el) => el.getBoundingClientRect().right > box.left + 1 && el.getBoundingClientRect().left < box.right - 1);
    const latest = inView.find((el) => el.querySelector("[data-history-latest]") !== null)?.querySelector("[data-history-latest]");
    const line = latest?.parentElement.getBoundingClientRect();
    const wide = inView.filter((el) => el.dataset.historyFork !== undefined).filter((el) => {
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
      wideFork: wide.length > 0,
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
/** The sidebar shows one slot at a time (ADR 009); its picker switches. */
async function showSlot(window, slot) {
  if ((await window.getAttribute("[data-slot-picker]", "data-slot-picker")) === slot) return;
  await window.click("[data-slot-picker]");
  await window.click(`[data-slot-option="${slot}"]`);
  await window.waitForSelector(`[data-slot-picker="${slot}"]`);
}
const rows = (window, group) => window.$$eval(`[${group}] [data-variant]`, (els) => els.map((e) => e.dataset.variant));
/** A row's marks show on hover, as T3 Code's row actions do. */
async function mark(window, kind, variant) {
  await window.hover(`[data-slot-id] [data-variant="${variant}"]`);
  await window.click(`[data-${kind}="${variant}"]`);
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

  // Marks in the past are the window's own, for a branch from there (ADR 009).
  check("with nothing marked, Confirm as a branch is still on, since a word on what to try can make a branch alone", await window.isDisabled("[data-confirm-toggle]"), false);
  await mark(window, "approve", "reel");
  await window.waitForSelector('[data-main-group] [data-variant="reel"]');
  check("a thumbs up in the past makes Reel the wheel's Main there, at the top, and the rest its options", [await rows(window, "data-main-group"), await rows(window, "data-options-group")], [["reel"], ["neon", "terminal"]]);
  await window.click("[data-confirm-toggle]");
  await window.waitForSelector("[data-confirm-menu]");
  check(
    "its popover is named for the branch and lists what the branch starts with",
    await window.$eval("[data-confirm-menu]", (el) => [
      el.querySelector("[data-slot=popover-title]").textContent.trim(),
      [...el.querySelectorAll("[data-confirm-slot]")].map((s) => s.dataset.confirmSlot),
      el.querySelector("[data-confirm-dropped]")?.dataset.confirmDropped ?? null,
      el.querySelector("[data-confirm-hint]").textContent.trim(),
    ]),
    ["Confirm as a branch", ["wheel"], "2", "Applies at once"],
  );
  await window.fill("[data-confirm-instruction]", "Try the reel for mornings");
  check("an instruction there goes to the agent instead", (await window.textContent("[data-confirm-hint]")).trim(), "Goes to the agent");
  await window.fill("[data-confirm-instruction]", "");
  check("nothing in the confirm popover runs past its box", await outsideBox(window, "[data-confirm-menu]"), []);
  await shot(window, shots, "3-confirm-past");
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
  check("Confirm is on once there is something to lock in", await window.isDisabled("[data-confirm-toggle]"), false);
  await shot(window, shots, "5-marks");
  await mark(window, "approve", "neon");
  await window.waitForSelector("[data-main-empty]");
  await window.click("[data-trashed-fold] button");
  await window.click('[data-restore="terminal"]');
  await window.waitForSelector("[data-trashed-fold]", { state: "detached" });
  check("a second thumbs up and Restore undo them", context(session).marks, { mains: {}, grafts: [], trashed: [] });

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
  check("keeping a Main needs no agent and no new thread", [t3.sent().length - sentBefore, t3.started()], [0, []]);
  const branched = context(branchId);
  check("the branch is on the brainstorm's own thread", branched.attachedThread, DEMO_THREAD);
  check("its first iteration numbers on from where it left, 2, with only Reel in the wheel and the unmarked result as it was", [branched.latest.n, [...branched.latest.blocks].sort()], [2, ["result/card", "result/receipt", "wheel/reel"]]);
  check("Rob's setting is baked in as a default", branched.fork.baked.map((b) => [b.blockId, b.prop, b.value]), [["result/card", "headline", "Fate has spoken"]]);
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
  check("its strip shows the branch's own run, which starts with the confirm that made it", [await window.getAttribute("[data-strip-run]", "data-strip-run"), (await strip(window)).map((e) => [e.n, e.origin])], ["Confirm 1", [[2, "Branched from iteration 1"]]]);
  await shot(window, shots, "6-branch");
  await window.click("[data-strip-run]");
  await window.click('[data-run-option="Start"]');
  await window.waitForSelector(`[data-history-fork="${session}"]`);
  check("its Start run is the first line's iteration 1, and the first line carries on from it as an offshoot", [(await strip(window)).map((e) => e.n), await window.$eval(`[data-history-fork="${session}"]`, (el) => el.previousElementSibling.dataset.historyN)], [[1], "1"]);

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
  await window.click(`[data-history-fork="${session}"]`);
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
      [["fork", "iteration 2"], [], 16, 1],
      [["iteration 1"], [], 16, 1],
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
    [["fork", "iteration 2", "iteration 3"], [], true, [16, 16], 2],
  );
  check("and both iterations in view read their age whole, and latest whole or not at all", await uncut(), [
    [2, "whole", "uncut"],
    [3, "whole", "uncut"],
  ]);
  const overflowLines = await settled(() =>
    window.$$eval("[data-history-list] > *:not([data-off])", (entries) => {
      const name = (el) => (el.dataset.historyN !== undefined ? `iteration ${el.dataset.historyN}` : "fork");
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
      `at ${width}, on every page of a forked and varied brainstorm's strip, each iteration's lines read whole, latest names itself in full, and the fork's tile takes no more than its words`,
      pages.filter((page) => page.cut.some((name) => name.startsWith("iteration")) || page.latest === false || page.wideFork),
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

  // Confirm at the latest: Main goes forward, the rest goes, and the strip starts a new run (ADR 009).
  await showSlot(window, "wheel");
  await mark(window, "approve", "neon");
  await window.waitForSelector('[data-main-group] [data-variant="neon"]');
  const sentBeforeConfirm = t3.sent().length;
  await window.click("[data-confirm-toggle]");
  await window.waitForSelector("[data-confirm-menu]");
  check("the confirm popover counts what goes, and applies at once", [await window.getAttribute("[data-confirm-dropped]", "data-confirm-dropped"), (await window.textContent("[data-confirm-hint]")).trim()], ["5", "Applies at once"]);
  await window.click("[data-confirm-send]");
  await window.waitForSelector('[data-canvas-iteration="4"]', { timeout: PHASE_MS });
  check("Confirm writes iteration 4 with only Main in the wheel, the unmarked result as it was, and no agent turn", [[...context(session).latest.blocks].sort(), t3.sent().length - sentBeforeConfirm], [["result/card", "result/receipt", "wheel/neon"], 0]);
  check("the marks are spent", context(session).marks, { mains: {}, grafts: [], trashed: [] });
  check("the strip opens a new run on the confirm, named for it", [await window.getAttribute("[data-strip-run]", "data-strip-run"), (await strip(window)).map((e) => [e.n, e.origin])], ["Confirm 1", [[4, "Confirmed · 5 options dropped"]]]);
  await window.click("[data-strip-run]");
  await window.waitForSelector("[data-run-option]");
  check("the run picker lists the runs newest first", await window.$$eval("[data-run-option]", (els) => els.map((e) => e.dataset.runOption)), ["Confirm 1", "Start"]);
  await shot(window, shots, "11-runs");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-run-option]", { state: "detached" });

  // The thread lives in the top bar, with a fresh thread for a clean context.
  await window.click("[data-thread-chip]");
  await window.waitForSelector("[data-thread-menu]");
  await shot(window, shots, "12-thread-menu");
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
    [["iteration 4"], [], true],
  );
  await shot(window, shots, "10-strip-restart-1100");
} finally {
  await app.close();
}
finish();
