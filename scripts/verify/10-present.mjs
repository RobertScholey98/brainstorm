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
  await snap(window, "02-present-hint", "The Present button's hint: Present · Fill the screen with this slot, and its F5 key");
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
  await snap(window, "03-present-start", "Present, first time this run, just started from the wheel slot: the 390 px wheel stretched to fill the screen, no canvas chrome, and at the top centre a small label, ← → change slot | Exit Esc; it fades after 3.5 s, and later presents show it only when the pointer nears the top edge");
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
  await sleep(400);
  check("pointing at the design leaves the screen clean", await window.getAttribute("[data-present-hint]", "data-hidden"), "");
  await window.mouse.move(1100, 60);
  await window.mouse.move(1120, 40);
  await window.waitForSelector("[data-present-hint]:not([data-hidden])");
  await snap(window, "05b-present-pointer", "A later present, with the pointer brought near the top edge: the keys label and Exit show at the top centre, and fade 2 s after the pointer leaves the top; pointing anywhere lower leaves the screen clean, and a still pointer hides after 2 s");
  await window.keyboard.press("F5");
  await window.waitForSelector("[data-presenting]", { state: "detached" });
  check("F5 presents and F5 leaves", true, true);
  await window.keyboard.press("F5");
  await window.waitForSelector("[data-presenting]");
  await window.mouse.move(1100, 60);
  await window.mouse.move(1120, 40);
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
    ["Hold preview", "Preview window, Clean", "Present"],
  );
  check(
    "at 1440 the bar keeps \"Hold\" and \"Preview Clean\" in words, with the pick hint's room still set aside",
    await window.evaluate(() => [document.querySelector("[data-hold]")?.innerText.trim(), document.querySelector("[data-preview-menu]")?.innerText.replace(/\s+/g, " ").trim()]),
    ["Hold", "Preview Clean"],
  );
  await snap(window, "07-main-window-open", "The main window while the preview window is open: Hold preview and a Preview menu button grow in to the left of Present, which keeps its place at the canvas bar's right end");
  await window.hover("[data-hold]");
  await window.waitForSelector("[data-slot=tooltip-content], [role=tooltip]", { timeout: 3000 }).catch(() => {});
  await sleep(300);
  await snap(window, "07b-hold-hint", "Hold's hint while the bar shows it as the bare word Hold: it names the whole action, Hold preview window, and says what it does");
  await window.mouse.move(150, 860);
  await sleep(300);

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
    ["Preview heldThe preview window still shows The wheel · Slot reel.Resume live", "true"],
  );
  await window.mouse.move(150, 860);
  await snap(window, "09-main-held", "The main window with Hold preview on: the button pressed amber, and, as a slim strip in the canvas's top inset above the frame caption so nothing moves or hides, a warning-toned bar under the canvas bar, Preview held · The preview window still shows The wheel · Slot reel, with a compact Resume live inside the strip; the main canvas has moved on to the result slot");
  await window.click("[data-held-release]");
  await settled(() => showing(mirror));
  check("releasing Hold sends it the latest", await showing(mirror), "result:result/card");

  // The menu and the Working look.
  await window.click("[data-preview-menu]");
  await window.waitForSelector("[data-preview-popover]");
  await sleep(250);
  await snap(window, "10-preview-menu", "The Preview menu: what the window is for and what Hold preview does, the Look switch (Clean or Working) with both looks described under it and the chosen one in full contrast, Show canvas in main window, Bring preview to front and Full screen preview (its F11 key chip on it), and Close preview alone in the footer");
  await window.click('[data-preview-look="working"]');
  await sleep(250);
  await snap(window, "10b-preview-menu-working", "The Preview menu with Working chosen: its line under the switch now in full contrast, and the Preview button behind it in the warning tone (amber edge and fill, amber eye-off)", { keepFocus: true });
  await window.click('[data-preview-look="working"]');
  await preview.waitForSelector("[data-preview-window=working]");
  await window.keyboard.press("Escape");
  await mirror.waitForSelector("html:not([data-present])");
  await settled(() => showing(mirror));
  await preview.mouse.move(640, 790);
  await snap(preview, "11-preview-working", "The preview window, Working look: the same canvas bar as the main window (slot tabs, view switch), then Not for sharing (amber eye-off and amber text) with Switch to Clean, and Pin comment at its right, over the canvas drawn as the main window draws it");
  await window.click("[data-hold]");
  await preview.waitForSelector("[data-held-bar]");
  await preview.mouse.move(640, 790);
  await snap(preview, "11b-preview-working-held", "The Working preview window while Hold preview is on in the main window: the same warning-toned held strip as the main window's, in its canvas's top inset, saying changes in the main window wait for Resume live, which ends the strip as an amber full-height segment with a play glyph; an amber rule under the bar marks the Working look");
  await preview.click("[data-held-release]");
  await preview.waitForSelector("[data-held-bar]", { state: "detached" });
  check("Resume live in the working preview window ends Hold in the main window", await window.getAttribute("[data-hold]", "aria-pressed"), "false");
  await preview.click("[data-preview-to-clean]");
  await preview.waitForSelector("[data-preview-window=clean]");
  check("Switch to Clean in the working preview window sets the look in the main window", await window.getAttribute("[data-preview-menu]", "aria-label"), "Preview window, Clean");
  await window.click("[data-preview-menu]");
  await window.click('[data-preview-look="working"]');
  await window.click("[data-preview-menu]");
  await preview.waitForSelector("[data-preview-window=working]");
  await mirror.waitForSelector("html:not([data-present])");

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
  await snap(window, "14b-main-picking-window-open", "The main window picking while the preview window is open (Working): the pick hint (an accent pointer glyph, words at full strength) and Cancel (Esc in its hint) fill room the bar keeps for them, so the view switch, Hold, the Preview menu and Present are exactly where and as they were in 07");
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
  await snap(window, "15-canvas-away", "The main window with Show canvas in main window off: the canvas region says the canvas is in the preview window, with Bring preview to front (primary) and Show canvas here; the slot bar, sidebar and Inspector stay");
  await window.click("[data-pick-toggle]");
  await mirror.waitForSelector('body[data-mode="pin"]');
  await window.waitForSelector("[data-canvas-away]");
  check("a pick started here while the canvas is away waits in the preview window", await window.textContent("[data-canvas-away] [data-slot=empty-description]"), "Click an element in the preview window. Press Esc or Cancel to stop.");
  check("the bar's pick hint says where to pick, in full", await window.textContent("[data-pick-hint]"), "Click in previewCancel");
  await snap(window, "16-canvas-away-picking", "The same, after Pin comment in the Inspector: the canvas bar's hint reads Click in preview, with Cancel, and the region's title says to click an element there");
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
    [null, "view", "The canvas is in the Clean preview"],
  );
  await window.mouse.move(150, 860);
  await snap(window, "16b-canvas-away-clean-pick", "Canvas away, preview window Clean, after Pin comment: no pick mode starts (the bar and Pin comment are as they were); the region says the canvas is in the Clean preview, which hides pins, in two short lines, with Show here and pin (primary: it shows the canvas here and starts the pick), Switch preview to Working (outline in the warning tone, as the Working menu button is), and Not now");
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
  check("Close preview closes it, and the bar goes back to Present and Open preview window", await window.$("[data-hold]"), null);

  check("no page errors in either window", errors.filter((e) => !/Autofill|DevTools/.test(e)), []);
} finally {
  writeFileSync(join(shots, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await app.close().catch(() => {});
}
finish();
