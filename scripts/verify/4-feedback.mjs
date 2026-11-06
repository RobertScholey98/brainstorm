import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, showBoard, shot, workspace } from "./electron.mjs";

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
  const canvas = await openSession(window, session);
  await showBoard(window, canvas);
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
  check(
    "the composer is titled New comment and names the block, then the picked part, with Ctrl+Enter beside Cancel in its footer",
    await window.$eval("[data-composer]", (el) => [
      el.querySelector("h2")?.textContent,
      el.querySelector("[data-slot=popover-description]")?.textContent,
      [...el.querySelectorAll("[data-slot=popover-footer] kbd, [data-slot=popover-footer] button")].map((n) => n.textContent),
    ]),
    ["New comment", "Assignment card · headline", ["Ctrl+Enter", "Cancel", "Pin comment"]],
  );
  const frameAt = await window.$eval("iframe[title=Canvas]", (el) => el.getBoundingClientRect().toJSON());
  const part = await canvas.$eval(HEADLINE, (el) => el.getBoundingClientRect().toJSON());
  const pending = await window.$eval("[data-composer-pin]", (el) => el.getBoundingClientRect().toJSON());
  check(
    "the pin to be sits on the element's top right corner, where the saved pin will land",
    [Math.round(pending.x + pending.width / 2 - (frameAt.x + part.right)), Math.round(pending.y + pending.height / 2 - (frameAt.y + part.top))],
    [0, 0],
  );
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
  check(
    "the edit field keeps the card's fill, not the row's tint, with Ctrl+Enter beside Cancel",
    await window.$eval('[data-feedback="2"]', (li) => {
      const card = getComputedStyle(li.closest("aside")).backgroundColor;
      return [getComputedStyle(li.querySelector("textarea")).backgroundColor === card, [...li.querySelectorAll("kbd, button")].map((n) => n.textContent).slice(-3)];
    }),
    [true, ["Ctrl+Enter", "Cancel", "Save"]],
  );
  await window.keyboard.press("Control+A");
  await window.keyboard.type("Spin button needs more contrast");
  await window.click('[data-feedback="2"] button:has-text("Save")');
  await window.waitForFunction(() => document.querySelector('[data-feedback="2"] [data-feedback-text]')?.textContent === "Spin button needs more contrast");
  check("Edit rewrites an open comment", await itemText(window, 2, "text"), "Spin button needs more contrast");
  await window.click('[data-feedback="2"] [data-feedback-action="delete"]');
  await window.waitForSelector('[data-feedback="2"] [data-feedback-confirm]');
  check(
    "Delete asks first, in place, with Cancel focused",
    [(await window.innerText('[data-feedback="2"] [data-feedback-confirm]')).replace(/\s+/g, " "), await window.evaluate(() => document.activeElement?.hasAttribute("data-feedback-cancel"))],
    ["Delete it? Cancel Delete", true],
  );
  check(
    "The question, Cancel and Delete sit on one line in the Inspector, and the question isn't cut",
    await window.evaluate(() => {
      const tops = [...document.querySelectorAll('[data-feedback="2"] [data-feedback-confirm] > *')].map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2));
      const q = document.querySelector('[data-feedback="2"] [data-feedback-question]');
      return [new Set(tops).size, q.scrollWidth <= q.clientWidth];
    }),
    [1, true],
  );
  await window.keyboard.press("Enter");
  await window.waitForSelector('[data-feedback="2"] [data-feedback-confirm]', { state: "detached" });
  check(
    "Enter on the focused Cancel keeps the comment and puts focus back on Delete",
    [await itemText(window, 2, "text"), await window.evaluate(() => document.activeElement?.dataset.feedbackAction)],
    ["Spin button needs more contrast", "delete"],
  );
  await window.keyboard.press("Enter");
  await window.waitForSelector('[data-feedback="2"] [data-feedback-confirm]');
  await window.keyboard.press("Escape");
  await window.waitForSelector('[data-feedback="2"] [data-feedback-confirm]', { state: "detached" });
  check("Escape keeps it too", await window.$('[data-feedback="2"]') !== null, true);
  await window.click('[data-feedback="2"] [data-feedback-action="delete"]');
  await window.click('[data-feedback="2"] [data-feedback-delete]');
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
  const pinAt = () =>
    canvas.$eval(PIN, (el) => {
      const r = el.getBoundingClientRect();
      const body = el.closest(".bs-frame-body");
      return { hovered: el.matches(":hover"), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), sideways: body.scrollWidth > body.clientWidth };
    });
  const resting = await pinAt();
  const frameBox = await window.$eval("iframe[title=Canvas]", (el) => el.getBoundingClientRect().toJSON());
  await window.mouse.move(frameBox.x + resting.x, frameBox.y + resting.y);
  await canvas.waitForTimeout(300);
  check("a hovered pin grows where it is and stays under the pointer, and its frame never scrolls sideways", await pinAt(), { ...resting, hovered: true });
  check("the pin is coloured addressed", await canvas.getAttribute(PIN, "data-status"), "addressed");
  check(
    "the list shows it addressed in iteration 2, on a line of its own under where it is pinned",
    [await itemText(window, 1, "meta"), await itemText(window, 1, "status")],
    ["Assignment card · headline", "In iteration 2"],
  );
  await shot(window, shots, "4-addressed");

  await window.click('[data-feedback="1"] [data-feedback-text]');
  await canvas.waitForSelector(`${PIN}.bs-pulse`);
  check("clicking the comment in the list pulses its pin", await canvas.$eval(PIN, (el) => el.classList.contains("bs-pulse")), true);

  await canvas.click(PIN);
  await window.waitForSelector('[data-feedback="1"][data-focused]');
  check("clicking the pin focuses its comment in the list", await window.isVisible('[data-feedback="1"][data-focused]'), true);

  await window.click('[data-feedback="1"] button:has-text("Confirm")');
  await window.waitForSelector('[data-feedback="1"][data-status="confirmed"]');
  check(
    "Confirm moves it to confirmed",
    [await window.getAttribute('[data-feedback="1"]', "data-status"), await itemText(window, 1, "status")],
    ["confirmed", "Addressed in iteration 2"],
  );
  const handle = '[data-slot="resize-handle"][aria-label="Inspector width"]';
  await window.focus(handle);
  await window.keyboard.press("Home");
  check(
    "at its narrowest the Inspector never scrolls sideways, and the status line wraps instead of cutting",
    await window.$eval('aside[aria-label="Inspector"]', (aside) => {
      const status = aside.querySelector('[data-feedback="1"] [data-feedback-status]');
      return [aside.scrollWidth <= aside.clientWidth, status.scrollWidth <= status.clientWidth];
    }),
    [true, true],
  );
  await window.dblclick(handle);
  await canvas.waitForSelector(`${PIN}[data-status="confirmed"]`);
  check("the pin is coloured confirmed", await canvas.getAttribute(PIN, "data-status"), "confirmed");
  await shot(window, shots, "5-confirmed");

  await window.click('[data-feedback="1"] button:has-text("Reopen")');
  await window.waitForSelector('[data-feedback="1"][data-status="open"]');
  check("Reopen moves it back to open, remembering where it was addressed", await itemText(window, 1, "status"), "Previously addressed in iteration 2");

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
