// A stand-in for `t3 thread …`, driven by the JSON file named in BRAINSTORM_FAKE_T3_STATE:
// { "fail": false | true | ["send", "show", "list"],
//   "failAfter": ["send"],  commands that do their work and then exit 1, as when the CLI loses the reply
//   "threads": { "<threadId>": { "projectId", "title", "status", "activeRunId", "latestRunId",
//                               "pendingRequestCount", "messages": [{ "role", "runId", "text" }], "missing" } },
//   "sent": [{ "thread", "message" }] }
// Output mirrors the real shapes recorded in docs/t3-cli.md. control.mjs moves threads through runs for verify scripts.
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const statePath = process.env.BRAINSTORM_FAKE_T3_STATE;
if (!statePath) {
  process.stderr.write("BRAINSTORM_FAKE_T3_STATE is not set\n");
  process.exit(1);
}

const load = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (state) => {
  writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2));
  renameSync(`${statePath}.tmp`, statePath);
};
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const [group, command, ...rest] = process.argv.slice(2);
const flags = new Map();
const positionals = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  if (arg === "--json") flags.set("json", true);
  else if (arg.startsWith("--")) flags.set(arg.slice(2), rest[++i]);
  else positionals.push(arg);
}

const state = load();
if (group !== "thread") fail(`fake t3 implements only "thread", not "${group}"`);
if (state.fail === true || (Array.isArray(state.fail) && state.fail.includes(command))) fail("fake t3 failure: the server is not responding");

const threadJson = (id, t) => ({
  threadId: id,
  projectId: t.projectId,
  title: t.title ?? "Fake thread",
  link: `https://app.t3.codes/threads/fake/${id}`,
  createdBy: "user",
  status: t.status ?? "completed",
  latestRunId: t.latestRunId ?? null,
  activeRunId: t.activeRunId ?? null,
  pendingRequestCount: t.pendingRequestCount ?? 0,
  worktreePath: t.worktreePath ?? "C:\\fake\\worktree",
  branch: t.branch ?? "main",
  archived: false,
  settled: false,
});

const findThread = (id) => {
  const t = state.threads?.[id];
  if (t === undefined || t.missing) fail(`Thread ${id} is no longer available.`);
  return t;
};

switch (command) {
  case "show": {
    const [id] = positionals;
    const t = findThread(id);
    const count = Number(flags.get("messages") ?? 20);
    process.stdout.write(JSON.stringify({ thread: threadJson(id, t), messages: (t.messages ?? []).slice(-count) }));
    break;
  }
  case "list": {
    const project = flags.get("project");
    const threads = Object.entries(state.threads ?? {}).filter(([, t]) => !t.missing && t.projectId === project);
    if (threads.length === 0) fail(`No T3 Code project matches '${project}'. Pass a project id or a path inside a project.`);
    process.stdout.write(JSON.stringify(threads.map(([id, t]) => threadJson(id, t))));
    break;
  }
  case "send": {
    const [id, message] = positionals;
    const t = findThread(id);
    const text = message === "-" ? readFileSync(0, "utf8") : message;
    t.messages = [...(t.messages ?? []), { role: "user", runId: null, text }];
    state.sent = [...(state.sent ?? []), { thread: id, message: text }];
    save(state);
    if (state.failAfter?.includes("send")) fail("fake t3 failure: the reply was lost");
    process.stdout.write(`Sent to ${id}.\n`);
    break;
  }
  default:
    fail(`fake t3 does not implement "thread ${command}"`);
}
