// Proves v0.1 item 2 on the real Electron app: blocks render in the sandboxed canvas frame, each slot's variant
// switch swaps its block, and switching variants keeps another block's override, in the canvas and in the view.
import { seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-2");
const { check, finish } = checks();

const { app, window, errors, api } = await launch(home, env);
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  const { session } = seedDemo(home, env);
  const canvas = await openSession(window, session);
  await canvas.waitForSelector(inBlock("wheel/neon", "screen"));
  await canvas.waitForSelector(inBlock("result/card", "card"));
  await shot(window, shots, "1-seeded");

  check("the session the agent created is open", (await window.textContent("[data-topbar] h1"))?.trim() === "Chore roulette", true);
  check(
    "each slot renders its first variant inside the host's data-bid wrapper",
    await canvas.$$eval("#canvas > .bs-frame", (frames) =>
      frames.map((f) => ({ slot: f.dataset.slot, block: f.querySelector("[data-bid]")?.getAttribute("data-bid"), title: f.querySelector(".bs-frame-title span")?.textContent })),
    ),
    [
      { slot: "wheel", block: "wheel/neon", title: "The wheel" },
      { slot: "result", block: "result/card", title: "The result" },
    ],
  );
  check("the canvas frame's origin is null", await canvas.evaluate(() => origin), "null");
  check(
    "the canvas frame can't reach its parent's document",
    await canvas.evaluate(() => {
      try {
        return window.parent.document ? "readable" : "empty";
      } catch (e) {
        return e.name;
      }
    }),
    "SecurityError",
  );
  check(
    "the canvas frame's CSP blocks network requests",
    await canvas.evaluate(() => fetch("/health").then(() => "loaded", () => "blocked")),
    "blocked",
  );
  await window.waitForTimeout(200);
  check(
    "the frame reports the CSP violation to the host",
    errors.includes(`warning: The canvas blocked http://127.0.0.1:${api.port}/health (connect-src).`),
    true,
  );
  errors.length = 0;
  const served = await fetch(`http://127.0.0.1:${api.port}/canvas`);
  check(
    "/canvas is served with the CSP header",
    served.headers.get("content-security-policy"),
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'",
  );
  check(
    "the iframe is sandboxed to scripts only",
    await window.getAttribute("iframe[title=Canvas]", "sandbox"),
    "allow-scripts",
  );

  const activeBlocks = () => canvas.$$eval("#canvas div[data-bid]", (els) => els.map((e) => e.getAttribute("data-bid")));
  const pick = async (variant, blockId, part) => {
    await window.click(`button[data-variant="${variant}"]`);
    await canvas.waitForSelector(inBlock(blockId, part));
  };

  await pick("reel", "wheel/reel", "reel");
  check("the wheel's variant switch swaps in the slot reel", await activeBlocks(), ["wheel/reel", "result/card"]);
  await pick("receipt", "result/receipt", "paper");
  check("the result's variant switch swaps in the receipt", await activeBlocks(), ["wheel/reel", "result/receipt"]);
  await window.waitForTimeout(1500);
  await shot(window, shots, "2-switched");
  await pick("card", "result/card", "card");
  await pick("neon", "wheel/neon", "screen");

  await canvas.click(inBlock("result/card", "card"));
  await window.waitForSelector('[data-block="result/card"]');
  const headline = window.locator('[data-control="headline"] input');
  await headline.click();
  await window.keyboard.press("Control+A");
  await window.keyboard.type("Fate has spoken");
  await window.waitForSelector('[data-control="headline"][data-overridden]');
  check("the headline override repaints the card", await canvas.textContent(inBlock("result/card", "headline")), "Fate has spoken");
  await shot(window, shots, "3-override");

  const switchTo = async (variant, blockId, part) => {
    const response = window.waitForResponse((r) => r.url().endsWith(`/v1/ui/sessions/${session}/actions`));
    await pick(variant, blockId, part);
    return (await (await response).json()).data;
  };
  await switchTo("terminal", "wheel/terminal", "crew-table");
  const view = await switchTo("neon", "wheel/neon", "screen");
  check(
    "after two wheel switches the card still renders the override",
    await canvas.textContent(inBlock("result/card", "headline")),
    "Fate has spoken",
  );
  check(
    "the view still holds the override as applicable",
    view.overrides.applicable.map((o) => ({ blockId: o.blockId, prop: o.prop, value: o.value })),
    [{ blockId: "result/card", prop: "headline", value: "Fate has spoken" }],
  );
  check("the view records the wheel's choice", view.iteration.slots.map((s) => [s.id, s.active]), [
    ["wheel", "neon"],
    ["result", "card"],
  ]);
  await canvas.click(inBlock("result/card", "card"));
  await window.waitForSelector('[data-block="result/card"]');
  check(
    "the panel shows the card's override, marked as set",
    [await window.inputValue('[data-control="headline"] input'), await window.isVisible('[data-control="headline"][data-overridden]')],
    ["Fate has spoken", true],
  );
  await shot(window, shots, "4-override-kept");

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
