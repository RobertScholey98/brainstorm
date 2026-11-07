import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/**
 * How a pane's head meets what scrolls under it, at rest and scrolled `by` px: whether the head shows the colour
 * of the body under it, whether its bottom rule shows (on it or its `::after`), how far the scroller's clip starts below
 * the head's bottom edge, how many points of the head's band show the scroller's content instead of the head, and any
 * mask on the scroller or above it.
 */
export async function paneHead(window, head, body, { by = 120 } = {}) {
  await window.mouse.move(1, 1);
  return window.evaluate(
    async ([head, body, by]) => {
      const [h, b] = [document.querySelector(head), document.querySelector(body)];
      /** The colour an element shows: its own fill, or the first one behind it. */
      const fill = (el) => {
        for (; el !== null; el = el.parentElement) {
          const colour = getComputedStyle(el).backgroundColor;
          if (colour !== "rgba(0, 0, 0, 0)") return colour;
        }
        return null;
      };
      const probe = Object.assign(document.createElement("div"), { className: "border" });
      document.body.append(probe);
      const hairline = `${getComputedStyle(probe).borderTopColor} ${getComputedStyle(probe).borderTopWidth}`;
      probe.remove();
      const ruled = (style) => `${style.borderBottomColor} ${style.borderBottomWidth}` === hairline;
      const masks = [];
      for (let el = b; el !== null; el = el.parentElement) if (getComputedStyle(el).maskImage !== "none") masks.push(el.dataset.slot ?? el.tagName.toLowerCase());
      const read = async (y) => {
        b.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = h.getBoundingClientRect();
        let through = 0;
        for (let py = Math.ceil(r.top); py < r.bottom; py += 2)
          for (let px = Math.ceil(r.left); px < r.right; px += 4) if (b.contains(document.elementFromPoint(px, py))) through++;
        return {
          scrolled: b.scrollTop > 0,
          rule: ruled(getComputedStyle(h)) || ruled(getComputedStyle(h, "::after")),
          clipGap: Math.round(b.getBoundingClientRect().top - r.bottom),
          through,
        };
      };
      const result = {
        sameFill: fill(h) === fill(b),
        rest: await read(0),
        scrolled: await read(by),
        masks,
      };
      b.scrollTop = 0;
      return result;
    },
    [head, body, by],
  );
}

export async function shot(window, shots, name) {
  await window.screenshot({ path: join(shots, `${name}.png`) });
}
