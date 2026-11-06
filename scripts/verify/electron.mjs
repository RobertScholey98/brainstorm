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

export async function shot(window, shots, name) {
  await window.screenshot({ path: join(shots, `${name}.png`) });
}
