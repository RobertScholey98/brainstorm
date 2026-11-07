import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fakeT3 } from "../../test/fake-t3/control.mjs";
import { brainstorm, DEMO_THREAD, seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, checks, inBlock, launch, openSession, outsideBox, settled, showBoard, shot, workspace } from "./electron.mjs";

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
    const inView = [...document.querySelectorAll("[data-history-list] > *")].filter((el) => el.getBoundingClientRect().right > box.left + 1 && el.getBoundingClientRect().left < box.right - 1);
    const [first, last] = [inView.at(0).getBoundingClientRect(), inView.at(-1).getBoundingClientRect()];
    return {
      inView: inView.map(name),
      cut: inView.filter((el) => el.getBoundingClientRect().left < box.left + 15.5 || el.getBoundingClientRect().right > box.right - 15.5).map(name),
      shown: inView.some((el) => el.getAttribute("aria-selected") === "true"),
      insets: [Math.round(first.left - box.left), Math.round(box.right - last.right)],
      scrolled: Math.round(scroller.scrollLeft),
      arrows: document.querySelectorAll("[data-history-step]").length,
    };
  });
const canvasAt = (window) =>
  window.$eval("[data-canvas-iteration]", (el) => ({ n: Number(el.dataset.canvasIteration), past: el.dataset.canvasPast === undefined ? null : Number(el.dataset.canvasPast) }));
const pool = (canvas) => canvas.textContent(inBlock("wheel/neon", "pool"));

let { app, window, errors } = await launch(home, env);
let session;
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  ({ session } = seedDemo(home, env));
  let canvas = await openSession(window, session);
  await showBoard(window, canvas);
  await canvas.waitForSelector(inBlock("wheel/neon", "pool"));
  await canvas.waitForSelector(inBlock("result/card", "card"));

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
  check("the history toggle starts pressed, with the strip open", [await window.getAttribute("[data-history-toggle]", "aria-pressed"), (await window.$("[data-history]")) !== null], ["true", true]);
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
    "two iterations fit at 1440, so the strip rests at its start with no arrows, every entry whole and 16 px off both ends",
    await settled(() => stripRest(window)),
    { inView: ["iteration 1", "iteration 2"], cut: [], shown: true, insets: [16, 16], scrolled: 0, arrows: 0 },
  );
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

  const latestWheel = await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant");
  await window.click('[data-history-n="1"]');
  await window.waitForSelector("[data-past-bar]");
  await canvas.waitForFunction((sel) => document.querySelector(sel)?.textContent?.includes("Odds lean"), inBlock("wheel/neon", "pool"));
  check("clicking a still shows that iteration, read-only", [await canvasAt(window), (await pool(canvas)).includes("Odds lean")], [{ n: 1, past: 1 }, true]);
  await window.waitForTimeout(400);
  check("under the Viewing bar the frame's label sits 24 px below the canvas's top, as on the latest", await labelOffset(canvas), 24);
  check(
    "under a bar naming it, with Back to latest",
    [(await window.textContent("[data-past-bar]")).startsWith("Viewing iteration 1"), (await window.textContent("[data-back-to-latest]")).trim()],
    [true, "Back to latest"],
  );
  check(
    "Back to latest ends where the canvas bar's view switch ends",
    await window.evaluate(() => {
      const right = (el) => Math.round(el.getBoundingClientRect().right);
      return right(document.querySelector("[data-back-to-latest]")) - right(document.querySelector('[data-canvas-bar] [data-slot="segmented"]'));
    }),
    0,
  );
  check(
    "in the past Regenerate is off, Fork reads Fork iteration 1, and the badge reads Iteration 1 of 2",
    [await window.isDisabled("[data-regenerate-toggle]"), (await window.textContent("[data-fork-toggle]")).trim(), (await window.textContent("[data-iteration-past]")).trim()],
    [true, "Fork iteration 1", "Iteration 1 of 2"],
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
  await window.click('[data-slot-id="wheel"] [data-variant="reel"]');
  await canvas.waitForSelector(".bs-frame[data-slot=wheel] div[data-bid='wheel/reel']", { state: "attached" });
  check("the past shows the variant picked there", await window.getAttribute('[data-slot-id="wheel"] [data-showing]', "data-variant"), "reel");

  await window.click('[data-fork-toggle]');
  await window.waitForSelector("[data-fork-menu]");
  check(
    "forking from the past carries the variants picked there",
    await window.$$eval("[data-fork-menu] [data-carry-slot]", (els) => els.map((e) => [e.dataset.carrySlot, e.querySelector("dd span").textContent.trim()])),
    [
      ["wheel", "Slot reel"],
      ["result", "Assignment card"],
    ],
  );
  const carriesEdge = () =>
    window.$eval("[data-fork-menu] [data-fork-carries] dl", (box) => {
      const probe = document.body.appendChild(document.createElement("div"));
      probe.style.color = "var(--border-strong)";
      const strong = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(box).borderTopColor === strong ? "border-strong" : getComputedStyle(box).borderTopColor;
    });
  const edges = [await carriesEdge()];
  await window.emulateMedia({ colorScheme: "dark" });
  edges.push(await settled(carriesEdge));
  await window.emulateMedia({ colorScheme: "light" });
  check("the carries-over box keeps the strong edge in both themes, so it holds its shape on the popover in dark", edges, ["border-strong", "border-strong"]);
  await shot(window, shots, "3-fork-past");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-fork-menu]", { state: "detached" });
  check("Escape closes the Fork popover and stays in the past", (await canvasAt(window)).past, 1);

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
  await window.click('[data-history-n="1"]');
  await window.click("[data-back-to-latest]");
  await window.waitForSelector("[data-past-bar]", { state: "detached" });
  check("Back to latest does too, with the pins back", await canvas.$$eval(".bs-pin", (els) => els.length), 1);

  // The toggle persists across a restart.
  await window.click("[data-history-toggle]");
  await window.waitForSelector("[data-history]", { state: "detached" });
  await window.waitForTimeout(400);
  check("once the strip folds the frame's label still sits 24 px below the canvas's top", await labelOffset(canvas), 24);
  const prefs = await window.evaluate(async () => (await fetch("/v1/ui/prefs").then((r) => r.json()).catch(() => null)));
  void prefs;
  await app.close();
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1440, height: 900 });
  canvas = await openSession(window, session);
  await canvas.waitForSelector(inBlock("wheel/neon", "pool"), { state: "attached" });
  check("after a restart the strip stays closed, as Rob left it", [await window.getAttribute("[data-history-toggle]", "aria-pressed"), (await window.$("[data-history]")) !== null], ["false", false]);
  await shot(window, shots, "4-strip-closed");
  await window.click("[data-history-toggle]");
  await window.waitForSelector("[data-history]");

  // Fork from the latest iteration.
  await window.click('[data-slot-id="wheel"] [data-variant="neon"]');
  await window.waitForFunction(() => document.querySelector('[data-slot-id="wheel"] [data-variant="neon"]')?.getAttribute("aria-checked") === "true");
  await window.click("[data-fork-toggle]");
  await window.waitForSelector("[data-fork-menu]");
  check("from the latest the button reads Fork", (await window.textContent("[data-fork-toggle]")).trim(), "Fork");
  check(
    "the fork popover's labels take the one overlay label, 12 px medium in the description's muted tone, and its footer marks the new thread with Fork's own glyph, not a link's",
    await window.$eval("[data-fork-menu]", (el) => {
      const muted = getComputedStyle(el.querySelector("[data-slot=popover-description]")).color;
      return {
        labels: [...el.querySelectorAll("[data-slot=field-label]")].map((l) => [l.textContent.trim(), getComputedStyle(l).fontSize, getComputedStyle(l).fontWeight, getComputedStyle(l).color === muted]),
        glyph: el.querySelector("[data-fork-hint] svg").getAttribute("class"),
      };
    }),
    { labels: [["Instruction", "12px", "500", true], ["Carries over", "12px", "500", true]], glyph: "lucide lucide-git-branch size-3.5" },
  );
  check(
    "the popover lists what carries over: a variant per slot, one setting, one open pin",
    await window.$eval("[data-fork-menu]", (el) => ({
      slots: [...el.querySelectorAll("[data-carry-slot]")].map((e) => e.dataset.carrySlot),
      settings: Number(el.querySelector("[data-carry-settings]").dataset.carrySettings),
      pins: Number(el.querySelector("[data-carry-pins]").dataset.carryPins),
      send: el.querySelector("[data-fork-send]").disabled,
      hint: el.querySelector("[data-fork-hint]").textContent.trim(),
    })),
    { slots: ["wheel", "result"], settings: 1, pins: 1, send: true, hint: "Say what the fork should try" },
  );
  await window.fill("[data-fork-instruction]", "Try a calmer wheel for mornings");
  check("an instruction turns Send on and the hint to the new thread", [await window.isDisabled("[data-fork-send]"), (await window.textContent("[data-fork-hint]")).trim()], [false, "Starts a new T3 thread"]);
  await shot(window, shots, "5-fork-latest");
  await window.click("[data-fork-send]");
  await window.waitForSelector("[data-lineage]");
  await window.waitForSelector('[data-thread]:not([data-thread="starting"])', { timeout: PHASE_MS });

  const started = t3.started();
  check("Send runs one thread start in the parent's project", started.map((s) => s.project), ["chore-roulette"]);
  // The fork's id as its message names it; the parent's offshoot below has to link to the same one.
  const forkId = started[0]?.message.match(/session (s_[a-z0-9]+)/)?.[1];
  check("the window opened the fork, whose sidebar links back to the parent", await window.getAttribute("[data-forked-from]", "data-forked-from"), session);
  check(
    "a long parent title gives way on that line, and the iteration it forked from reads whole",
    await window.$eval("[data-forked-line] > span:last-child", (el) => [el.textContent, el.scrollWidth <= el.clientWidth]),
    ["· iteration 2", true],
  );
  check(
    "the fork line's glyph sits on the Thread row's mark column, and its text on the Thread title's edge",
    await window.evaluate(() => {
      const centre = (el) => {
        const r = el.getBoundingClientRect();
        return r.left + r.width / 2;
      };
      const dot = document.querySelector("[data-thread-link] span.size-1\\.5");
      const glyph = document.querySelector("[data-forked-from] svg");
      const title = document.querySelector("[data-thread-link] [data-slot='truncate'], [data-thread-link] [data-thread]");
      const line = document.querySelector("[data-forked-line]");
      return [Math.round(centre(glyph) - centre(dot)), Math.round(line.getBoundingClientRect().left - title.getBoundingClientRect().left)];
    }),
    [0, 0],
  );
  check(
    "its first message is the [brainstorm] marker for the fork's request 1, telling the new thread to attach",
    started[0]?.message.split("\n").slice(0, 2),
    [
      `[brainstorm] session ${forkId} · request 1 · fork of ${session} iteration 2 · scope: all · feedback: #1 · freetext: "Try a calmer wheel for mornings"`,
      `Handle with the ux-brainstorm skill: this thread is new, so run \`brainstorm session attach ${forkId}\`, then \`brainstorm context ${forkId}\`.`,
    ],
  );
  const forked = context(forkId);
  check("the fork is attached to the thread thread start made", forked.attachedThread, started[0]?.thread);
  check(
    "its iteration 1 narrows each slot to the variant that was showing",
    [...forked.latest.blocks].sort(),
    ["result/card", "wheel/neon"],
  );
  check("Rob's setting is baked in as a default", forked.fork.baked.map((b) => [b.blockId, b.prop, b.value]), [["result/card", "headline", "Fate has spoken"]]);
  const forkCopy = join(home, "fork-copy");
  must("pull fork", brainstorm(env, ["pull", forkId, "--out", forkCopy, "--json"]));
  check(
    "in the block itself, with one variant folder per slot",
    [
      JSON.parse(readFileSync(join(forkCopy, "slots", "result", "card", "block.json"), "utf8")).props.appearance.headline.default,
      readdirSync(join(forkCopy, "slots", "wheel")),
    ],
    ["Fate has spoken", ["neon"]],
  );
  check("the open pin carries over", forked.feedback.open.map((f) => [f.text, f.pin.blockId]), [["Make the headline louder", "result/card"]]);
  check("and the fork's request 1 is open, sent to its new thread", [forked.request?.n, forked.request?.scope], [1, { kind: "all" }]);

  check(
    "the fork's breadcrumb shows its lineage",
    (await window.textContent("[data-lineage]")).replace(/\s+/g, " ").trim().includes("Chore roulette"),
    true,
  );
  check("its strip starts with a stub back to the parent", await window.getAttribute("[data-fork-stub]", "data-fork-stub"), session);
  check("and its first still says where it came from", (await strip(window)).map((s) => s.origin), ["Your picks from iteration 2"]);
  check("its strip, stub and all, is the same 84 px", await stripHeight(window), 84);
  await shot(window, shots, "6-fork-page");

  // The parent's view is held back a moment, so the loading strip can be measured before it lands.
  await app.context().route(`**/v1/ui/sessions/${session}`, async (route) => {
    if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await window.click("[data-fork-stub]");
  await window.waitForSelector("[data-history-loading]");
  check("while the parent loads, the strip's place is held at the same 84 px", await window.$eval("[data-history-loading]", (el) => Math.round(el.getBoundingClientRect().height)), 84);
  await window.waitForSelector(`[data-history-fork="${forkId}"]`);
  await app.context().unroute(`**/v1/ui/sessions/${session}`);
  check("and with a fork hanging off a still it is still 84 px", await stripHeight(window), 84);
  check(
    "the parent's strip hangs the fork off iteration 2, the entry after its still, saying where it came from",
    await window.$eval(`[data-history-fork="${forkId}"]`, (el) => [el.previousElementSibling.dataset.historyN, el.dataset.historyFrom, [...el.querySelectorAll(".grid > *")].map((line) => line.textContent.trim())]),
    ["2", "2", ["Try a calmer wheel for mornings", "Fork of iteration 2"]],
  );
  check(
    "two iterations and a fork still fit at 1440: the strip rests at its start, nothing cut",
    await settled(() => stripRest(window)),
    { inView: ["iteration 1", "iteration 2", "fork"], cut: [], shown: true, insets: [16, 16], scrolled: 0, arrows: 0 },
  );

  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector(`[data-overview-session="${forkId}"] [data-fork-of]`);
  check("home names the fork's parent and iteration", (await window.textContent(`[data-overview-session="${forkId}"] [data-fork-of]`)).replace(/\s+/g, " ").trim(), "Fork of Chore roulette · iteration 2");
  await shot(window, shots, "7-home-fork");
  /** A sidebar row's title keeps 112 px or reads whole, and whether its status has fallen to the dot and the time. */
  const rowFit = (id) =>
    settled(() =>
      window.$eval(`[data-session="${id}"]`, (row) => {
        const title = row.querySelector("[data-row-title]");
        return {
          title: title.clientWidth >= Math.min(title.scrollWidth, 112),
          short: row.querySelector("[data-collapse]").hasAttribute("data-collapsed"),
          time: /^\d+[smh]$/.test(row.querySelector("[data-status-elapsed]").textContent.trim()),
        };
      }),
    );
  check("at 1440 the live fork row keeps its title's 112 px with its status whole", await rowFit(forkId), { title: true, short: false, time: true });
  await window.setViewportSize({ width: 1100, height: 720 });
  check("at 1100 the status falls to the dot and the time, so the title keeps its 112 px", await rowFit(forkId), { title: true, short: true, time: true });
  await window.setViewportSize({ width: 1440, height: 900 });

  // Vary, back in the parent.
  canvas = await openSession(window, session);
  await canvas.waitForSelector(inBlock("wheel/neon", "spin-button"));
  await window.click("[data-vary-toggle]");
  await window.waitForSelector("[data-pick-hint]");
  check("Vary element starts a pick, with its own hint", (await window.textContent("[data-pick-hint] span")).trim(), "Click an element to vary");
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
    "at 1100 the overflowing strip shows two whole entries, the latest among them, 16 px off both ends, with its arrows",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown, rest.insets, rest.arrows];
    }),
    [["fork", "iteration 3"], [], true, [16, 16], 2],
  );
  check("the later arrow is off at the end, the earlier one on", [await window.isDisabled('[data-history-step="end"]'), await window.isDisabled('[data-history-step="start"]')], [true, false]);
  await window.click('[data-history-step="start"]');
  check(
    "the earlier arrow steps back one entry and rests on an edge, nothing cut",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.insets];
    }),
    [["iteration 2", "fork"], [], [16, 16]],
  );
  await window.focus('[data-history-n="3"]');
  await window.keyboard.press("End");
  check(
    "End on the strip brings the latest back whole",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown];
    }),
    [["fork", "iteration 3"], [], true],
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  check(
    "at 1440 the strip shows three whole entries, the latest last",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown, rest.insets, rest.arrows];
    }),
    [["iteration 2", "fork", "iteration 3"], [], true, [16, 16], 2],
  );
  await window.click('[data-slot-id="wheel"] [data-variant="spin-button-a"]');
  await window.waitForSelector('[data-variant="spin-button-a"] [data-variant-new]', { state: "detached", timeout: PHASE_MS });
  check(
    "a new variant stops being new once it has been on the canvas a moment, and only that one",
    await settled(() => window.$$eval('[data-slot-id="wheel"] [data-variant-new]', (els) => els.map((e) => e.closest("[data-variant]").dataset.variant))),
    ["spin-button-b", "spin-button-c"],
  );

  check("the window logged no errors or warnings", errors, []);

  await app.close();
  ({ app, window, errors } = await launch(home, env));
  await window.setViewportSize({ width: 1100, height: 720 });
  await openSession(window, session);
  await window.waitForSelector("[data-history-n]");
  check(
    "after a restart at 1100 the strip opens on the latest, whole, with nothing cut at either end",
    await settled(async () => {
      const rest = await stripRest(window);
      return [rest.inView, rest.cut, rest.shown];
    }),
    [["fork", "iteration 3"], [], true],
  );
  await shot(window, shots, "10-strip-restart-1100");
} finally {
  await app.close();
}
finish();
