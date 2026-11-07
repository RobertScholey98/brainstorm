import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { seedDemo } from "../seed-demo.mjs";
import { build, checks, inBlock, launch, openSession, settled, showBoard, shot, workspace } from "./electron.mjs";

build();
const { home, shots, env } = workspace("verify-6");
const { check, finish } = checks();

async function setText(window, prop, value, field = "input") {
  await window.click(`[data-control="${prop}"] ${field}`);
  await window.keyboard.press("Control+A");
  await window.keyboard.type(value);
  if (field === "input") await window.keyboard.press("Enter");
  await window.waitForSelector(`[data-control="${prop}"][data-overridden]`);
}

const { app, window, errors, api } = await launch(home, env);
let exported;
try {
  await app.evaluate(({ shell }) => {
    globalThis.revealed = [];
    shell.showItemInFolder = (path) => void globalThis.revealed.push(path);
  });
  await window.setViewportSize({ width: 1440, height: 900 });
  const { session } = seedDemo(home, env);
  const canvas = await openSession(window, session);
  await showBoard(window, canvas);
  await canvas.waitForSelector(inBlock("wheel/neon", "screen"));

  await window.click('button[data-variant="receipt"]');
  await canvas.waitForSelector(inBlock("result/receipt", "footer"));
  await setText(window, "footer", "Pinned to the fridge", "textarea");
  await window.click('button[data-variant="card"]');
  await canvas.waitForSelector(inBlock("result/card", "headline"));
  await setText(window, "headline", "Fate has spoken");
  await window.click('button[data-variant="neon"]');
  await setText(window, "accent", "#00f0ff", 'input[type="text"]');
  await window.click('button[data-variant="reel"]');
  await canvas.waitForSelector(inBlock("wheel/reel", "pull-button"));
  await setText(window, "buttonLabel", "Crank it");
  await window.waitForTimeout(400);

  const trigger = () => window.$eval("[data-export]", (b) => [b.getAttribute("aria-expanded"), getComputedStyle(b).backgroundColor, getComputedStyle(b).borderColor]);
  const closed = await trigger();
  let release;
  const written = new Promise((r) => (release = r));
  await window.route("**/v1/ui/sessions/*/export", async (route) => {
    await written;
    await route.continue();
  });
  await window.click("[data-export]");
  // Where the title's words start, after its glyph.
  const titleAt = () =>
    settled(() =>
      window.$eval("[data-export-title]", (t) => {
        const range = document.createRange();
        range.selectNodeContents(t.lastChild);
        return Math.round(range.getBoundingClientRect().left);
      }),
    );
  await window.waitForSelector('[data-export-title]:has-text("Exporting")');
  const writing = await titleAt();
  release();
  await window.waitForSelector("[data-exported]");
  check("the Export title holds its place as the file lands", await titleAt(), writing);
  const opened = await trigger();
  check(
    "Export shows it is open, in the pressed look, and goes back when it closes",
    [opened[0], opened[1] !== closed[1], opened[2] !== closed[2]],
    ["true", true, true],
  );
  check(
    "Exported leads with a success check, as Copied does",
    await window.$eval("[data-export-title]", (t) => {
      const probe = document.body.appendChild(Object.assign(document.createElement("span"), { style: "color: var(--success)" }));
      const success = getComputedStyle(probe).color;
      probe.remove();
      const glyph = t.closest("[data-slot=popover-header]").firstElementChild;
      return [t.textContent.trim(), glyph.tagName.toLowerCase(), getComputedStyle(glyph).color === success];
    }),
    ["Exported", "svg", true],
  );
  check(
    "its description starts under the title's words, so the header keeps one left edge",
    await window.$eval("[data-slot=popover-header]", (h) => {
      const range = document.createRange();
      range.selectNodeContents(h.querySelector("[data-export-title]"));
      return Math.round(h.querySelector("[data-slot=popover-description]").getBoundingClientRect().left - range.getBoundingClientRect().left);
    }),
    0,
  );
  exported = (await window.textContent("[data-export-path]"))?.trim();
  const name = exported?.slice(join(home, "exports").length + 1);
  check("the file lands in exports, named by session, iteration and time", /^s_[0-9a-z]+-i1-\d{8}-\d{6}\.html$/.test(name ?? "") && name.startsWith(`${session}-i1-`), true);
  check("the file exists", existsSync(exported), true);
  await shot(window, shots, "1-exported");
  await window.click("[data-reveal]");
  await window.waitForTimeout(300);
  check("Show in folder reveals the file through the main process", await app.evaluate(() => globalThis.revealed), [exported]);
  check("the window logged no errors or warnings", errors, []);
} finally {
  await app.close();
}
check(
  "the app and its server are stopped",
  await fetch(`http://127.0.0.1:${api.port}/health`).then(
    () => "answering",
    () => "stopped",
  ),
  "stopped",
);

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ offline: true, viewport: { width: 1100, height: 900 } });
  const requests = [];
  context.on("request", (r) => requests.push(r.url()));
  await context.route("**/*", (route) => (route.request().url().startsWith("file:") ? route.continue() : route.abort()));
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  const url = pathToFileURL(exported).href;
  await page.goto(url);
  await page.waitForSelector(inBlock("result/card", "headline"));

  const text = (blockId, part) => page.textContent(inBlock(blockId, part)).then((t) => t?.trim());
  check("it opens on Rob's variant choices", await page.$$eval("#canvas div[data-bid]", (els) => els.map((e) => e.dataset.bid)), ["wheel/reel", "result/card"]);
  check("the reel renders with its overridden button text", await text("wheel/reel", "pull-button"), "Crank it");
  check("the card renders with its overridden headline", await text("result/card", "headline"), "Fate has spoken");
  await page.screenshot({ path: join(shots, "2-offline.png") });

  await page.click('[data-slot="wheel"] .bs-switch [data-variant="wheel/neon"]');
  await page.waitForSelector(inBlock("wheel/neon", "screen"));
  check(
    "the switcher shows the neon wheel with its overridden accent",
    await page.$eval(inBlock("wheel/neon", "screen"), (el) => el.style.getPropertyValue("--accent")),
    "#00f0ff",
  );
  await page.click('[data-slot="wheel"] .bs-switch [data-variant="wheel/terminal"]');
  check("the switcher shows the terminal draw at its defaults", await text("wheel/terminal", "screen").then((t) => t?.includes("draw --fair bins_out")), true);
  await page.click('[data-slot="result"] .bs-switch [data-variant="result/receipt"]');
  await page.waitForSelector(inBlock("result/receipt", "footer"));
  check("the switcher shows the receipt with its overridden footer", await text("result/receipt", "footer"), "Pinned to the fridge");
  check(
    "the switcher marks the shown variants",
    await page.$$eval('.bs-switch [aria-checked="true"]', (els) => els.map((e) => e.dataset.variant)),
    ["wheel/terminal", "result/receipt"],
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, "3-switched.png") });

  check("no request left the page", requests, [url]);
  check("zero console errors and page errors", problems, []);
} finally {
  await browser.close();
}
finish();
