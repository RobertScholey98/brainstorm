// Proves v0.1 item 4 on the real Electron app: clicking an element with data-part pins a comment to it, the pin follows
// the element through a regenerate that moves it, and the comment moves through open, addressed, confirmed and back
// to open. A regenerate that drops the part detaches the pin and warns the agent.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, checks, inBlock, launch, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-4");
const { check, finish } = checks();

const HEADLINE = inBlock("result/card", "headline");
const PIN = '.bs-pin[data-pin="1"]';

const boxes = (canvas) =>
  canvas.evaluate(
    ([pin, part]) => {
      const box = (selector) => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r === undefined ? null : { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return { pin: box(pin), part: box(part) };
    },
    [`${PIN}[data-placed]`, HEADLINE],
  );
const overlaps = ({ pin, part }) =>
  pin !== null && part !== null && pin.x < part.x + part.width && part.x < pin.x + pin.width && pin.y < part.y + part.height && part.y < pin.y + pin.height;
const itemText = async (window, id, part) => (await window.textContent(`[data-feedback="${id}"] [data-feedback-${part}]`))?.replace(/\s+/g, " ").trim();

const { app, window, errors } = await launch(home, env);
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  const { session, work } = seedDemo(home, env);
  const canvas = await canvasFrame(window);
  await canvas.waitForSelector(HEADLINE);

  await window.click("[data-pick-toggle]");
  await window.waitForSelector("[data-pick-hint]");
  await canvas.hover(HEADLINE);
  await canvas.waitForSelector(".bs-pick[data-on]");
  check("hovering in pin mode highlights the nearest data-part", await canvas.textContent(".bs-pick[data-on] span"), "headline");
  const highlight = await canvas.evaluate((sel) => {
    const a = document.querySelector(".bs-pick").getBoundingClientRect();
    const b = document.querySelector(sel).getBoundingClientRect();
    return [a.x, a.y, a.width, a.height].map(Math.round).join() === [b.x, b.y, b.width, b.height].map(Math.round).join();
  }, HEADLINE);
  check("the highlight covers the element", highlight, true);
  await shot(window, shots, "1-picking");

  await canvas.click(HEADLINE);
  await window.waitForSelector("[data-composer]");
  check("the composer names the picked part and block", (await window.textContent("[data-composer] p"))?.trim(), "headline in Assignment card");
  await window.keyboard.type("Make the headline louder");
  await shot(window, shots, "2-composer");
  await window.click('[data-composer] button:has-text("Pin comment")');
  await window.waitForSelector('[data-feedback="1"][data-status="open"]');
  await canvas.waitForSelector(`${PIN}[data-placed]`);
  const before = await boxes(canvas);
  check("the pin sits on the headline", overlaps(before), true);
  check("the pin is coloured open", await canvas.getAttribute(PIN, "data-status"), "open");
  check("the card's own buttons were not pressed by the pick", await canvas.textContent(inBlock("result/card", "accept-button")), "Accept");
  const context = brainstorm(env, ["context", session, "--json"]).json.data;
  check(
    "the agent's context lists the open feedback with its pin",
    context.feedback.open.map((f) => ({ id: f.id, pin: f.pin, text: f.text })),
    [{ id: 1, pin: { blockId: "result/card", part: "headline" }, text: "Make the headline louder" }],
  );
  await shot(window, shots, "3-pinned");

  await window.click("[data-pick-toggle]");
  await canvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-composer]");
  await window.keyboard.type("Spin button is too quiet");
  await window.keyboard.press("Control+Enter");
  await window.waitForSelector('[data-feedback="2"]');
  await window.click('[data-feedback="2"] button:has-text("Edit")');
  await window.keyboard.press("Control+A");
  await window.keyboard.type("Spin button needs more contrast");
  await window.click('[data-feedback="2"] button:has-text("Save")');
  await window.waitForFunction(() => document.querySelector('[data-feedback="2"] [data-feedback-text]')?.textContent === "Spin button needs more contrast");
  check("Edit rewrites an open comment", await itemText(window, 2, "text"), "Spin button needs more contrast");
  await window.click('[data-feedback="2"] button:has-text("Delete")');
  await window.waitForSelector('[data-feedback="2"]', { state: "detached" });
  check("Delete removes it from the list and the canvas", await canvas.$('.bs-pin[data-pin="2"]'), null);

  const card = join(work, "slots", "result", "card", "block.tsx");
  const original = readFileSync(card, "utf8");
  const headlineJsx = '        <p className="headline" data-part="headline">\n          {headline}\n        </p>\n';
  const choreEnd = "          {chore.name}\n        </p>\n";
  if (!original.includes(headlineJsx) || !original.includes(choreEnd)) throw new Error("the card block no longer has the expected headline markup");
  writeFileSync(card, original.replace(headlineJsx, "").replace(choreEnd, choreEnd + headlineJsx));
  const moved = brainstorm(env, ["commit", session, "--from", work, "--addresses", "1", "--note", "Move the headline under the chore", "--json"]);
  check("the agent commits a card with the headline moved", [moved.code, moved.json?.data?.iteration?.changed], [0, ["result/card"]]);
  await window.waitForSelector('[data-feedback="1"][data-status="addressed"]');
  await canvas.waitForFunction(
    ([sel, y]) => Math.abs(document.querySelector(sel).getBoundingClientRect().y - y) > 40,
    [HEADLINE, before.part.y],
  );
  await canvas.waitForFunction(([pin, y]) => Math.abs(document.querySelector(pin).getBoundingClientRect().y - y) > 40, [PIN, before.pin.y]);
  const after = await boxes(canvas);
  check("the headline moved down the card", after.part.y - before.part.y > 40, true);
  check("the pin followed it to its new position", overlaps(after), true);
  check("the pin is coloured addressed", await canvas.getAttribute(PIN, "data-status"), "addressed");
  check("the list shows it addressed in iteration 2", await itemText(window, 1, "meta"), "Assignment card · headline · Addressed in 2");
  await shot(window, shots, "4-addressed");

  await window.click('[data-feedback="1"] [data-feedback-text]');
  await canvas.waitForSelector(`${PIN}.bs-pulse`);
  check("clicking the comment in the list pulses its pin", await canvas.$eval(PIN, (el) => el.classList.contains("bs-pulse")), true);

  await canvas.click(PIN);
  await window.waitForSelector('[data-feedback="1"][data-focused]');
  check("clicking the pin focuses its comment in the list", await window.isVisible('[data-feedback="1"][data-focused]'), true);

  await window.click('[data-feedback="1"] button:has-text("Confirm")');
  await window.waitForSelector('[data-feedback="1"][data-status="confirmed"]');
  check("Confirm moves it to confirmed", await itemText(window, 1, "meta"), "Assignment card · headline · Confirmed · addressed in 2");
  await canvas.waitForSelector(`${PIN}[data-status="confirmed"]`);
  check("the pin is coloured confirmed", await canvas.getAttribute(PIN, "data-status"), "confirmed");
  await shot(window, shots, "5-confirmed");

  await window.click('[data-feedback="1"] button:has-text("Reopen")');
  await window.waitForSelector('[data-feedback="1"][data-status="open"]');
  check("Reopen moves it back to open, remembering where it was addressed", await itemText(window, 1, "meta"), "Assignment card · headline · Previously addressed in 2");

  const reordered = readFileSync(card, "utf8");
  writeFileSync(card, reordered.replace('className="headline" data-part="headline"', 'className="headline"'));
  const dropped = brainstorm(env, ["commit", session, "--from", work, "--note", "Fold the headline into the card"]);
  check(
    "the agent's commit that drops the part warns pin_lost",
    [dropped.code, dropped.stdout.split("\n").filter((l) => l.includes("pin_lost"))],
    [0, ['slots/result/card/block.tsx: warning pin_lost: feedback #1 ("Make the headline louder") is pinned to data-part "headline" in result/card, which this commit no longer renders']],
  );
  await window.waitForSelector('[data-feedback="1"][data-place="detached"]');
  check("the list shows the comment detached", await itemText(window, 1, "place"), "Detached: its element is gone");
  check("the canvas no longer shows the pin", await canvas.$eval(PIN, (el) => el.hasAttribute("data-placed") || getComputedStyle(el).display !== "none"), false);
  await shot(window, shots, "6-detached");

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
