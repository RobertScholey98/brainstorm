// Builds the foundation checkpoint for Rob: npm run design:checkpoint -- --before 0 --after 1
//
// Writes design-review/checkpoint/<shot>-<theme>.png, one labelled sheet per before/after pair at 1440, and mark.png,
// the mark at 16, 20 and 48 px in both themes. Run the capture for both rounds first.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { __iconNode as brain } from "lucide-react/dist/esm/icons/brain.js";
import { solidColours } from "../../src/core/design.ts";
import { root } from "../verify/electron.mjs";

const { values } = parseArgs({ options: { before: { type: "string", default: "0" }, after: { type: "string", default: "1" } } });
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
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${brain.map(([, { d }]) => `<path d="${d}"/>`).join("")}</svg>`;
  const cells = THEMES.map((theme) => {
    const c = solidColours(theme);
    return `<div class="cell" style="background:${c.app};color:${c.fg}">${[16, 20, 48].map((s) => svg(s, c)).join("")}<span>Brainstorm · ${theme}</span></div>`;
  });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 24px; background: #8a8a8a; width: max-content; font: 600 13px "Segoe UI Variable Text", system-ui; }
    .row { display: flex; gap: 16px; margin-bottom: 16px; } .cell { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-radius: 8px; }
  </style><div class="row">${cells.join("")}</div>`);
  await page.locator("body").screenshot({ path: join(out, "mark.png") });
  console.log("wrote mark.png");
}

await pairs();
