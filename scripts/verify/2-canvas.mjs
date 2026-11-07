import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brainstorm, seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, checks, inBlock, launch, pixels, settled, showBoard, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-2");
const { check, finish } = checks();

const { app, window, errors, api } = await launch(home, env);
try {
  await window.setViewportSize({ width: 1440, height: 900 });
  // The home card's preview frame gives its turn back as soon as it paints, so its painted message is held here
  // while the frame is checked, then let through.
  await window.evaluate(() => {
    window.__held = [];
    window.__hold = (e) => {
      if (e.data?.kind !== "painted") return;
      e.stopImmediatePropagation();
      window.__held.push(e);
    };
    window.addEventListener("message", window.__hold, true);
  });
  const { session, work } = seedDemo(home, env);
  const previewElement = await window.waitForSelector('[data-preview] iframe[title="Preview"]', { state: "attached" });
  const preview = await previewElement.contentFrame();
  await preview.waitForSelector("[data-bid]");
  await window.waitForFunction(() => window.__held.length > 0);
  check(
    "a home card previews its first slot's selected variant, the block's own content, with no canvas chrome",
    await preview.evaluate(() => ({
      block: document.querySelector("[data-bid]")?.getAttribute("data-bid"),
      content: document.querySelector("[data-bid]")?.textContent?.includes("ROULETTE"),
      chrome: document.querySelectorAll(".bs-frame-title, .bs-switch, .bs-pin, .bs-pick").length,
    })),
    { block: "wheel/neon", content: true, chrome: 0 },
  );
  check(
    "its frame is the canvas sandbox, out of reach: opaque origin, no parent document, no network, and inert to Rob",
    {
      origin: await preview.evaluate(() => origin),
      parent: await preview.evaluate(() => {
        try {
          return window.parent.document ? "readable" : "empty";
        } catch (e) {
          return e.name;
        }
      }),
      network: await preview.evaluate(() => fetch("/health").then(() => "loaded", () => "blocked")),
      frame: await previewElement.evaluate((f) => ({
        src: new URL(f.src).pathname,
        sandbox: f.getAttribute("sandbox"),
        inert: f.inert,
        tabIndex: f.tabIndex,
        hidden: f.closest("[aria-hidden=true]") !== null,
      })),
    },
    { origin: "null", parent: "SecurityError", network: "blocked", frame: { src: "/canvas/preview", sandbox: "allow-scripts", inert: true, tabIndex: -1, hidden: true } },
  );
  check("until it paints, the card shows its preview loading", await window.getAttribute(`[data-overview-session="${session}"] [data-preview]`, "data-preview"), "loading");
  const servedPreview = await fetch(`http://127.0.0.1:${api.port}/canvas/preview`);
  check(
    "/canvas/preview is served with the canvas CSP",
    servedPreview.headers.get("content-security-policy"),
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'",
  );
  await window.evaluate(() => {
    window.removeEventListener("message", window.__hold, true);
    for (const e of window.__held) window.dispatchEvent(new MessageEvent("message", { data: e.data, source: e.source }));
  });
  await window.waitForSelector(`[data-overview-session="${session}"] [data-preview="still"] img`);
  check(
    "then it shows a still of the block, a PNG with the block's colours, and the frame is gone",
    await window.evaluate(async () => {
      const img = document.querySelector("[data-preview=still] img");
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const colours = new Set();
      for (let i = 0; i < pixels.length; i += 16) colours.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      return { png: img.src.startsWith("data:image/png;base64,"), colours: colours.size > 50, frames: document.querySelectorAll('iframe[title="Preview"]').length };
    }),
    { png: true, colours: true, frames: 0 },
  );
  errors.length = 0;
  // A real click at the preview's centre, which the card's stretched button takes.
  const box = await (await window.$(`[data-overview-session="${session}"] [data-preview]`)).boundingBox();
  await window.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  const canvas = await canvasFrame(window);
  check("a click on the preview opens the brainstorm, as anywhere on its card", (await window.textContent("[data-topbar] h1"))?.trim(), "Chore roulette");
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
  for (const theme of ["light", "dark"]) {
    await window.emulateMedia({ colorScheme: theme });
    await window.waitForTimeout(300);
    const spot = await canvas.$eval('.bs-frame[data-slot="wheel"] .bs-frame-body', (body) => {
      const r = body.getBoundingClientRect();
      const fill = getComputedStyle(body.querySelector(":scope > [data-bid] > *")).backgroundColor;
      return { x: r.right - 1, y: r.top + 100, fill: fill.match(/\d+/g).slice(0, 3).map(Number) };
    });
    const frame = await window.$eval("iframe[title=Canvas]", (f) => f.getBoundingClientRect().toJSON());
    const [[painted]] = await pixels(app, window, { x: Math.round(frame.left + spot.x), y: Math.round(frame.top + spot.y), width: 1, height: 2 });
    check(
      `in ${theme}, a scrolling frame's gutter takes its block's own fill, so a dark block has no pale stripe down its side`,
      painted.every((c, i) => Math.abs(c - spot.fill[i]) <= 3),
      true,
    );
  }
  await window.emulateMedia({ colorScheme: "light" });
  await canvas.evaluate(() => document.getElementById("verify-grow").remove());
  check("and once it fits again, the frame keeps its declared width with no gutter", (await wheelFrame()).bar, 0);

  // The spin button ends at the wheel frame's right edge, so its pin sits on the frame's edge.
  await window.click("[data-pick-toggle]");
  await canvas.click(inBlock("wheel/neon", "spin-button"));
  await window.waitForSelector("[data-composer]");
  await window.keyboard.type("Louder");
  await window.click('[data-composer] button:has-text("Pin comment")');
  await canvas.waitForSelector(".bs-pin[data-placed]");
  check(
    "a pin at the frame's edge is 20 px whole, inside the frame's body and not clipped by it",
    await settled(() =>
      canvas.$eval(".bs-pin[data-placed]", (pin) => {
        const [p, body] = [pin.getBoundingClientRect(), pin.closest(".bs-frame").querySelector(".bs-frame-body").getBoundingClientRect()];
        return [Math.round(p.width), Math.round(p.height), p.left >= body.left && p.right <= body.right && p.top >= body.top && p.bottom <= body.bottom];
      }),
    ),
    [20, 20, true],
  );
  const sideways = () =>
    settled(() => canvas.$$eval(".bs-frame-body", (bodies) => bodies.map((b) => b.scrollWidth - b.clientWidth)));
  const edges = [await sideways()];
  await window.setViewportSize({ width: 1100, height: 720 });
  edges.push(await sideways());
  await window.setViewportSize({ width: 1440, height: 900 });
  check("a pin on an element at a frame's right edge never gives the frame sideways scroll, at 100% or zoomed", edges, [
    [0, 0],
    [0, 0],
  ]);

  // A third slot, so the board at 1100 needs well under half size to show the flow in one row.
  cpSync(join(work, "slots", "wheel"), join(work, "slots", "spare"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  writeFileSync(join(work, "brainstorm.json"), JSON.stringify({ ...manifest, slots: [...manifest.slots, { id: "spare", title: "The spare", frame: { width: 390, height: 760 } }] }));
  const third = brainstorm(env, ["commit", session, "--from", work, "--note", "A spare wheel", "--json"]);
  check("the agent adds a third slot", third.code, 0);
  await canvas.waitForSelector('.bs-frame[data-slot="spare"]');
  await window.setViewportSize({ width: 1100, height: 720 });
  const row = await settled(() =>
    canvas.evaluate(() => {
      const frames = [...document.querySelectorAll(".bs-frame")].map((f) => f.getBoundingClientRect());
      return {
        view: document.getElementById("canvas").dataset.view,
        frames: frames.length,
        oneRow: frames.every((f) => Math.abs(f.top - frames[0].top) <= 1),
        inside: frames.every((f) => f.left >= 0 && f.right <= innerWidth),
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    }),
  );
  check("at 1100 the board shows all three slots side by side, inside the canvas, with no sideways scroll", row, { view: "board", frames: 3, oneRow: true, inside: true, sideways: false });
  await window.setViewportSize({ width: 1440, height: 900 });

  // A brainstorm whose block throws: its card says the preview failed, and says so again when home comes back,
  // without running a frame only to take a still of the canvas's error box.
  const broken = brainstorm(env, ["session", "new", "--title", "Broken card", "--json"]).json.data.session.id;
  const brokenWork = join(home, "work", broken);
  brainstorm(env, ["pull", broken, "--out", brokenWork, "--json"]);
  cpSync(join(work, "slots", "result", "card"), join(brokenWork, "slots", "result", "card"), { recursive: true });
  // The commit renders the block once to check it, so the throw waits for an effect, which that check doesn't run.
  writeFileSync(
    join(brokenWork, "slots", "result", "card", "block.tsx"),
    'import { useEffect } from "react";\n\nexport default function Card() {\n  useEffect(() => {\n    throw new Error("verify: the card throws");\n  }, []);\n  return <div data-part="card">Card</div>;\n}\n',
  );
  const brokenManifest = JSON.parse(readFileSync(join(brokenWork, "brainstorm.json"), "utf8"));
  writeFileSync(join(brokenWork, "brainstorm.json"), JSON.stringify({ ...brokenManifest, slots: [{ id: "result", title: "The result", frame: { width: 390 } }] }));
  check("the agent commits a block that throws", brainstorm(env, ["commit", broken, "--from", brokenWork, "--note", "Broken", "--json"]).code, 0);
  const failedPreview = `[data-overview-session="${broken}"] [data-preview="failed"]`;
  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector(failedPreview);
  check("a block that throws leaves its card saying the preview failed, with the error", await window.getAttribute(`${failedPreview} [data-preview-error]`, "data-preview-error"), "verify: the card throws");
  await window.click(`[data-overview-session="${session}"] [data-card-open]`);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  await window.evaluate(() => {
    window.__previewFrames = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && (n.matches('iframe[title="Preview"]') || n.querySelector('iframe[title="Preview"]'))) window.__previewFrames++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await window.click("[data-back]");
  await window.click("[data-overview]");
  await window.waitForSelector(`[data-overview-session="${broken}"] [data-preview]:not([data-preview="loading"])`);
  await window.waitForTimeout(300);
  check(
    "back on home it still says so, from what home already knows, and runs no preview frame",
    [await window.getAttribute(`[data-overview-session="${broken}"] [data-preview]`, "data-preview"), await window.evaluate(() => window.__previewFrames)],
    ["failed", 0],
  );
  const thrown = errors.filter((e) => e.includes("verify: the card throws"));
  // Each frame Playwright attaches to replays its process's console, so the /health probes above come back as the
  // history strip's stills load.
  const probed = (e) => e.includes(`127.0.0.1:${api.port}/health`);
  check("the only errors logged are the thrown block's own", [thrown.length > 0, errors.filter((e) => !thrown.includes(e) && !probed(e))], [true, []]);
  errors.length = 0;

  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
finish();
