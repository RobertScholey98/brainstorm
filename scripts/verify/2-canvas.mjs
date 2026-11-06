import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, settled, showBoard, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-2");
const { check, finish } = checks();

const { app, window, errors, api } = await launch(home, env);
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  const { session, work } = seedDemo(home, env);
  const canvas = await openSession(window, session);
  await showBoard(window, canvas);
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

  // The wheel's frame declares 760 px; its block grows past that, as a block's content can.
  await canvas.evaluate(() => {
    const grow = Object.assign(document.createElement("div"), { id: "verify-grow" });
    grow.style.height = "400px";
    document.querySelector('[data-bid="wheel/neon"] > *').append(grow);
  });
  const wheelFrame = () =>
    settled(() =>
      canvas.$eval('.bs-frame[data-slot="wheel"] .bs-frame-body', (body) => {
        const r = body.getBoundingClientRect();
        const k = r.width / body.offsetWidth;
        return { zoomed: k < 1, layout: body.clientWidth, bar: Math.round(r.width - body.clientWidth * k), overflows: body.scrollHeight > body.clientHeight };
      }),
    );
  const frames = [await wheelFrame()];
  await window.setViewportSize({ width: 1100, height: 720 });
  frames.push(await wheelFrame());
  await window.setViewportSize({ width: 1440, height: 900 });
  check(
    "a frame whose block outgrows its declared height scrolls with a 10 px bar outside its declared width, zoomed or not",
    frames,
    [
      { zoomed: false, layout: 390, bar: 10, overflows: true },
      { zoomed: true, layout: 390, bar: 10, overflows: true },
    ],
  );
  await canvas.evaluate(() => document.getElementById("verify-grow").remove());
  check("and once it fits again, the frame keeps its declared width with no gutter", (await wheelFrame()).bar, 0);

  // A third slot, so the board at 1100 needs under half size for one row and wraps.
  cpSync(join(work, "slots", "wheel"), join(work, "slots", "spare"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  writeFileSync(join(work, "brainstorm.json"), JSON.stringify({ ...manifest, slots: [...manifest.slots, { id: "spare", title: "The spare", frame: { width: 390, height: 760 } }] }));
  const third = brainstorm(env, ["commit", session, "--from", work, "--note", "A spare wheel", "--json"]);
  check("the agent adds a third slot", third.code, 0);
  await canvas.waitForSelector('.bs-frame[data-slot="spare"]');
  // The first frame selected, so the reveal on resize keeps the board at its top.
  await canvas.click(inBlock("wheel/neon", "screen"));
  await window.waitForSelector('[data-block="wheel/neon"]');
  await window.setViewportSize({ width: 1100, height: 720 });
  const wrapped = () =>
    settled(async () => ({
      ...(await canvas.evaluate(() => {
        const frames = [...document.querySelectorAll(".bs-frame")].map((f) => f.getBoundingClientRect());
        const first = frames[0];
        return { wrap: document.getElementById("canvas").dataset.wrap, centred: Math.abs(first.left - (innerWidth - first.right)) <= 1 };
      })),
      below: await window.evaluate(() => document.querySelector("[data-canvas-below]")?.dataset.canvasBelow ?? null),
    }));
  check("a wrapped board centres its rows, and the bar says how many frames wait below", await wrapped(), { wrap: "true", centred: true, below: "2" });
  await canvas.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  check("and the count goes once they are in view", (await wrapped()).below, null);
  await window.setViewportSize({ width: 1440, height: 900 });

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
