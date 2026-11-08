// Captures a built Storybook as the exemplar for the design systems climb:
//
//   node scripts/capture/storybook.mjs --static <storybook build folder>
//
// Build the library's Storybook first (`storybook build --output-dir <folder>`). The shots are 1440×900 at a 1.5 display
// scale, like the app captures, and land in design-review/exemplars/storybook/.
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..", "..");
const { values } = parseArgs({ options: { static: { type: "string" } } });
if (values.static === undefined || !existsSync(join(values.static, "index.json"))) {
  console.error("usage: node scripts/capture/storybook.mjs --static <storybook build folder>");
  process.exit(1);
}
const dir = resolve(values.static);
const out = join(root, "design-review", "exemplars", "storybook");
mkdirSync(out, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, "index.html") : path;
  if (!file.startsWith(dir) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const preview = () => page.frameLocator("#storybook-preview-iframe");
async function open(id) {
  await page.goto(`${base}/?path=/story/${id}`);
  await preview().locator("#storybook-root > *").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
}
async function shot(name) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(`shot ${name}.png`);
}

try {
  await open("components-card--default");
  await shot("canvas-card");
  await open("components-button--default");
  await shot("canvas-controls");
  // Change a control, as Rob does in the workbench.
  const text = page.locator('#storybook-panel-root textarea, #storybook-panel-root input[type="text"]').first();
  if ((await text.count()) > 0) {
    await text.fill("Plan next week");
    await page.waitForTimeout(800);
  }
  await shot("controls-changed");
  await page.locator('input[placeholder*="Find"], input[type="search"]').first().fill("st");
  await page.waitForTimeout(800);
  await shot("sidebar-search");
  await open("components-accordion--default");
  await page.keyboard.press("Escape");
  await shot("canvas-accordion");
} finally {
  await browser.close();
  server.close();
}
