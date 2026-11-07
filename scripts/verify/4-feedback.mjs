import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, outsideBox, settled, showBoard, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-4");
const { check, finish } = checks();

const HEADLINE = inBlock("result/card", "headline");
const PIN = '.bs-pin[data-pin="1"]';

const boxes = (canvas) =>
  canvas.evaluate(
    ([pin, part]) => {
      // Where each sits in its frame's content, so a pin scrolled into view doesn't read as the element moving.
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        let [x, y] = [r.x, r.y];
        for (let p = el.parentElement; p !== null; p = p.parentElement) [x, y] = [x + p.scrollLeft, y + p.scrollTop];
        return { x, y, width: r.width, height: r.height };
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

  const toggleBox = () => settled(() => window.$eval("[data-pick-toggle]", (b) => [Math.round(b.getBoundingClientRect().left), Math.round(b.getBoundingClientRect().width)]));
  const idleBox = await toggleBox();
  await window.click("[data-pick-toggle]");
  await window.waitForSelector("[data-pick-hint]");
  check("Pin comment keeps its width and its left edge while it reads Picking…", await toggleBox(), idleBox);
  await canvas.hover(HEADLINE);
  await canvas.waitForSelector(".bs-pick[data-on]");
  check("hovering in pin mode highlights the nearest data-part, named in words as the feedback list names it", await canvas.textContent(".bs-pick[data-on] span"), "Headline");
  const highlight = await canvas.evaluate((sel) => {
    const a = document.querySelector(".bs-pick").getBoundingClientRect();
    const b = document.querySelector(sel).getBoundingClientRect();
    return [[a.x, a.y, a.width, a.height].map(Math.round), [b.x, b.y, b.width, b.height].map(Math.round)];
  }, HEADLINE);
  check("the highlight covers the element", highlight[0], highlight[1]);
  await shot(window, shots, "1-picking");

  await canvas.click(HEADLINE);
  await window.waitForSelector("[data-composer]");
  check(
    "the composer is titled New comment and names the block, then the picked part, with Ctrl+Enter on Pin comment in its footer",
    await window.$eval("[data-composer]", (el) => [
      el.querySelector("h2")?.textContent,
      el.querySelector("[data-slot=popover-description]")?.textContent,
      [...el.querySelectorAll("[data-slot=popover-footer] kbd, [data-slot=popover-footer] button")].map((n) => n.textContent),
    ]),
    ["New comment", "Assignment card · Headline", ["Cancel", "Ctrl+Enter", "Pin comment"]],
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
  check("nothing in the composer runs past its box", await outsideBox(window, "[data-composer]"), []);
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
  const stageAt = () => canvas.evaluate(() => [Math.round(scrollY), Math.round(document.querySelector(".bs-frame[data-slot=wheel] .bs-frame-title").getBoundingClientRect().top)]);
  await canvas.evaluate(() => scrollTo(0, 0));
  await window.click('[data-feedback="2"] [data-feedback-text]');
  await canvas.waitForSelector('.bs-pin[data-pin="2"].bs-pulse');
  check("pulsing a pin already in view near a tall frame's foot moves nothing, so its label stays 24 px under the bar", await settled(stageAt), [0, 24]);
  await window.setViewportSize({ width: 1440, height: 640 });
  await canvas.evaluate(() => scrollTo(0, 0));
  await window.click('[data-feedback="2"] [data-feedback-text]');
  check(
    "pulsing it from below the fold brings it in, and takes the label wholly out of view rather than half under the bar",
    await settled(async () => {
      const [scrolled, label] = await stageAt();
      const pin = await canvas.$eval('.bs-pin[data-pin="2"]', (el) => [el.getBoundingClientRect().top >= 0, el.getBoundingClientRect().bottom <= innerHeight]);
      return [scrolled > 0, label <= -16, pin];
    }),
    [true, true, [true, true]],
  );
  await window.setViewportSize({ width: 1440, height: 900 });
  await canvas.evaluate(() => scrollTo(0, 0));
  await window.click('[data-slot-id="wheel"] [data-variant="reel"]');
  await window.waitForSelector('[data-feedback="2"][data-place="hidden"]');
  check(
    "a comment on a variant that isn't showing says so in the muted text with an eye-off glyph, not the amber of a lost pin",
    await window.$eval('[data-feedback="2"] [data-feedback-place]', (p) => {
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style.color = "var(--fg-muted)";
      const muted = getComputedStyle(probe).color;
      probe.remove();
      return [p.textContent.trim(), getComputedStyle(p).color === muted, p.querySelector("svg.lucide-eye-off") !== null];
    }),
    ["On a variant that isn't showing", true, true],
  );
  await window.click('[data-slot-id="wheel"] [data-variant="neon"]');
  await window.waitForSelector('[data-feedback="2"][data-place="placed"]');
  check(
    "an open comment's Edit and Delete stand 8 px apart, the gap of every row of buttons",
    await window.$eval('[data-feedback="2"]', (li) => {
      const [edit, del] = ['[data-feedback-action="edit"]', '[data-feedback-action="delete"]'].map((s) => li.querySelector(s).getBoundingClientRect());
      return Math.round(del.left - edit.right);
    }),
    8,
  );
  const deleteAt = await window.$eval('[data-feedback="2"] [data-feedback-action="delete"]', (b) => Math.round(b.getBoundingClientRect().left));
  await window.click('[data-feedback="2"] button:has-text("Edit")');
  check(
    "while editing, the pin's disc centres on the field's first line, as it does on the comment's at rest",
    await window.$eval('[data-feedback="2"]', (li) => {
      const disc = li.querySelector("[data-pin-number]").getBoundingClientRect();
      const area = li.querySelector("textarea");
      const style = getComputedStyle(area);
      const line = area.getBoundingClientRect().top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2;
      return Math.abs(disc.top + disc.height / 2 - line) <= 1;
    }),
    true,
  );
  check(
    "the edit field keeps the card's fill, not the row's tint, with Ctrl+Enter on Save, the field and Save 8 px off the fill's right edge",
    await window.$eval('[data-feedback="2"]', (li) => {
      const card = getComputedStyle(li.closest("aside")).backgroundColor;
      const right = li.getBoundingClientRect().right;
      const save = [...li.querySelectorAll("button")].find((n) => n.textContent === "Save");
      return [
        getComputedStyle(li.querySelector("textarea")).backgroundColor === card,
        [...li.querySelectorAll("kbd, button")].map((n) => n.textContent).slice(-3),
        [li.querySelector("textarea"), save].map((el) => Math.round(right - el.getBoundingClientRect().right)),
      ];
    }),
    [true, ["Cancel", "Ctrl+Enter", "Save"], [8, 8]],
  );
  await window.keyboard.press("Control+A");
  await window.keyboard.type("Spin button needs more contrast");
  await window.click('[data-feedback="2"] button:has-text("Save")');
  await window.waitForFunction(() => document.querySelector('[data-feedback="2"] [data-feedback-text]')?.textContent === "Spin button needs more contrast");
  check("Edit rewrites an open comment", await itemText(window, 2, "text"), "Spin button needs more contrast");
  await window.click('[data-feedback="2"] [data-feedback-action="delete"]');
  await window.waitForSelector('[data-feedback="2"] [data-feedback-confirm]');
  check(
    "Delete asks first, in place, the question in the meta line above its answers, with Cancel focused and ghost",
    [
      await window.$$eval('[data-feedback="2"] [data-feedback-question], [data-feedback="2"] [data-feedback-confirm] button', (els) => els.map((el) => el.textContent.trim())),
      await window.evaluate(() => document.activeElement?.hasAttribute("data-feedback-cancel")),
      await window.$eval('[data-feedback="2"] [data-feedback-cancel]', (b) => getComputedStyle(b).backgroundColor),
    ],
    [["Delete this comment?", "Cancel", "Delete"], true, "rgba(0, 0, 0, 0)"],
  );
  check(
    "asking leaves Delete where it was, under the pointer that pressed it",
    await window.$eval('[data-feedback="2"] [data-feedback-delete]', (b) => Math.round(b.getBoundingClientRect().left)),
    deleteAt,
  );
  check(
    "Cancel and Delete sit on one line under the question, and the question isn't cut",
    await window.evaluate(() => {
      const tops = [...document.querySelectorAll('[data-feedback="2"] [data-feedback-confirm] > *')].map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2));
      const q = document.querySelector('[data-feedback="2"] [data-feedback-question]');
      const cancel = document.querySelector('[data-feedback="2"] [data-feedback-cancel]');
      return [new Set(tops).size, q.scrollWidth <= q.clientWidth, q.getBoundingClientRect().bottom <= cancel.getBoundingClientRect().top];
    }),
    [1, true, true],
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
  const commentFill = () =>
    settled(() =>
      window.$eval('[data-feedback="1"]', (li) => {
        // The tint a comment takes under the pointer, read off a copy of the comment held in that state.
        const probe = li.parentElement.appendChild(document.createElement("li"));
        probe.className = li.className;
        probe.dataset.echoed = "";
        const hover = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return getComputedStyle(li).backgroundColor === hover ? "hover tint" : getComputedStyle(li).backgroundColor;
      }),
    );
  check("the hovered pin's comment takes the tint a pointer on it would give", await commentFill(), "hover tint");
  await window.mouse.move(frameBox.x + resting.x - 120, frameBox.y + resting.y);
  check("and drops it once the pointer leaves the pin", await commentFill(), "rgba(0, 0, 0, 0)");
  check("the pin is coloured addressed", await canvas.getAttribute(PIN, "data-status"), "addressed");
  check(
    "the list shows it addressed in iteration 2, on a line of its own under where it is pinned",
    [await itemText(window, 1, "meta"), await itemText(window, 1, "status")],
    ["Assignment card · Headline", "In iteration 2"],
  );
  await shot(window, shots, "4-addressed");

  await window.click('[data-feedback="1"] [data-feedback-text]');
  await canvas.waitForSelector(`${PIN}.bs-pulse`);
  check("clicking the comment in the list pulses its pin", await canvas.$eval(PIN, (el) => el.classList.contains("bs-pulse")), true);

  await canvas.click(PIN);
  await window.waitForSelector('[data-feedback="1"][data-focused]');
  check("clicking the pin focuses its comment in the list", await window.isVisible('[data-feedback="1"][data-focused]'), true);
  check(
    "a focused pin rings its card border in the accent, 2 px, with no band of card between",
    await canvas.$eval(`${PIN}[data-focused]`, (pin) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--bs-accent)" }));
      const accent = getComputedStyle(probe).color;
      probe.remove();
      // A ring is a shadow with no offset and no blur: its colour, then 0px 0px 0px and its spread.
      return [...getComputedStyle(pin).boxShadow.matchAll(/(rgba?\([^)]*\)) 0px 0px 0px (\d+)px/g)].map(([, colour, spread]) => [colour === accent, spread]);
    }),
    [[true, "2"]],
  );
  // The thumb stands 2 px in from the 10 px bar's far edge, so it starts 8 px in from the pane's edge.
  const fillAir = () =>
    settled(() =>
      window.$eval('[data-feedback="1"][data-focused]', (li) => {
        const pane = li.closest("aside");
        const body = li.closest("[data-inspector-body]");
        const aside = pane.getBoundingClientRect();
        const r = li.getBoundingClientRect();
        const scrolls = body.scrollHeight > body.clientHeight;
        return { scrolls, air: [Math.round(r.left - aside.left - pane.clientLeft), Math.round(aside.right - (scrolls ? 8 : 0) - r.right)] };
      }),
    );
  check("the focused comment's fill stands 12 px clear of the Inspector's edge on both sides", await fillAir(), { scrolls: false, air: [12, 12] });
  await window.setViewportSize({ width: 1440, height: 560 });
  check("and 12 px clear of the scrollbar's thumb once the Inspector scrolls", await fillAir(), { scrolls: true, air: [12, 12] });
  await window.setViewportSize({ width: 1440, height: 900 });

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
    "at its narrowest nothing in the Inspector runs past its edge, and the status line wraps instead of cutting",
    await window.$eval("[data-inspector-body]", (body) => {
      const status = body.querySelector('[data-feedback="1"] [data-feedback-status]');
      const edge = body.getBoundingClientRect().left + body.clientLeft + body.clientWidth;
      return [[...body.querySelectorAll("*")].every((el) => el.getBoundingClientRect().right <= edge + 0.5), status.scrollWidth <= status.clientWidth];
    }),
    [true, true],
  );
  await window.dblclick(handle);
  await canvas.waitForSelector(`${PIN}[data-status="confirmed"]`);
  check("the pin is coloured confirmed", await canvas.getAttribute(PIN, "data-status"), "confirmed");
  check(
    "a confirmed pin's numeral is the full-strength text colour, in the list and on the canvas",
    [
      await window.evaluate(() => getComputedStyle(document.querySelector('[data-feedback="1"] [data-pin-number]')).color === getComputedStyle(document.body).color),
      await canvas.evaluate((pin) => {
        const probe = document.body.appendChild(Object.assign(document.createElement("i"), { style: "color: var(--bs-fg)" }));
        const fg = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(document.querySelector(pin)).color === fg;
      }, PIN),
    ],
    [true, true],
  );
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
