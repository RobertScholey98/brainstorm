// Seeds the cyberpunk chore roulette into a Brainstorm home through the real CLI and the fake T3, the way an agent
// would: session new, pull, copy the blocks in, commit.
//
//   node scripts/seed-demo.mjs [<BRAINSTORM_HOME>]
//
// Without a home it uses $BRAINSTORM_HOME, else a new temp directory, so Rob's real store never gets a fake thread.
// The CLI starts the app if none is running on that home: the Electron window unless BRAINSTORM_APP=headless.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const demo = join(root, "scripts", "demo", "chore-roulette");

export const DEMO_THREAD = "c0ffee00-0000-4000-8000-00000000c4a1";
export const DEMO_SLOTS = [
  { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } },
  { id: "result", title: "The result", frame: { width: 390 } },
];
const BRIEF =
  "Give one chore an owner by spinning, and make the result stick. A cyberpunk phone app for a shared flat: " +
  "the pick has to feel fair, the person picked has to accept it, and the crew has to see how it was decided.";

/** The environment the CLI and the app need to reach the fake T3 thread for this home. */
export function demoEnv(home, extra = {}) {
  const statePath = join(home, "fake-t3.json");
  mkdirSync(home, { recursive: true });
  if (!existsSync(statePath)) {
    const thread = { projectId: "chore-roulette", title: "Chore roulette study", status: "completed", activeRunId: null, latestRunId: null, pendingRequestCount: 0, messages: [] };
    writeFileSync(statePath, JSON.stringify({ threads: { [DEMO_THREAD]: thread } }, null, 2));
  }
  return {
    ...process.env,
    BRAINSTORM_HOME: home,
    BRAINSTORM_T3_CLI: join(root, "test", "fake-t3", "t3.cmd"),
    BRAINSTORM_FAKE_T3_STATE: statePath,
    T3CODE_THREAD_ID: DEMO_THREAD,
    ...extra,
  };
}

/** Runs the built CLI; `json` is the parsed Result when --json was passed. */
export function brainstorm(env, args, { cwd = root } = {}) {
  const r = spawnSync(process.execPath, [join(root, "bin", "brainstorm.mjs"), ...args], { cwd, env, encoding: "utf8", timeout: 60_000 });
  let json = null;
  if (args.includes("--json")) {
    try {
      json = JSON.parse(r.stdout);
    } catch {}
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

function must(step, r) {
  if (r.code !== 0 || r.json?.ok !== true) throw new Error(`${step} failed (exit ${r.code}): ${r.stdout}${r.stderr}`);
  return r.json.data;
}

/** Creates the session and commits its first iteration. Returns the session id and the working copy it left behind. */
export function seedDemo(home, extraEnv = {}) {
  const env = demoEnv(home, extraEnv);
  const session = must("session new", brainstorm(env, ["session", "new", "--title", "Chore roulette", "--brief", BRIEF, "--json"])).session.id;
  const work = join(home, "work", session);
  must("pull", brainstorm(env, ["pull", session, "--out", work, "--json"]));
  cpSync(join(demo, "slots"), join(work, "slots"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(work, "brainstorm.json"), "utf8"));
  writeFileSync(join(work, "brainstorm.json"), `${JSON.stringify({ ...manifest, slots: DEMO_SLOTS }, null, 2)}\n`);
  const commit = must("commit", brainstorm(env, ["commit", session, "--from", work, "--note", "Three wheels and two results", "--json"]));
  return { session, work, env, iteration: commit.iteration.n };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const home = process.argv[2] ?? process.env.BRAINSTORM_HOME ?? mkdtempSync(join(tmpdir(), "brainstorm-demo-"));
  const { session, iteration } = seedDemo(home);
  process.stdout.write(`Seeded ${session} (iteration ${iteration}) in ${home}\n`);
  process.stdout.write(`To open it again later: set BRAINSTORM_HOME=${home} and run any brainstorm command.\n`);
}
