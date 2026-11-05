// Builds the foundation checkpoint for Rob: npm run design:checkpoint -- --before 0 --after 1
//
// Writes design-review/checkpoint/<shot>-<theme>.png, one labelled sheet per before/after pair at 1440, and
// accent-<name>-<theme>.png, the brainstorm open in the app under each accent candidate, and mark.png, the mark at
// 16, 20 and 48 px in every candidate and theme. Run the capture for both
// rounds first. --only pairs or --only accents builds just one half.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { ACCENTS, accentCss, MARK, solidColours } from "../../src/core/design.ts";
import { seedDemo } from "../seed-demo.mjs";
import { build, canvasFrame, inBlock, launch, openSession, root, workspace } from "../verify/electron.mjs";

const { values } = parseArgs({ options: { before: { type: "string", default: "0" }, after: { type: "string", default: "1" }, only: { type: "string" } } });
const SHOTS = ["02-home", "06-session", "14-state-regenerate-open-blocks"];
const THEMES = ["light", "dark"];
const out = join(root, "design-review", "checkpoint");
mkdirSync(out, { recursive: true });

const shot = (round, theme, name) => join(root, "design-review", `round-${round}`, "app", theme, "1440", `${name}.png`);
const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

async function pairs() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const name of SHOTS) {
    for (const theme of THEMES) {
      const files = [shot(values.before, theme, name), shot(values.after, theme, name)];
      const missing = files.filter((f) => !existsSync(f));
      if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}; run npm run capture for both rounds first`);
      const panel = (label, file) => `<figure><figcaption>${label}</figcaption><img src="${dataUrl(file)}"></figure>`;
      await page.setContent(`<!doctype html><style>
        body { margin: 0; padding: 24px; background: #8a8a8a; display: flex; gap: 24px; align-items: flex-start; font: 600 18px system-ui; width: max-content; }
        figure { margin: 0; } figcaption { color: #fff; margin-bottom: 8px; } img { display: block; box-shadow: 0 2px 12px #0004; }
      </style>${panel(`Before · round ${values.before} · ${name} · ${theme}`, files[0])}${panel(`After · round ${values.after} · ${name} · ${theme}`, files[1])}`);
      await page.screenshot({ path: join(out, `${name}-${theme}.png`), fullPage: true });
      console.log(`wrote ${name}-${theme}.png`);
    }
  }
  await markSheet(page);
  await browser.close();
}

async function markSheet(page) {
  const svg = (size, c) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 16 16"><path d="${MARK.tile}" fill="${c.accent}"/><circle cx="${MARK.dot.cx}" cy="${MARK.dot.cy}" r="${MARK.dot.r}" fill="${c["accent-fg"]}"/></svg>`;
  const rows = THEMES.map((theme) => {
    const cells = Object.keys(ACCENTS).map((name) => {
      const c = solidColours(theme, name);
      return `<div class="cell" style="background:${c.app};color:${c.fg}">${[16, 20, 48].map((s) => svg(s, c)).join("")}<span>Brainstorm · ${name} · ${theme}</span></div>`;
    });
    return `<div class="row">${cells.join("")}</div>`;
  });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 24px; background: #8a8a8a; width: max-content; font: 600 13px "Segoe UI Variable Text", system-ui; }
    .row { display: flex; gap: 16px; margin-bottom: 16px; } .cell { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-radius: 8px; }
  </style>${rows.join("")}`);
  await page.screenshot({ path: join(out, "mark.png"), fullPage: true });
  console.log("wrote mark.png");
}

async function accents() {
  const { home, env } = workspace("checkpoint-accents");
  const { app, window } = await launch(home, env);
  try {
    const { session } = seedDemo(home, env);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true));
    await window.setViewportSize({ width: 1440, height: 900 });
    const canvas = await openSession(window, session);
    await canvas.waitForSelector(inBlock("wheel/neon", "screen"));
    await canvas.waitForSelector(inBlock("result/card", "card"));
    for (const name of Object.keys(ACCENTS)) {
      await window.addStyleTag({ content: accentCss(name) });
      await (await canvasFrame(window)).addStyleTag({ content: accentCss(name, "bs-") });
      for (const theme of THEMES) {
        await window.emulateMedia({ colorScheme: theme });
        await window.mouse.move(800, 24);
        await window.evaluate(() => document.fonts.ready);
        await window.waitForTimeout(400);
        await window.screenshot({ path: join(out, `accent-${name}-${theme}.png`) });
        console.log(`wrote accent-${name}-${theme}.png`);
      }
    }
  } finally {
    await app.close();
  }
}

if (values.only !== "accents") await pairs();
if (values.only !== "pairs") {
  build();
  await accents();
}
