import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, inspect } from "node:util";
import { _electron } from "playwright";
import { demoEnv } from "../seed-demo.mjs";

// resolve() drops the trailing separator, which would otherwise escape the closing quote on a Windows command line.
export const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function build() {
  execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });
}

export function workspace(name) {
  const home = mkdtempSync(join(tmpdir(), `bs-${name}-`));
  const shots = join(root, "test-results", name);
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const { ELECTRON_RUN_AS_NODE: _, ...env } = demoEnv(home);
  return { home, shots, env };
}

export function checks() {
  let failures = 0;
  return {
    check(label, actual, expected) {
      if (isDeepStrictEqual(actual, expected)) {
        console.log(`ok   ${label}`);
      } else {
        failures += 1;
        console.log(`FAIL ${label}\n  expected ${inspect(expected, { depth: 8 })}\n  actual   ${inspect(actual, { depth: 8 })}`);
      }
    },
    finish() {
      if (failures > 0) {
        console.log(`${failures} check${failures === 1 ? "" : "s"} failed`);
        process.exit(1);
      }
      console.log("VERIFIED");
      process.exit(0);
    },
  };
}

/**
 * `sessions` handles the session list requests from the first load on, for launch states a running app can't reach.
 * `args` are extra Chromium switches.
 */
export async function launch(home, env, { sessions, args = [] } = {}) {
  const startedAt = Date.now();
  const app = await _electron.launch({ args: [root, ...args], env, cwd: root });
  if (sessions !== undefined) await app.context().route("**/v1/ui/sessions", sessions);
  const window = await app.firstWindow();
  const errors = [];
  window.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  window.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  const apiPath = join(home, "api.json");
  while (!existsSync(apiPath) || JSON.parse(readFileSync(apiPath, "utf8")).startedAt < new Date(startedAt).toISOString()) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const api = JSON.parse(readFileSync(apiPath, "utf8"));
  return { app, window, errors, api };
}

export async function canvasFrame(window) {
  await window.waitForSelector("iframe[title=Canvas]");
  for (;;) {
    const frame = window.frames().find((f) => f.url().endsWith("/canvas"));
    if (frame !== undefined) return frame;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function openSession(window, id) {
  await window.click(`[data-session="${id}"]`);
  await window.waitForSelector('[data-sidebar-panel="session"]');
  return canvasFrame(window);
}

/** A brainstorm opens on the stage; checks that span slots switch to the board, which then stays for that brainstorm. */
export async function showBoard(window, canvas) {
  await window.click('[data-view-option="board"]');
  await canvas.waitForSelector('#canvas[data-view="board"]');
}

/**
 * Reads `read` until it gives the same value for `quietMs`, so a check after a resize or an animation sees where the
 * layout came to rest, not a value from partway through. Gives the last value read at the timeout.
 */
export async function settled(read, { quietMs = 400, timeoutMs = 6000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = JSON.stringify(await read());
  let since = Date.now();
  while (Date.now() - since < quietMs && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    const next = JSON.stringify(await read());
    if (next !== last) [last, since] = [next, Date.now()];
  }
  return last === undefined ? undefined : JSON.parse(last);
}

export const inBlock = (blockId, part) => `div[data-bid="${blockId}"] [data-part="${part}"]`;

/**
 * What in the overlay at `selector` reaches past its box, by tag and text, once its layout has settled: empty when
 * every field, label and button sits inside it.
 */
export const outsideBox = (window, selector) =>
  settled(() =>
    window.$eval(selector, (box) => {
      const b = box.getBoundingClientRect();
      return [...box.querySelectorAll("*")]
        .filter((el) => el.getClientRects().length > 0)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < b.left - 0.5 || r.right > b.right + 0.5 || r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5;
        })
        .map((el) => `${el.tagName.toLowerCase()} ${el.textContent.trim().slice(0, 32)}`);
    }),
  );

const { PNG } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
const CONTROLS = "button, input, textarea, select, kbd, svg, img, [role=slider], [role=switch], [role=checkbox], [role=combobox]";

/**
 * The text lines and small controls in the scroller at `selector` that show in part at some scroll offset, from the
 * top to the end `step` px at a time: cut by a fade or by the scroller's edge. It reads pixels. Each offset is shot as
 * painted, unmasked (all of it shows) and transparent (none of it does); a row of a unit holds ink where the last two
 * differ, and shows where the painted shot differs from the transparent one.
 */
export async function partlyShown(window, selector, { step = 3 } = {}) {
  await window.mouse.move(1, 1);
  const pane = await window.$(selector);
  const max = await pane.evaluate((el) => el.scrollHeight - el.clientHeight);
  const found = new Map();
  for (let y = 0; ; y = Math.min(max, y + step)) {
    const { box, units } = await pane.evaluate(
      async (el, [y, controls]) => {
        el.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const b = el.getBoundingClientRect();
        const box = { x: Math.ceil(b.left), y: Math.ceil(b.top), width: Math.floor(b.width), height: Math.floor(b.height) };
        const units = [];
        const add = (r, name, grow) => {
          if (r.height < 4 || r.height > 48 || r.width < 1 || r.bottom < box.y || r.top > box.y + box.height) return;
          units.push({ name, left: r.left - grow - box.x, right: r.right + grow - box.x, top: r.top - grow - box.y, bottom: r.bottom + grow - box.y });
        };
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
          if (n.textContent.trim() === "") continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) add(r, n.textContent.trim().slice(0, 32), 0);
        }
        for (const c of el.querySelectorAll(controls)) add(c.getBoundingClientRect(), c.getAttribute("aria-label") ?? c.tagName.toLowerCase(), 2);
        return { box, units };
      },
      [y, CONTROLS],
    );
    const shots = [];
    for (const style of [{}, { "mask-image": "none" }, { "mask-image": "none", opacity: "0" }]) {
      await pane.evaluate(
        async (el, style) => {
          for (const p of ["mask-image", "opacity"]) el.style.removeProperty(p);
          for (const [p, v] of Object.entries(style)) el.style.setProperty(p, v, "important");
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        style,
      );
      shots.push(PNG.sync.read(await window.screenshot({ clip: box, scale: "css" })));
    }
    await pane.evaluate((el) => ["mask-image", "opacity"].forEach((p) => el.style.removeProperty(p)));
    const [painted, shown, hidden] = shots;
    const diff = (a, b, i) => Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    for (const u of units) {
      let [ink, on] = [0, 0];
      for (let row = Math.max(0, Math.ceil(u.top)); row < Math.min(painted.height, Math.floor(u.bottom)); row++) {
        let [inkRow, onRow] = [0, 0];
        for (let x = Math.max(0, Math.ceil(u.left)); x < Math.min(painted.width, Math.floor(u.right)); x++) {
          const i = (row * painted.width + x) * 4;
          inkRow = Math.max(inkRow, diff(shown, hidden, i));
          onRow = Math.max(onRow, diff(painted, hidden, i));
        }
        if (inkRow >= 24) [ink, on] = [ink + 1, on + (onRow >= 5 ? 1 : 0)];
      }
      const pastEdge = u.top < -1 || u.bottom > box.height + 1;
      if (on > 0 && (on < ink || pastEdge) && !found.has(u.name)) found.set(u.name, y);
    }
    if (y === max) break;
  }
  return [...found].map(([name, y]) => `${name} at ${y}`);
}

export async function shot(window, shots, name) {
  await window.screenshot({ path: join(shots, `${name}.png`) });
}
