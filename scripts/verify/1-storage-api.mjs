import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, inspect } from "node:util";

const root = fileURLToPath(new URL("../..", import.meta.url));
execFileSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit" });

const tmp = mkdtempSync(join(tmpdir(), "bs-verify1-"));
const home = join(tmp, "home");
const work = join(tmp, "work");
const statePath = join(tmp, "t3.json");
mkdirSync(work);

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const thread = (projectId, title) => ({ projectId, title, status: "completed", activeRunId: null, latestRunId: null, pendingRequestCount: 0, messages: [] });
writeFileSync(
  statePath,
  JSON.stringify({ threads: { [T1]: thread("proj-a", "Design"), [T2]: thread("proj-a", "Takeover"), [T3]: thread("proj-b", "Elsewhere") } }),
);

const env = {
  ...process.env,
  BRAINSTORM_HOME: home,
  BRAINSTORM_T3_CLI: join(root, "test", "fake-t3", "t3.cmd"),
  BRAINSTORM_FAKE_T3_STATE: statePath,
  T3CODE_THREAD_ID: T1,
  BRAINSTORM_APP: "headless",
};

function cli(args, { thread: as = T1, input = "", cwd = work } = {}) {
  const r = spawnSync(process.execPath, [join(root, "bin", "brainstorm.mjs"), ...args], {
    cwd,
    env: { ...env, T3CODE_THREAD_ID: as },
    input,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const cliJson = (args, options) => {
  const r = cli([...args, "--json"], options);
  return { code: r.code, result: JSON.parse(r.stdout) };
};
const lines = (text) => text.trimEnd().split("\n").map((l) => l.replace(/\r$/, ""));

let failures = 0;
function check(label, actual, expected) {
  if (isDeepStrictEqual(actual, expected)) {
    console.log(`ok   ${label}`);
  } else {
    failures += 1;
    console.log(`FAIL ${label}\n  expected ${inspect(expected, { depth: 8 })}\n  actual   ${inspect(actual, { depth: 8 })}`);
  }
}
const api = () => JSON.parse(readFileSync(join(home, "api.json"), "utf8"));
const read = (dir, path) => readFileSync(join(dir, ...path.split("/")), "utf8");

const neonTsx = `import { useState } from "react";

export default function Wheel({ people, spinSeconds, accent }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <div className="wheel" style={{ "--accent": accent, "--spin": \`\${spinSeconds}s\` }}>
      {people.map((p) => (
        <span key={p.name} data-part={\`slice-\${p.name}\`}>{p.name}</span>
      ))}
      <button data-part="spin-button" onClick={() => setSpinning(true)}>{spinning ? "…" : "Spin"}</button>
    </div>
  );
}
`;
const neonJson = `${JSON.stringify(
  {
    title: "Neon wheel",
    props: {
      data: { people: { type: "data", description: "household members", sample: [{ name: "Kai" }, { name: "Roz" }] } },
      appearance: {
        spinSeconds: { type: "number", label: "Spin time", default: 1.5, min: 0.3, max: 5, step: 0.1, unit: "s" },
        accent: { type: "color", label: "Accent", default: "#ff2bd6" },
      },
    },
  },
  null,
  2,
)}\n`;
const sheetTsx = `export default function Sheet({ winner, headline }) {
  return (
    <section className="sheet">
      <h2 data-part="headline">{headline}</h2>
      <p data-part="winner">{winner}</p>
    </section>
  );
}
`;
const sheetJson = `${JSON.stringify(
  {
    title: "Result sheet",
    props: { data: { winner: { type: "data", sample: "Kai" } }, appearance: { headline: { type: "text", label: "Headline", default: "Who's up?" } } },
  },
  null,
  2,
)}\n`;
const blocks = {
  "slots/wheel/neon/block.tsx": neonTsx,
  "slots/wheel/neon/block.json": neonJson,
  "slots/wheel/neon/block.css": ".wheel { color: var(--accent); }\n",
  "slots/wheel/neon/about.md": "Loud and fast: tests whether energy makes chores feel fair.\n",
  "slots/result/sheet/block.tsx": sheetTsx,
  "slots/result/sheet/block.json": sheetJson,
};
const slots = [
  { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } },
  { id: "result", title: "Result" },
];
function writeCopy(dir, session, base, files = blocks) {
  writeFileSync(join(dir, "brainstorm.json"), JSON.stringify({ format: 1, session, base, slots }, null, 2));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split("/")), text);
  }
}

try {
  const created = cli(["session", "new", "--title", "Chore wheel", "--brief", "-"], { input: "Pick who does the chores\n" });
  const S = lines(created.stdout)[0];
  check("session new exits 0 and prints the session id first", [created.code, /^s_[0-9a-z]{8}$/.test(S)], [0, true]);
  check("session new prints what it created", lines(created.stdout).slice(1), [
    `created "Chore wheel" in project proj-a, attached to thread ${T1}`,
    `next: brainstorm pull ${S}`,
  ]);
  check("the CLI started the server and wrote api.json", existsSync(join(home, "api.json")), true);
  const firstPid = api().pid;

  const list = cliJson(["session", "list"]);
  check("session list returns the thread's project's sessions", [list.code, list.result], [
    0,
    {
      ok: true,
      data: [
        {
          id: S,
          projectId: "proj-a",
          projectName: null,
          title: "Chore wheel",
          brief: "Pick who does the chores",
          createdAt: list.result.data[0].createdAt,
          attachedThread: T1,
          lost: false,
          latest: null,
          activeAt: list.result.data[0].createdAt,
        },
      ],
    },
  ]);

  const context = cliJson(["context", S]);
  check("context reports the empty session and the next commands", [context.code, context.result.data.attached, context.result.data.latest, context.result.data.request, context.result.data.next], [
    0,
    true,
    null,
    null,
    [`brainstorm pull ${S}`, `brainstorm validate ${S}`, `brainstorm commit ${S}`],
  ]);
  check("context text ends with the exact next commands", lines(cli(["context", S]).stdout).slice(-4), [
    "next:",
    `  brainstorm pull ${S}`,
    `  brainstorm validate ${S}`,
    `  brainstorm commit ${S}`,
  ]);

  const copy = join(work, ".brainstorm", S);
  const pulled = cli(["pull", S]);
  check("pull writes an empty working copy to .brainstorm/<session>", [pulled.code, lines(pulled.stdout)], [0, [`wrote an empty working copy of ${S} to ${copy}`]]);
  check("the empty copy names the session with base null", JSON.parse(read(copy, "brainstorm.json")), { format: 1, session: S, base: null, slots: [] });
  check("pull writes the generated guide and ignore file", [existsSync(join(copy, "GUIDE.md")), read(copy, ".gitignore")], [true, "*\n"]);

  writeCopy(copy, S, null);
  const validated = cli(["validate", S]);
  check("validate accepts a two-slot copy", [validated.code, lines(validated.stdout)], [0, ["ok: a commit would create an iteration · changed result/sheet, wheel/neon"]]);

  const committed = cliJson(["commit", S, "--note", "first cut"]);
  check("commit creates iteration 1 with both blocks", [committed.code, committed.result.data.created, committed.result.data.iteration.n, committed.result.data.iteration.changed, committed.result.data.warnings], [
    0,
    true,
    1,
    ["result/sheet", "wheel/neon"],
    [],
  ]);
  check("commit rewrites base in the working copy", JSON.parse(read(copy, "brainstorm.json")).base, 1);
  check("an unchanged commit is an idempotent replay", lines(cli(["commit", S]).stdout), ["nothing changed; iteration 1 is still the latest"]);

  const fresh = join(work, "fresh");
  const repulled = cli(["pull", S, "--out", fresh]);
  check("pull --out writes iteration 1", [repulled.code, lines(repulled.stdout)], [0, [`wrote iteration 1 of ${S} to ${fresh}`]]);
  check("pull round-trips every block file byte for byte", Object.fromEntries(Object.keys(blocks).map((p) => [p, read(fresh, p)])), blocks);
  check("pull round-trips the manifest", JSON.parse(read(fresh, "brainstorm.json")), {
    format: 1,
    session: S,
    base: 1,
    slots: [
      { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } },
      { id: "result", title: "Result", frame: { width: 390 } },
    ],
  });

  const bad = join(work, "bad");
  cpSync(fresh, bad, { recursive: true });
  writeFileSync(join(bad, "slots", "wheel", "neon", "block.tsx"), "export default function Wheel() { return <div>; }\n");
  writeFileSync(
    join(bad, "slots", "result", "sheet", "block.json"),
    JSON.stringify({ title: "Result sheet", props: { appearance: { size: { type: "number", label: "Size", default: 1, min: 5, max: 2 } } } }),
  );
  writeFileSync(join(bad, "slots", "wheel", "neon", "helpers.ts"), "export const x = 1;\n");
  const rejected = cliJson(["commit", S, "--from", bad]);
  check("validation_failed lists every error in one response", [rejected.code, rejected.result.error.code, rejected.result.error.issues.map((i) => [i.code, i.file])], [
    1,
    "validation_failed",
    [
      ["unexpected_file", "slots/wheel/neon/helpers.ts"],
      ["invalid_prop", "slots/result/sheet/block.json"],
      ["compile_error", "slots/wheel/neon/block.tsx"],
    ],
  ]);
  check("validation errors print compiler-style", lines(cli(["validate", S, "--from", bad]).stderr).slice(1), [
    "slots/result/sheet/block.json#/props/appearance/size/max: error invalid_prop: max (2) must be greater than min (5)",
    "slots/wheel/neon/block.tsx:1:48: error compile_error: Unexpected token",
    "error validation_failed: 3 errors; nothing was saved",
  ]);

  const wrongProject = cliJson(["session", "attach", S], { thread: T3 });
  check("attach refuses a thread from another project", [wrongProject.code, wrongProject.result.error], [
    1,
    {
      code: "wrong_project",
      message: `session ${S} ("Chore wheel") belongs to project proj-a, but thread ${T3} is in project proj-b`,
      sessionProject: "proj-a",
      threadProject: "proj-b",
    },
  ]);

  const flow = lines(cli(["session", "new", "--title", "Onboarding flow", "--brief", "First run", "--project", "."]).stdout)[0];
  const copyS = lines(cli(["session", "new", "--title", "Onboarding copy"]).stdout)[0];
  const ambiguous = cli(["session", "attach", "onboarding"], { thread: T2 });
  check("attach lists candidates for an ambiguous title", [ambiguous.code, lines(ambiguous.stderr)], [
    1,
    ['error ambiguous_title: "onboarding" matches 2 sessions; attach by id', `  ${flow}  "Onboarding flow"`, `  ${copyS}  "Onboarding copy"`],
  ]);

  const takeover = cli(["session", "attach", "chore wheel"], { thread: T2 });
  check("attach resolves a title and takes the session over", [takeover.code, lines(takeover.stdout)], [
    0,
    [`attached ${S} "Chore wheel" to thread ${T2}, taking it over from ${T1}`, `next: brainstorm context ${S}`],
  ]);

  const notAttached = cliJson(["commit", S, "--from", fresh], { thread: T1 });
  check("commit refuses the thread that lost the session and names the owner", [notAttached.code, notAttached.result.error], [
    1,
    {
      code: "thread_not_attached",
      message: `session ${S} is attached to thread ${T2}, not ${T1}; run brainstorm session attach ${S} from this thread to take it over`,
      owner: T2,
    },
  ]);

  writeFileSync(join(fresh, "slots", "result", "sheet", "block.tsx"), sheetTsx.replace("<section", '<section data-part="sheet"'));
  check("the new owner commits iteration 2", lines(cli(["commit", S, "--from", fresh, "--note", "framed the sheet"], { thread: T2 }).stdout), [
    "iteration 2 · 2 blocks · changed result/sheet; created",
  ]);
  writeFileSync(join(copy, "slots", "wheel", "neon", "about.md"), "Edited on a stale copy.\n");
  const stale = cliJson(["commit", S], { thread: T2 });
  check("a copy based on an older iteration is stale", [stale.code, stale.result.error.code, stale.result.error.base, stale.result.error.latest], [1, "stale_working_copy", 1, 2]);

  check("a command with no thread is a usage error that names the variable", [cli(["commit", S], { thread: "" }).code, lines(cli(["commit", S], { thread: "" }).stderr)], [
    2,
    ["error usage: this command needs a thread; pass --thread <id> or set T3CODE_THREAD_ID"],
  ]);
  check("a bad session id is a usage error", cli(["pull", "nope"]).code, 2);
  const unknownFeedback = cliJson(["commit", S, "--from", fresh, "--addresses", "4,7"], { thread: T2 });
  check("--addresses must name existing feedback", [unknownFeedback.code, unknownFeedback.result.error], [
    1,
    { code: "not_found", entity: "feedback", message: `no feedback #4, #7 in ${S}` },
  ]);
  writeFileSync(join(tmp, "not-a-dir"), "");
  const noHome = spawnSync(process.execPath, [join(root, "bin", "brainstorm.mjs"), "session", "list"], {
    cwd: work,
    env: { ...env, BRAINSTORM_HOME: join(tmp, "not-a-dir", "home") },
    encoding: "utf8",
  });
  check("an app that can't start exits 3", [noHome.status, lines(noHome.stderr)[0].startsWith("error unavailable: couldn't create")], [3, true]);

  process.kill(firstPid);
  for (let i = 0; i < 50 && isAlive(firstPid); i++) await new Promise((r) => setTimeout(r, 100));
  check("the server is gone", isAlive(firstPid), false);
  const afterRestart = cliJson(["session", "list"], { thread: T2 });
  check("the CLI restarted the server and the data persisted", [
    afterRestart.code,
    afterRestart.result.data.map((s) => [s.id, s.title, s.latest, s.attachedThread]),
    api().pid !== firstPid,
  ], [
    0,
    [
      [S, "Chore wheel", 2, T2],
      [flow, "Onboarding flow", null, T1],
      [copyS, "Onboarding copy", null, T1],
    ],
    true,
  ]);
} finally {
  if (existsSync(join(home, "api.json"))) {
    try {
      process.kill(api().pid);
    } catch {}
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

await new Promise((r) => setTimeout(r, 300));
rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
if (failures > 0) {
  console.log(`${failures} check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log("VERIFIED");
