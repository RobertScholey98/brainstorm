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
    "in the past Regenerate is off, Fork reads Fork iteration 1, and the badge reads Iteration 1 of 2",
    [await window.isDisabled("[data-regenerate-toggle]"), (await window.textContent("[data-fork-toggle]")).trim(), (await window.textContent("[data-iteration-past]")).trim()],
    [true, "Fork iteration 1", "Iteration 1 of 2"],
  );
  check("the past shows no pins", await canvas.$$eval(".bs-pin", (els) => els.length), 0);
  await canvas.click(inBlock("result/card", "chore"));
  await window.waitForSelector("[data-inspector-past]");
  check("the inspector says it is the past, and its controls are inert", (await window.$("[data-controls-readonly]")) !== null, true);
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
  check("the parent's strip hangs the fork off iteration 2", await window.$eval(`[data-history-fork="${forkId}"]`, (el) => el.closest("[data-history-list] > div").querySelector("[data-history-n]").dataset.historyN), "2");

  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector(`[data-overview-session="${forkId}"] [data-fork-of]`);
  check("home names the fork's parent and iteration", (await window.textContent(`[data-overview-session="${forkId}"] [data-fork-of]`)).replace(/\s+/g, " ").trim(), "Fork of Chore roulette · iteration 2");
  await shot(window, shots, "7-home-fork");

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
  await window.setViewportSize({ width: 1440, height: 900 });
  await window.click('[data-slot-id="wheel"] [data-variant="spin-button-a"]');
  await window.waitForSelector('[data-variant="spin-button-a"] [data-variant-new]', { state: "detached", timeout: PHASE_MS });
  check(
    "a new variant stops being new once it has been on the canvas a moment, and only that one",
    await settled(() => window.$$eval('[data-slot-id="wheel"] [data-variant-new]', (els) => els.map((e) => e.closest("[data-variant]").dataset.variant))),
    ["spin-button-b", "spin-button-c"],
  );

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
