// Present and the preview window (ADR 007): the canvas filling the screen in place, a second window mirroring it in a
// Clean or Working look, Hold, pinning from either window, and giving the canvas away to the preview window.
//
//   node scripts/verify/10-present.mjs [--shots <dir>] [--no-build]
//
// --shots writes each state in light and dark, with a manifest.json saying what each shows, for a design review.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, settled, workspace } from "./electron.mjs";

const { values } = parseArgs({ options: { shots: { type: "string" }, "no-build": { type: "boolean" } } });
if (!values["no-build"]) build();
const { home, shots: ownShots, env } = workspace("verify-10");
const shots = values.shots ?? ownShots;
mkdirSync(shots, { recursive: true });
const { check, finish } = checks();
const manifest = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each state in both themes. The canvas frame follows the page's scheme, so both repaint. */
async function snap(page, name, about, { keepFocus = false } = {}) {
  // Focus left on a trigger after Escape shows its hint, which isn't the state being shot.
  if (!keepFocus) await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.activeElement.closest("[data-popover-content], [data-composer], [data-slot=popover-content]") && document.activeElement.blur());
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    await sleep(350);
    await page.screenshot({ path: join(shots, `${name}-${theme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
  manifest.push({ name, files: [`${name}-light.png`, `${name}-dark.png`], about });
}

/** The canvas frame inside a page. */
async function canvasOf(page) {
  const el = await page.waitForSelector("iframe[title=Canvas]");
  for (;;) {
    const frame = await el.contentFrame();
    if (frame !== null && frame.url().endsWith("/canvas")) return frame;
    await sleep(50);
  }
}

/** The slot a canvas shows: the frame that isn't off the stage, and its block. */
const showing = (canvas) =>
  canvas.evaluate(() => {
    const on = [...document.querySelectorAll(".bs-frame")].filter((f) => !f.hasAttribute("data-offstage"));
    return on.map((f) => `${f.dataset.slot}:${f.querySelector("[data-bid]")?.getAttribute("data-bid")}`).join(" ");
  });

const { app, window, errors } = await launch(home, env);
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  const { session } = seedDemo(home, env);
  const canvas = await openSession(window, session);
  await canvas.waitForSelector(inBlock("wheel/neon", "spin"), { state: "attached" }).catch(() => canvas.waitForSelector('[data-bid="wheel/neon"]'));
  await window.mouse.move(150, 860);

  check(
    "the canvas bar ends with the preview window, then Present last, after the view switch",
    await window.evaluate(() => [...document.querySelectorAll("[data-canvas-bar] [data-present-controls] button")].map((b) => b.getAttribute("aria-label") ?? b.textContent)),
    ["Open preview window", "Present"],
  );
  await snap(window, "01-canvas-bar", "The main window as a brainstorm opens: the canvas bar now ends, after the One slot / All slots switch and a divider, with Open preview window (window icon) then Present (full-screen icon) last, both icon buttons with hints");
  await window.hover("[data-present]");
  await window.waitForSelector("[data-slot=tooltip-content], [role=tooltip]", { timeout: 3000 }).catch(() => {});
  await sleep(300);
  await snap(window, "02-present-hint", "The Present button's hint: Present · Fill the screen with this slot, as the app would look, and its F5 key");
  await window.mouse.move(150, 860);

  // Present in place.
  await window.click("[data-present]");
  await window.waitForSelector("[data-presenting]");
  await canvas.waitForSelector("html[data-present]");
  const fills = await canvas.evaluate(() => {
    const body = document.querySelector(".bs-frame:not([data-offstage]) .bs-frame-body");
    const r = body.getBoundingClientRect();
    return {
      width: Math.round(r.width) === innerWidth,
      top: Math.round(r.top),
      chrome: [...document.querySelectorAll(".bs-frame-title, .bs-pin")].filter((e) => e.getClientRects().length > 0).length,
    };
  });
  check("present stretches the slot to the screen's width from its top, with no title or pins", fills, { width: true, top: 0, chrome: 0 });
  await snap(window, "03-present-start", "Present, first time this run, just started from the wheel slot: the 390 px wheel stretched to fill the screen, no canvas chrome, and in the top right corner a small label, Esc to leave · ← → to change slot, with Exit; it fades after 3.5 s, and later presents show it only while the pointer moves");
  await sleep(3800);
  await snap(window, "04-present", "Present once the label has faded: nothing on screen but the design, as if it were the app");
  await window.keyboard.press("ArrowRight");
  await settled(() => showing(canvas));
  check("right steps to the next slot while presenting", await showing(canvas), "result:result/card");
  await snap(window, "05-present-next-slot", "Present after pressing right: the result slot's assignment card (an auto-height slot), stretched to the screen, its own background running to the bottom edge");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-presenting]", { state: "detached" });
  check("Escape leaves present, and the canvas keeps the slot it stepped to", await showing(canvas), "result:result/card");
  await window.keyboard.press("F5");
  await window.waitForSelector("[data-presenting]");
  await sleep(400);
  check("a later present opens on the design alone, its keys waiting for the pointer", await window.getAttribute("[data-present-hint]", "data-hidden"), "");
  await window.mouse.move(700, 400);
  await window.mouse.move(720, 420);
  await window.waitForSelector("[data-present-hint]:not([data-hidden])");
  await window.mouse.move(760, 440);
  await snap(window, "05b-present-pointer", "A later present, after the pointer moved: the keys label and Exit show in the top right corner, and fade 2 s after the pointer stops");
  await window.keyboard.press("F5");
  await window.waitForSelector("[data-presenting]", { state: "detached" });
  check("F5 presents and F5 leaves", true, true);
  await window.keyboard.press("F5");
  await window.waitForSelector("[data-presenting]");
  await window.mouse.move(700, 400);
  await window.mouse.move(720, 420);
  await window.click("[data-present-leave]");
  await window.waitForSelector("[data-presenting]", { state: "detached" });
  check("Exit in the corner label leaves present", true, true);
  await window.mouse.move(150, 860);

  // The preview window.
  const [preview] = await Promise.all([app.waitForEvent("window"), window.click("[data-preview-open]")]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.setIgnoreMouseEvents(true)));
  preview.on("pageerror", (e) => errors.push(`preview pageerror: ${e.message}`));
  preview.on("console", (m) => {
    if (m.type() === "error") errors.push(`preview error: ${m.text()}`);
  });
  await preview.setViewportSize({ width: 1280, height: 800 });
  await preview.waitForSelector("[data-preview-window=clean]");
  const mirror = await canvasOf(preview);
  await mirror.waitForSelector("html[data-present]");
  await settled(() => showing(mirror));
  check("the preview window opens clean, on the slot the main window shows", await showing(mirror), "result:result/card");
  check("in the clean look its title is the design's alone", await preview.title(), "Chore roulette");
  await snap(preview, "06-preview-clean", "The preview window (1280×800), Clean look: the result slot alone, filling the window, nothing of Brainstorm's chrome; this is what stakeholders see when it is shared. Its OS title bar (not in the shot) reads only Chore roulette");
  await window.mouse.move(150, 860);
  check(
    "with the window open, the bar offers Hold and the Preview menu, and Present stays last",
    await window.evaluate(() => [...document.querySelectorAll("[data-present-controls] button")].map((b) => b.getAttribute("aria-label") ?? b.textContent.trim())),
    ["Hold preview", "Preview · Clean", "Present"],
  );
  await snap(window, "07-main-window-open", "The main window while the preview window is open: Hold preview and a Preview menu button grow in to the left of Present, which keeps its place at the canvas bar's right end");

  // The clean look never takes a pick: it is the one an audience sees.
  await window.click("[data-pick-toggle]");
  await canvas.waitForSelector('body[data-mode="pin"]');
  await sleep(300);
  check("a pick started in the main window leaves the clean preview window as it was", await mirror.evaluate(() => document.body.dataset.mode ?? "view"), "view");
  await window.keyboard.press("Escape");
  await canvas.waitForSelector('body[data-mode="view"]');

  // It follows the main window: slot, variant.
  await window.click('[data-slot-tab="wheel"]');
  await settled(() => showing(mirror));
  check("choosing a slot in the main window shows it in the preview window", await showing(mirror), "wheel:wheel/neon");
  await window.click('[data-variant="reel"]');
  await settled(() => showing(mirror));
  check("choosing a variant shows it there too", await showing(mirror), "wheel:wheel/reel");
  await snap(preview, "08-preview-clean-wheel", "The preview window after the main window picked the wheel slot and its reel variant: it followed, stretched to the window");

  // Hold.
  await window.click("[data-hold]");
  await window.click('[data-slot-tab="result"]');
  await sleep(600);
  check("under Hold the preview window keeps what it showed", await showing(mirror), "wheel:wheel/reel");
  check(
    "the main window says so under the canvas bar, naming the slot and variant held, and Hold preview is pressed",
    [await window.textContent("[data-held-bar]"), await window.getAttribute("[data-hold]", "aria-pressed")],
    ["Preview heldThe preview window keeps showing The wheel · Slot reel.Resume live", "true"],
  );
  await window.mouse.move(150, 860);
  await snap(window, "09-main-held", "The main window with Hold preview on: the button pressed, and a warning-toned bar under the canvas bar, Preview held · The preview window keeps showing The wheel · Slot reel, with Resume live; the main canvas has moved on to the result slot");
  await window.click("[data-held-release]");
  await settled(() => showing(mirror));
  check("releasing Hold sends it the latest", await showing(mirror), "result:result/card");

  // The menu and the Working look.
  await window.click("[data-preview-menu]");
  await window.waitForSelector("[data-preview-popover]");
  await sleep(250);
  await snap(window, "10-preview-menu", "The Preview menu: what the window is for and what Hold preview does, the Look switch (Clean or Working) with both looks described under it and the chosen one in full contrast, Show the canvas in this window, Bring to front and Full screen (F11), and Close window alone in the footer");
  await window.click('[data-preview-look="working"]');
  await sleep(250);
  await snap(window, "10b-preview-menu-working", "The Preview menu with Working chosen: its line under the switch now in full contrast", { keepFocus: true });
  await window.click('[data-preview-look="working"]');
  await preview.waitForSelector("[data-preview-window=working]");
  await window.keyboard.press("Escape");
  await mirror.waitForSelector("html:not([data-present])");
  await settled(() => showing(mirror));
  await preview.mouse.move(640, 790);
  await snap(preview, "11-preview-working", "The preview window, Working look: the same canvas bar as the main window (slot tabs, view switch), then Pin comment at its right, over the canvas drawn as the main window draws it");

  // Pin from the preview window.
  await preview.click("[data-preview-pin]");
  await mirror.waitForSelector('body[data-mode="pin"]');
  await window.waitForSelector("[data-pick-hint]");
  check("Pin comment in the preview window puts both canvases in pick mode", await canvas.evaluate(() => document.body.dataset.mode), "pin");
  await mirror.hover(inBlock("result/card", "headline"));
  await sleep(200);
  await snap(preview, "12-preview-picking", "The preview window picking: the hint in its canvas bar, Pin comment pressed, and the highlight on the hovered headline");
  await mirror.click(inBlock("result/card", "headline"));
  await preview.waitForSelector("[data-composer]");
  check("a pick in the preview window opens its composer there and ends the pick in the main window", await canvas.evaluate(() => document.body.dataset.mode), "view");
  await preview.keyboard.type("Make the headline louder for the demo");
  await snap(preview, "13-preview-composer", "The pin composer in the preview window, with a comment typed");
  await preview.click('[data-composer] button:has-text("Pin comment")');
  await window.waitForSelector('[data-feedback="1"]');
  await mirror.waitForSelector('.bs-pin[data-pin="1"][data-placed]');
  check("the comment lands in the main window's feedback, and its pin in both canvases", await canvas.$eval('.bs-pin[data-pin="1"]', (p) => p.hasAttribute("data-placed")), true);
  await preview.mouse.move(640, 790);
  await snap(preview, "14-preview-pinned", "The preview window after the comment saved: pin 1 on the headline");

  // The main window still pins.
  await window.click("[data-pick-toggle]");
  await window.mouse.move(150, 860);
  await snap(window, "14b-main-picking-window-open", "The main window picking while the preview window is open (Working): the pick hint, Esc and Cancel in the canvas bar; Hold preview, Preview and Present keep their places, their labels giving way to icons only if the hint needs the room");
  await canvas.click(inBlock("result/card", "headline"));
  await window.waitForSelector("[data-composer]");
  check("the main window's canvas still pins while the preview window is open", await preview.$("[data-composer]"), null);
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-composer]", { state: "detached" });

  // Give the canvas away.
  await window.click("[data-preview-menu]");
  await window.click("[data-preview-here]");
  await window.keyboard.press("Escape");
  await window.waitForSelector("[data-canvas-away]");
  await window.mouse.move(150, 860);
  await snap(window, "15-canvas-away", "The main window with Show the canvas in this window off: the canvas region says the canvas is in the preview window, with Show the canvas here and Bring the window to front; the slot bar, sidebar and Inspector stay");
  await window.click("[data-pick-toggle]");
  await mirror.waitForSelector('body[data-mode="pin"]');
  await window.waitForSelector("[data-canvas-away]");
  check("a pick started here while the canvas is away waits in the preview window", await window.textContent("[data-canvas-away] [data-slot=empty-title]"), "Click an element in the preview window");
  check("the bar's pick hint says where to pick, in full", await window.textContent("[data-pick-hint]"), "Pick in the preview windowEscCancel");
  await snap(window, "16-canvas-away-picking", "The same, after Pin comment in the Inspector: the canvas bar's hint reads Pick in the preview window with Esc and Cancel, and the region's title says to click an element there");
  await window.keyboard.press("Escape");

  // A clean preview window can't take a pick, so with the canvas away the main window says so and offers a way on.
  await window.click("[data-preview-menu]");
  await window.click('[data-preview-look="clean"]');
  await window.click("[data-preview-menu]");
  await preview.waitForSelector("[data-preview-window=clean]");
  await window.click("[data-pick-toggle]");
  await window.waitForSelector('[data-canvas-away="stuck"]');
  check(
    "with the canvas away and the preview window clean, Pin comment starts no pick: the region says how to go on",
    [
      await window.$("[data-pick-hint]"),
      await mirror.evaluate(() => document.body.dataset.mode ?? "view"),
      await window.textContent("[data-canvas-away] [data-slot=empty-title]"),
    ],
    [null, "view", "To pin a comment, switch the preview to Working"],
  );
  await window.mouse.move(150, 860);
  await snap(window, "16b-canvas-away-clean-pick", "Canvas away, preview window Clean, after Pin comment: no pick mode starts (the bar and Pin comment are as they were); the region says to pin a comment, switch the preview to Working, and why, with Switch to Working (primary), Show the canvas here, and Cancel");
  await window.click("[data-away-working]");
  await preview.waitForSelector("[data-preview-window=working]");
  await mirror.waitForSelector('body[data-mode="pin"]');
  check("Switch to Working starts the pick in the preview window", await window.getAttribute("[data-canvas-away]", "data-canvas-away"), "picking");
  await window.keyboard.press("Escape");
  await window.click("[data-away-here]");
  await window.waitForSelector("[data-canvas-away]", { state: "detached" });

  // Close it.
  await window.click("[data-preview-menu]");
  await Promise.all([preview.waitForEvent("close"), window.click("[data-preview-close]")]);
  await window.waitForSelector("[data-preview-open]");
  check("Close window closes it, and the bar goes back to Present and Open preview window", await window.$("[data-hold]"), null);

  check("no page errors in either window", errors.filter((e) => !/Autofill|DevTools/.test(e)), []);
} finally {
  writeFileSync(join(shots, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await app.close().catch(() => {});
}
finish();
