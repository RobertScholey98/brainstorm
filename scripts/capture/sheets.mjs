// Builds the side-by-side comparison sheets for a review round: npm run capture:sheets -- --round <n>
// Exemplar shots are physical pixels at the machine's display scale, so they are drawn at logical size to compare like for like.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..", "..");
const { values } = parseArgs({ options: { round: { type: "string" }, scale: { type: "string", default: "1.5" } } });
const round = Number(values.round);
if (values.round === undefined || !Number.isInteger(round) || round < 0) {
  console.error("usage: npm run capture:sheets -- --round <n> [--scale 1.5]");
  process.exit(1);
}
const scale = Number(values.scale);
const app = (theme, name) => join(root, "design-review", `round-${round}`, "app", theme, "1440", `${name}.png`);
const exemplar = (file) => join(root, "design-review", "exemplars", file);

const SHEETS = [
  { name: "vs-claude-home", exemplar: ["Claude desktop · home", exemplar("claude/home-design.png")], app: ["Brainstorm · home", app("light", "02-home")] },
  { name: "vs-claude-session", exemplar: ["Claude desktop · home", exemplar("claude/home-design.png")], app: ["Brainstorm · brainstorm open", app("light", "06-session")] },
  { name: "vs-t3-session-dark", exemplar: ["T3 Code · thread (dark)", exemplar("t3/thread-dark.png")], app: ["Brainstorm · brainstorm open (dark)", app("dark", "06-session")] },
  { name: "vs-t3-home-dark", exemplar: ["T3 Code · thread (dark)", exemplar("t3/thread-dark.png")], app: ["Brainstorm · home (dark)", app("dark", "02-home")] },
];

const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const out = join(root, "design-review", `round-${round}`, "sheets");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const sheet of SHEETS) {
  const missing = [sheet.exemplar[1], sheet.app[1]].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    console.error(`skip ${sheet.name}: missing ${missing.join(", ")}`);
    continue;
  }
  const panel = ([label, file], logical) => `<figure><figcaption>${label}</figcaption><img src="${dataUrl(file)}" data-logical="${logical}"></figure>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 24px; background: #8a8a8a; display: flex; gap: 24px; align-items: flex-start; font: 600 18px system-ui; width: max-content; }
    figure { margin: 0; } figcaption { color: #fff; margin-bottom: 8px; } img { display: block; box-shadow: 0 2px 12px #0004; }
  </style>${panel(sheet.exemplar, true)}${panel(sheet.app, false)}`);
  await page.evaluate((s) => {
    for (const img of document.querySelectorAll("img[data-logical=true]")) img.style.width = `${img.naturalWidth / s}px`;
  }, scale);
  await page.screenshot({ path: join(out, `${sheet.name}.png`), fullPage: true });
  console.log(`wrote ${sheet.name}.png`);
}
await browser.close();
