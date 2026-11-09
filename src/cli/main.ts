import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { brainstormHome, readApi, type ApiInfo } from "../server/appData";
import {
  parseFeedbackId,
  parseSessionId,
  parseThreadId,
  splitBlockId,
  type AgentContext,
  type AttachResult,
  type CommitResult,
  type Failure,
  type Feedback,
  type FeedbackId,
  type FileMap,
  type Issue,
  type IterationSummary,
  type NewSessionResult,
  type ProjectListing,
  type PullResult,
  type Result,
  type SessionId,
  type SessionListing,
  type ThreadId,
  type SystemCheck,
  type SystemChoice,
  type SystemImport,
  type SystemListing,
  type SystemView,
  type ValidateResult,
  type VaryScope,
} from "../core/types";
import { changedText, scopeText } from "../core/machines";
import { ownedByPull, withBase, workingCopySession } from "../core/workingCopy";

const MAX_FILES = 300;
const MAX_BYTES = 4 * 1024 * 1024;
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);
const START_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 1500;

const EXIT = { ok: 0, rejected: 1, usage: 2, unavailable: 3 } as const;

const USAGE = `usage:
  brainstorm session new     --title <t> [--brief -|<text>] [--thread <id>] [--project <path>] [--system <id|name|none>]
  brainstorm session list    [--thread <id>]
  brainstorm session attach  <id|title> [--thread <id>]
  brainstorm context         <session> [--thread <id>]
  brainstorm pull            <session> [--out <dir>]
  brainstorm validate        <session> [--from <dir>] [--thread <id>]
  brainstorm commit          <session> [--from <dir>] [--thread <id>] [--addresses 4,7] [--note <text>]
  brainstorm system list
  brainstorm system add      <package folder|project root> [--name <n>] [--frame <export>] [--thread <id>]
  brainstorm system sync     <system>
  brainstorm system show     <system>
  brainstorm system check    <project root>
  brainstorm system import   <folder>
  brainstorm project show    [--thread <id>]
  brainstorm project use     <system|none> [--thread <id>] [--project <path>]
Every command takes --json. --thread defaults to $T3CODE_THREAD_ID; --out and --from default to .brainstorm/<session>.
session new builds with the project's design system (project show) unless --system names another, or none.`;

/** `exit` overrides the code the result gives, for a command that succeeds in reporting a failure, like `system check`. */
type Output = { readonly result: Result<unknown>; readonly lines: readonly string[]; readonly exit?: number };

const usage = (message: string): Failure => ({ code: "usage", message });
const failed = (error: Failure): Output => ({ result: { ok: false, error }, lines: [] });

const repoRoot = (): string => resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function healthy(api: ApiInfo): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${api.port}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const body = (await res.json()) as { ok?: boolean; data?: { pid?: number } };
    return body.ok === true && body.data?.pid === api.pid;
  } catch {
    return false;
  }
}

function launch(home: string): void {
  const root = repoRoot();
  const log = openSync(join(home, "server.log"), "a");
  const headless = process.env.BRAINSTORM_APP === "headless";
  // An installed app runs this CLI on its own Electron binary in node mode (resources/bin/brainstorm), so that binary
  // is the app; a packaged Electron ignores the path argument and always loads resources/app.
  const electron = process.versions.electron !== undefined ? process.execPath : (createRequire(join(root, "package.json"))("electron") as string);
  const [command, args] = headless
    ? [process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "dist", "server", "headless.js")]]
    : [electron, [root]];
  // An agent running inside an Electron host such as T3 can inherit this, which would make electron run as plain node.
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  // stdout carries the UI URL with its token, which must never reach disk; only stderr is logged.
  spawn(command, args, { detached: true, stdio: ["ignore", "ignore", log], windowsHide: headless, env }).unref();
  closeSync(log);
}

async function connect(): Promise<ApiInfo | Failure> {
  const home = brainstormHome();
  const current = readApi(home);
  if (current !== null && (await healthy(current))) return current;

  try {
    mkdirSync(home, { recursive: true });
  } catch (e) {
    return { code: "unavailable", message: `couldn't create ${home}: ${(e as Error).message}` };
  }
  const lock = join(home, "start.lock");
  let owner = false;
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
    owner = true;
  } catch {
    // Another CLI is starting the app. A lock older than the start timeout is left over from a crash.
    // A lock that vanished meanwhile means its owner finished starting, so waiting below finds the app.
    const held = statSync(lock, { throwIfNoEntry: false });
    if (held !== undefined && Date.now() - held.mtimeMs > START_TIMEOUT_MS) {
      writeFileSync(lock, String(process.pid));
      owner = true;
    }
  }
  try {
    if (owner) launch(home);
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const api = readApi(home);
      if (api !== null && api.pid !== current?.pid && (await healthy(api))) return api;
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    if (owner) rmQuietly(lock);
  }
  return {
    code: "unavailable",
    message: `Brainstorm didn't start within ${START_TIMEOUT_MS / 1000} s; see ${join(home, "server.log")}`,
  };
}

function rmQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<Result<T>> {
  const api = await connect();
  if ("code" in api) return { ok: false, error: api };
  try {
    const res = await fetch(`http://127.0.0.1:${api.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${api.agentToken}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as Result<T>;
  } catch (e) {
    return { ok: false, error: { code: "unavailable", message: `couldn't reach Brainstorm: ${(e as Error).message}` } };
  }
}

function readCopy(root: string): Result<FileMap> {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { ok: false, error: usage(`there is no working copy at ${root}; run brainstorm pull <session> first`) };
  }
  const files: Record<string, string> = {};
  let bytes = 0;
  const walk = (dir: string): Failure | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        const failure = walk(path);
        if (failure !== null) return failure;
      } else if (entry.isFile()) {
        const text = readFileSync(path, "utf8");
        bytes += Buffer.byteLength(text);
        files[relative(root, path).split(sep).join("/")] = text;
        if (Object.keys(files).length > MAX_FILES) return usage(`${root} has more than ${MAX_FILES} files; a working copy holds only blocks`);
        if (bytes > MAX_BYTES) return usage(`${root} holds more than ${MAX_BYTES / 1024 / 1024} MB; a working copy holds only blocks`);
      }
    }
    return null;
  };
  const failure = walk(root);
  return failure === null ? { ok: true, data: files } : { ok: false, error: failure };
}

function writeFiles(root: string, files: FileMap): void {
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

function pruneEmptyDirs(dir: string, root: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) pruneEmptyDirs(join(dir, entry.name), root);
  }
  if (dir !== root && readdirSync(dir).length === 0) rmdirSync(dir);
}

function writePull(root: string, session: SessionId, files: FileMap): Failure | null {
  if (existsSync(root)) {
    const existing = readCopy(root);
    const paths = existing.ok ? Object.keys(existing.data) : [];
    if (!existing.ok || (paths.length > 0 && workingCopySession(existing.data) !== session)) {
      return usage(`${root} is not empty and isn't a working copy of ${session}; pass --out with another directory`);
    }
    for (const path of paths.filter(ownedByPull)) unlinkSync(join(root, ...path.split("/")));
    pruneEmptyDirs(root, root);
  }
  writeFiles(root, files);
  return null;
}

function issueLine(i: Issue): string {
  const where = i.file === null ? "brainstorm" : `${i.file}${i.loc === null ? "" : `:${i.loc.line}:${i.loc.column}`}${i.pointer === null ? "" : `#${i.pointer}`}`;
  const line = `${where}: ${i.severity} ${i.code}: ${i.message}`;
  // A warning that lists many values (off-scale classes, storyless components) puts one per line, so each reads alone.
  const listed = LISTING_CODES.has(i.code) ? /^(.*?): (.+)$/.exec(i.message) : null;
  const items = listed === null ? [] : splitTopLevel(listed[2]!);
  if (listed === null || items.length < 4) return line;
  return [`${where}: ${i.severity} ${i.code}: ${listed[1]}:`, ...items.map((item) => `    ${item}`)].join("\n");
}

const LISTING_CODES = new Set(["off_scale", "no_story"]);

/** Splits "a (x, y), b and 3 more" at its commas, leaving those inside brackets alone. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0 && text[i + 1] === " ") {
      out.push(text.slice(start, i));
      start = i + 2;
    }
  }
  out.push(text.slice(start));
  return out;
}

function failureLines(error: Failure): string[] {
  const head = `error ${error.code}: ${error.message}`;
  switch (error.code) {
    case "validation_failed":
      return [...error.issues.map(issueLine), head];
    case "ambiguous_title":
      return [head, ...error.candidates.map((c) => `  ${c.id}  "${c.title}"`)];
    default:
      return [head];
  }
}

const iterationText = (i: IterationSummary) => `iteration ${i.n} · ${i.blocks.length} block${i.blocks.length === 1 ? "" : "s"} · ${changedText(i.changed)}`;
const feedbackLine = (f: Feedback) =>
  `  #${f.id} ${f.pin.blockId}${f.pin.part === null ? "" : ` [${f.pin.part}]`}: ${f.text}${f.status.state === "addressed" ? ` (addressed in ${f.status.in})` : ""}`;

/** What a vary asks, spelled out: copies of one block that differ only at one element, under names the app chose. */
function varyLines(scope: VaryScope): string[] {
  const { slot } = splitBlockId(scope.target.blockId);
  const where = scope.target.part === null ? "the whole block" : `only data-part "${scope.target.part}"`;
  return [
    `  vary: add ${scope.variants.length} new variants to slot ${slot}, each a copy of ${scope.target.blockId} that changes ${where}`,
    ...scope.variants.map((v) => `  new variant ${slot}/${v.key} titled "${v.title}"`),
    "  keep every existing variant as it is",
  ];
}

function contextLines(c: AgentContext): string[] {
  const r = c.request;
  return [
    `session ${c.session.id} "${c.session.title}"`,
    ...(c.session.brief === "" ? [] : [`brief: ${c.session.brief}`]),
    ...(c.fork === null
      ? []
      : [
          `fork of ${c.fork.parent.id} "${c.fork.parent.title}" iteration ${c.fork.from}: iteration 1 is that iteration narrowed to Rob's picks`,
          ...c.fork.baked.map((b) => `  baked default ${b.blockId} ${b.prop} = ${JSON.stringify(b.value)}`),
        ]),
    c.attached ? `attached: this thread (${c.attachedThread})` : `attached: thread ${c.attachedThread}, not this one`,
    ...(c.system === null
      ? []
      : [
          `design system: ${c.system.name} v${c.system.n}. Blocks compose only its kit (import from "kit"); pull writes system/CATALOG.md and its stories.`,
        ]),
    `latest: ${c.latest === null ? "no iterations yet" : iterationText(c.latest)}`,
    ...(r === null
      ? ["request: none open"]
      : [
          `request ${r.n} · base ${r.base ?? "none"} · scope: ${scopeText(r.scope)}${r.freetext === null ? "" : ` · freetext: ${JSON.stringify(r.freetext)}`}`,
          ...(r.scope.kind === "vary" ? varyLines(r.scope) : []),
          ...r.feedback.map(feedbackLine),
          ...r.overrides.map((o) => `  override ${o.blockId} ${o.prop} = ${JSON.stringify(o.value)}`),
        ]),
    `open feedback:${c.feedback.open.length === 0 ? " none" : ""}`,
    ...c.feedback.open.map(feedbackLine),
    `addressed feedback:${c.feedback.addressed.length === 0 ? " none" : ""}`,
    ...c.feedback.addressed.map(feedbackLine),
    "",
    c.controlVocabulary,
    "",
    "next:",
    ...c.next.map((n) => `  ${n}`),
  ];
}

type Flags = { readonly [name: string]: string | boolean | undefined };
type Parsed = { readonly flags: Flags; readonly positionals: readonly string[] };
type Command = {
  readonly options: NonNullable<ParseArgsConfig["options"]>;
  readonly positionals: readonly string[];
  readonly run: (args: Parsed) => Promise<Output>;
};

const str = (flags: Flags, name: string): string | undefined => {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
};

function threadFrom(flags: Flags, options: { required: true }): ThreadId | Failure;
function threadFrom(flags: Flags, options: { required: false }): ThreadId | null | Failure;
function threadFrom(flags: Flags, { required }: { required: boolean }): ThreadId | null | Failure {
  const raw = str(flags, "thread") ?? process.env.T3CODE_THREAD_ID;
  if (raw === undefined || raw === "") {
    return required ? usage("this command needs a thread; pass --thread <id> or set T3CODE_THREAD_ID") : null;
  }
  return parseThreadId(raw) ?? usage(`"${raw}" is not a T3 thread id`);
}

/**
 * The thread's project folder: --project, or this folder when the thread is the agent's own. --thread can name another
 * project's thread, and this folder would then name the wrong repo for it.
 */
const folderOf = (flags: Flags): string | null => {
  const named = str(flags, "project");
  if (named !== undefined) return resolve(named);
  const thread = str(flags, "thread");
  return thread === undefined || thread === process.env.T3CODE_THREAD_ID ? resolve(".") : null;
};

function sessionFrom(raw: string | undefined): SessionId | Failure {
  return parseSessionId(raw ?? "") ?? usage(`"${raw}" is not a session id (s_…)`);
}

const isFailure = (v: unknown): v is Failure => typeof v === "object" && v !== null && "code" in v && "message" in v;

const copyDir = (flags: Flags, name: string, session: SessionId) => resolve(str(flags, name) ?? join(".brainstorm", session));

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const threadOption = { thread: { type: "string" } } as const;

type SyncOutcome = { readonly system: SystemView; readonly created: boolean; readonly warnings: readonly Issue[] };

const versionLine = (s: SystemListing) =>
  s.latest === null
    ? "never synced"
    : `v${s.latest.n} · ${s.latest.components} components · ${s.latest.stories} stories${s.latest.failedStories > 0 ? ` (${s.latest.failedStories} failed)` : ""}${s.review?.state === "pending" ? " · awaiting Rob's review" : ""}`;

function syncLines({ system, created, warnings }: SyncOutcome, verb: string): string[] {
  return [
    // Files read best from the library's root, as its author knows them.
    ...warnings.map((w) => issueLine(w.file === null ? w : { ...w, file: relative(system.root, w.file).split(sep).join("/") })),
    created ? `${verb} ${system.id} "${system.name}" ${versionLine(system)}` : `nothing changed; ${system.id} is still ${versionLine(system)}`,
    ...(system.review?.state === "pending" ? ["Rob reviews it on Brainstorm's Design systems page; brainstorms can use it once Rob confirms it"] : []),
  ];
}

const systemRef = (raw: string | undefined) => encodeURIComponent(raw ?? "");

/** `--system` and `project use` take "none", in any case, for no design system. A system named so is reachable by its id. */
const isNone = (ref: string) => ref.trim().toLowerCase() === "none";

const projectLine = (p: ProjectListing): string =>
  `${p.name === null ? "this project" : `project ${p.name}`}: ${
    p.system === null
      ? "no design system; its brainstorms are freeform"
      : `brainstorms build with ${p.system.name} (${p.system.id})${p.system.awaitingReview ? ", once Rob confirms it on Brainstorm's Design systems page" : ""}`
  }`;

const COMMANDS: Record<string, Command> = {
  "system list": {
    options: {},
    positionals: [],
    async run() {
      const result = await call<SystemListing[]>("GET", "/v1/agent/systems");
      return {
        result,
        lines: !result.ok
          ? []
          : result.data.length === 0
            ? ["no design systems; add one with brainstorm system add <package folder>"]
            : result.data.map((s) => `${s.id}  "${s.name}"  ${versionLine(s)}  ${s.root}`),
      };
    },
  },
  "system add": {
    options: { name: { type: "string" }, frame: { type: "string" }, ...threadOption },
    positionals: ["package folder"],
    async run({ flags, positionals }) {
      const thread = threadFrom(flags, { required: false });
      if (isFailure(thread)) return failed(thread);
      const result = await call<SyncOutcome>("POST", "/v1/agent/systems", {
        path: resolve(positionals[0] ?? "."),
        name: str(flags, "name") ?? null,
        frame: str(flags, "frame") ?? null,
        thread,
        projectPath: thread === null ? null : folderOf(flags),
      });
      if (!result.ok) return { result, lines: [] };
      const s = result.data.system;
      const projects = s.projects.map((p) => p.name ?? p.id).join(", ");
      // A project with a system keeps it, so say so rather than let the agent assume the new one took over.
      const own = thread === null ? null : await call<ProjectListing>("GET", `/v1/agent/project-system?thread=${thread}`);
      const kept = own?.ok === true && own.data.system !== null && own.data.system.id !== s.id ? own.data.system : null;
      return {
        result,
        lines: [
          ...syncLines(result.data, "added"),
          ...(kept !== null
            ? [`this project keeps ${kept.name} (${kept.id}); brainstorm project use ${s.id} switches it`]
            : projects === ""
              ? [`no project builds with it yet; brainstorm project use ${s.id} sets one`]
              : []),
          ...(projects === "" ? [] : [`brainstorms on ${projects} build with it`]),
          // A new system always awaits Rob's review, and brainstorms refuse it until he confirms it.
          "next: report to Rob and wait; Rob's review may send changes back to this thread",
        ],
      };
    },
  },
  "system sync": {
    options: {},
    positionals: ["system"],
    async run({ positionals }) {
      const result = await call<SyncOutcome>("POST", `/v1/agent/systems/${systemRef(positionals[0])}/sync`);
      return { result, lines: result.ok ? syncLines(result.data, "synced") : [] };
    },
  },
  "system check": {
    options: {},
    positionals: ["project root"],
    async run({ positionals }) {
      const root = resolve(positionals[0] ?? ".");
      const result = await call<SystemCheck>("POST", "/v1/agent/system-check", { path: root });
      if (!result.ok) return { result, lines: [] };
      const c = result.data;
      const rel = (i: Issue) => issueLine(i.file === null ? i : { ...i, file: relative(c.root, i.file).split(sep).join("/") || "." });
      const tiers = ["layout", "composite", "primitive"] as const;
      return {
        result,
        exit: c.passed ? EXIT.ok : EXIT.rejected,
        lines: [
          ...c.gates.flatMap((g) => [`${g.passed ? "pass" : "FAIL"}  ${g.gate}`, ...g.issues.map((i) => `      ${rel(g.passed ? i : { ...i, severity: "error" })}`)]),
          ...(c.warnings.length === 0 ? [] : ["warnings:", ...c.warnings.map((w) => `      ${rel(w)}`)]),
          ...tiers.flatMap((t) => {
            const list = c.components.filter((x) => x.tier === t);
            return list.length === 0 ? [] : [`${t}s: ${list.map((x) => (x.stories === 0 ? `${x.name} (no story)` : x.name)).join(", ")}`];
          }),
          c.passed ? `every gate passes; next: brainstorm system add ${c.root}` : "fix the failing gates, then run the check again",
        ],
      };
    },
  },
  "system import": {
    options: {},
    positionals: ["folder"],
    async run({ positionals }) {
      const result = await call<SystemImport>("POST", "/v1/agent/system-imports", { path: resolve(positionals[0] ?? ".") });
      if (!result.ok) return { result, lines: [] };
      const i = result.data;
      return {
        result,
        lines: [i.state === "started" ? `importing ${i.root} in thread ${i.thread}${i.link === null ? "" : ` (${i.link})`}` : i.state === "failed" ? `couldn't start the import: ${i.error}` : `starting the import of ${i.root}`],
        ...(i.state === "failed" ? { exit: EXIT.rejected } : {}),
      };
    },
  },
  "system show": {
    options: {},
    positionals: ["system"],
    async run({ positionals }) {
      const result = await call<SystemView>("GET", `/v1/agent/systems/${systemRef(positionals[0])}`);
      if (!result.ok) return { result, lines: [] };
      const s = result.data;
      return {
        result,
        lines: [
          `${s.id} "${s.name}" ${versionLine(s)}`,
          `source: ${s.source.adapter ?? s.source.entry ?? s.root}${s.source.css === null ? "" : ` · css ${s.source.css}`}${s.source.frame === null ? "" : ` · frame ${s.source.frame}`}`,
          `components: ${(s.manifest?.catalog ?? []).map((e) => (e.generated ? `${e.name} (Brainstorm's)` : e.name)).join(", ")}`,
          `theme axes: ${(s.manifest?.styles.axes ?? []).map((a) => `${a.attribute} = ${a.values.join("|")}`).join("; ") || "none"}`,
          `saved themes: ${s.themes.map((t) => t.name).join(", ") || "none"}`,
          ...(s.latest?.warnings ?? []).map(issueLine),
        ],
      };
    },
  },
  "session new": {
    options: { title: { type: "string" }, brief: { type: "string" }, project: { type: "string" }, system: { type: "string" }, ...threadOption },
    positionals: [],
    async run({ flags }) {
      const title = str(flags, "title");
      if (title === undefined || title.trim() === "") return failed(usage("session new needs --title <t>"));
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const briefFlag = str(flags, "brief");
      const brief = briefFlag === "-" ? (await readStdin()).trim() : (briefFlag ?? "");
      const named = str(flags, "system");
      const system: SystemChoice = named === undefined ? { kind: "project" } : isNone(named) ? { kind: "none" } : { kind: "named", ref: named };
      const result = await call<NewSessionResult>("POST", "/v1/agent/sessions", {
        title,
        brief,
        thread,
        project: folderOf(flags),
        system,
      });
      if (!result.ok) return { result, lines: [] };
      const { session, attachment, system: chosen } = result.data;
      return {
        result,
        lines: [
          session.id,
          `created "${session.title}" in project ${session.projectId}, attached to thread ${attachment.threadId}`,
          chosen !== null
            ? `design system: ${chosen.name} (${chosen.id}) v${chosen.n}${chosen.from === "project" ? ", this project's" : ""}`
            : system.kind === "none"
              ? "design system: none, as asked"
              : "design system: none; this project has none set (brainstorm project use <system> sets one)",
          `next: brainstorm pull ${session.id}`,
        ],
      };
    },
  },
  "project show": {
    options: threadOption,
    positionals: [],
    async run({ flags }) {
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const result = await call<ProjectListing>("GET", `/v1/agent/project-system?thread=${thread}`);
      return { result, lines: result.ok ? [projectLine(result.data)] : [] };
    },
  },
  "project use": {
    options: { project: { type: "string" }, ...threadOption },
    positionals: ["system|none"],
    async run({ flags, positionals }) {
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const ref = positionals[0] ?? "";
      const result = await call<ProjectListing>("POST", "/v1/agent/project-system", {
        thread,
        project: folderOf(flags),
        system: isNone(ref) ? null : ref,
      });
      return { result, lines: result.ok ? [projectLine(result.data)] : [] };
    },
  },
  "session list": {
    options: threadOption,
    positionals: [],
    async run({ flags }) {
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const result = await call<SessionListing[]>("GET", `/v1/agent/sessions?thread=${thread}`);
      return {
        result,
        lines: !result.ok
          ? []
          : result.data.length === 0
            ? ["no sessions in this thread's project"]
            : result.data.map(
                (s) =>
                  `${s.id}  "${s.title}"  ${s.latest === null ? "no iterations" : `iteration ${s.latest}`}  thread ${s.attachedThread}${s.attachedThread === thread ? " (this one)" : ""}${s.lost ? " (lost)" : ""}`,
              ),
      };
    },
  },
  "session attach": {
    options: threadOption,
    positionals: ["id|title"],
    async run({ flags, positionals }) {
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const result = await call<AttachResult>("POST", "/v1/agent/attach", { ref: positionals[0], thread });
      return {
        result,
        lines: result.ok
          ? [
              `attached ${result.data.session.id} "${result.data.session.title}" to thread ${thread}${result.data.previous === null ? "" : `, taking it over from ${result.data.previous}`}`,
              `next: brainstorm context ${result.data.session.id}`,
            ]
          : [],
      };
    },
  },
  context: {
    options: threadOption,
    positionals: ["session"],
    async run({ flags, positionals }) {
      const session = sessionFrom(positionals[0]);
      if (isFailure(session)) return failed(session);
      const thread = threadFrom(flags, { required: false });
      if (isFailure(thread)) return failed(thread);
      const result = await call<AgentContext>("GET", `/v1/agent/sessions/${session}/context${thread === null ? "" : `?thread=${thread}`}`);
      return { result, lines: result.ok ? contextLines(result.data) : [] };
    },
  },
  pull: {
    options: { out: { type: "string" } },
    positionals: ["session"],
    async run({ flags, positionals }) {
      const session = sessionFrom(positionals[0]);
      if (isFailure(session)) return failed(session);
      const result = await call<PullResult>("GET", `/v1/agent/sessions/${session}/pull`);
      if (!result.ok) return { result, lines: [] };
      const dir = copyDir(flags, "out", session);
      const refused = writePull(dir, session, result.data.files);
      if (refused !== null) return failed(refused);
      const what = result.data.iteration === null ? `an empty working copy of ${session}` : `iteration ${result.data.iteration} of ${session}`;
      return { result: { ok: true, data: { dir, iteration: result.data.iteration } }, lines: [`wrote ${what} to ${dir}`] };
    },
  },
  validate: {
    options: { from: { type: "string" }, ...threadOption },
    positionals: ["session"],
    async run({ flags, positionals }) {
      const session = sessionFrom(positionals[0]);
      if (isFailure(session)) return failed(session);
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const files = readCopy(copyDir(flags, "from", session));
      if (!files.ok) return { result: files, lines: [] };
      const result = await call<ValidateResult>("POST", `/v1/agent/sessions/${session}/validate`, { thread, files: files.data });
      return {
        result,
        lines: !result.ok
          ? []
          : [
              ...result.data.warnings.map(issueLine),
              result.data.wouldCreate
                ? `ok: a commit would create an iteration · ${changedText([...result.data.changed, ...result.data.removed.map((b) => `${b} (removed)`)])}`
                : "ok: nothing changed since the latest iteration",
            ],
      };
    },
  },
  commit: {
    options: { from: { type: "string" }, addresses: { type: "string" }, note: { type: "string" }, ...threadOption },
    positionals: ["session"],
    async run({ flags, positionals }) {
      const session = sessionFrom(positionals[0]);
      if (isFailure(session)) return failed(session);
      const thread = threadFrom(flags, { required: true });
      if (isFailure(thread)) return failed(thread);
      const addresses: FeedbackId[] = [];
      for (const raw of (str(flags, "addresses") ?? "").split(",").filter((s) => s.trim() !== "")) {
        const id = parseFeedbackId(Number(raw.trim().replace(/^#/, "")));
        if (id === null) return failed(usage(`--addresses takes feedback ids like 4,7; "${raw}" isn't one`));
        addresses.push(id);
      }
      const dir = copyDir(flags, "from", session);
      const files = readCopy(dir);
      if (!files.ok) return { result: files, lines: [] };
      const result = await call<CommitResult>("POST", `/v1/agent/sessions/${session}/commit`, {
        thread,
        files: files.data,
        addresses,
        note: str(flags, "note") ?? null,
      });
      if (!result.ok) return { result, lines: [] };
      writeFiles(dir, withBase(files.data, result.data.iteration.n));
      const { iteration, created, warnings } = result.data;
      return {
        result,
        lines: [
          ...warnings.map(issueLine),
          created ? `${iterationText(iteration)}; created` : `nothing changed; iteration ${iteration.n} is still the latest`,
        ],
      };
    },
  },
};

const exitFor = (result: Result<unknown>): number =>
  result.ok ? EXIT.ok : result.error.code === "usage" ? EXIT.usage : result.error.code === "unavailable" ? EXIT.unavailable : EXIT.rejected;

async function main(argv: readonly string[]): Promise<number> {
  const grouped = argv[0] === "session" || argv[0] === "system" || argv[0] === "project";
  const name = grouped ? `${argv[0]} ${argv[1] ?? ""}` : (argv[0] ?? "");
  const rest = argv.slice(grouped ? 2 : 1);
  const wantsJson = rest.includes("--json");
  const print = (output: Output): number => {
    if (wantsJson) process.stdout.write(JSON.stringify(output.result) + "\n");
    else if (output.result.ok) process.stdout.write(output.lines.map((l) => l + "\n").join(""));
    else process.stderr.write(failureLines(output.result.error).map((l) => l + "\n").join(""));
    return output.exit ?? exitFor(output.result);
  };

  if (name === "" || name === "--help" || name === "help") {
    process.stdout.write(USAGE + "\n");
    return name === "" ? EXIT.usage : EXIT.ok;
  }
  const command = COMMANDS[name];
  if (command === undefined) return print(failed(usage(`unknown command "${name}"\n${USAGE}`)));

  let parsed: Parsed;
  try {
    const { values, positionals } = parseArgs({
      args: [...rest],
      options: { ...command.options, json: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    parsed = { flags: values, positionals };
  } catch (e) {
    return print(failed(usage(`${(e as Error).message}\n${USAGE}`)));
  }
  if (parsed.positionals.length !== command.positionals.length) {
    const expected = command.positionals.map((p) => `<${p}>`).join(" ");
    return print(failed(usage(`brainstorm ${name} takes ${expected === "" ? "no arguments" : expected}, got ${parsed.positionals.length}`)));
  }
  return print(await command.run(parsed));
}

process.exitCode = await main(process.argv.slice(2));
