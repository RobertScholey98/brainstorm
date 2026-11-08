// Builds the side-by-side sheets for the design systems climb: Storybook beside Brainstorm's Design systems page.
//
//   node scripts/capture/systems-sheets.mjs --round <n>
//
// Run scripts/capture/storybook.mjs, systems.mjs and app-systems.mjs for the round first. Every shot is 1440×900 at a
// 1.5 display scale, so each is drawn at its logical size.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..", "..");
const { values } = parseArgs({ options: { round: { type: "string" } } });
const round = Number(values.round);
if (values.round === undefined || !Number.isInteger(round) || round < 0) {
  console.error("usage: node scripts/capture/systems-sheets.mjs --round <n>");
  process.exit(1);
}
const review = join(root, "design-review", "systems-climb", `round-${round}`);
const storybook = (name) => join(root, "design-review", "exemplars", "storybook", `${name}.png`);
/** The shot whose name ends in `slug`, from the library or the app capture of this round, whatever its number. */
const brainstorm = (capture, slug) => {
  const dir = join(review, capture);
  const file = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(`-${slug}.png`)).sort().at(-1) : undefined;
  return join(dir, file ?? `??-${slug}.png`);
};

const SHEETS = [
  {
    name: "vs-storybook-canvas",
    exemplar: ["Storybook · one component's story", storybook("canvas-card")],
    app: ["Brainstorm · one component's stories (Card)", brainstorm("library", "system-gallery-card")],
  },
  {
    name: "vs-storybook-controls",
    exemplar: ["Storybook · a story with a control changed", storybook("controls-changed")],
    app: ["Brainstorm · the workbench with two controls changed", brainstorm("app", "workbench-changed")],
  },
  {
    name: "vs-storybook-search",
    exemplar: ["Storybook · sidebar search 'st'", storybook("sidebar-search")],
    app: ["Brainstorm · catalog search 'st'", brainstorm("library", "system-catalog-search")],
  },
  {
    name: "vs-storybook-review",
    exemplar: ["Storybook · browsing a library", storybook("canvas-accordion")],
    app: ["Brainstorm · reviewing a newly added library", brainstorm("library", "library-review")],
    note: "Storybook has no review step. Compare how each lets you walk a library's components and judge them.",
  },
];

const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const out = join(review, "sheets");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const sheet of SHEETS) {
  const missing = [sheet.exemplar[1], sheet.app[1]].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    console.error(`skip ${sheet.name}: missing ${missing.join(", ")}`);
    continue;
  }
  const panel = ([label, file]) => `<figure><figcaption>${label}</figcaption><img src="${dataUrl(file)}"></figure>`;
  await page.setContent(`<!doctype html><style>
    body { margin: 0; padding: 24px; background: #8a8a8a; font: 600 18px system-ui; width: max-content; }
    main { display: flex; gap: 24px; align-items: flex-start; } p { margin: 0 0 16px; color: #fff; font-weight: 400; }
    figure { margin: 0; } figcaption { color: #fff; margin-bottom: 8px; } img { display: block; box-shadow: 0 2px 12px #0004; }
  </style>${sheet.note === undefined ? "" : `<p>${sheet.note}</p>`}<main>${panel(sheet.exemplar)}${panel(sheet.app)}</main>`);
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode().then(() => (img.style.width = `${img.naturalWidth / 1.5}px`)))));
  await page.screenshot({ path: join(out, `${sheet.name}.png`), fullPage: true });
  console.log(`wrote ${sheet.name}.png`);
}
await browser.close();
