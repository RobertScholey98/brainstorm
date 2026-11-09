import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(repo, "skills", "use-brainstorm");
const failures = [];
const expect = (ok, msg) => { if (!ok) failures.push(msg); };

const skillMd = readFileSync(join(skill, "SKILL.md"), "utf8");
const front = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
expect(front, "SKILL.md has frontmatter");
const name = front?.[1].match(/^name: (.+)$/m)?.[1];
const description = front?.[1].match(/^description: (.+)$/m)?.[1];
expect(name === "use-brainstorm", `name is use-brainstorm, got ${name}`);
expect(description && description.length <= 1024, `description present and <= 1024 chars (${description?.length})`);
console.log(`SKILL.md ${skillMd.split("\n").length} lines, description ${description?.length} chars`);

const mdFiles = [];
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".md")) mdFiles.push(p); } };
walk(skill);

// brainstorm --help runs the built CLI, which npm test doesn't build.
execFileSync(process.execPath, [join(repo, "scripts", "build.mjs"), "cli"], { stdio: "inherit" });
const help = spawnSync(process.execPath, [join(repo, "bin", "brainstorm.mjs"), "--help"], { encoding: "utf8" });
expect(help.status === 0, `brainstorm --help exits 0, got ${help.status}`);
const cliBlock = help.stdout.split(/\r?\n/).filter((l) => /^\s+brainstorm /.test(l)).join("\n");
const allowed = new Map();
for (const line of cliBlock.trim().split("\n")) {
  const words = line.trim().split(/\s+/);
  const key = words[1] === "session" || words[1] === "system" || words[1] === "project" ? `${words[1]} ${words[2]}` : words[1];
  allowed.set(key, new Set([...line.matchAll(/--[a-z]+/g)].map((m) => m[0]).concat("--json")));
}
console.log("CLI commands:", [...allowed.keys()].join(", "));

const used = new Map();
for (const file of mdFiles) {
  const text = readFileSync(file, "utf8");
  for (const [, target] of text.matchAll(/\]\(([^)#]+)\)/g)) {
    if (/^https?:/.test(target)) continue;
    expect(existsSync(resolve(dirname(file), target)), `${file}: link ${target} resolves`);
  }
  for (const m of text.matchAll(/brainstorm (session (?:new|list|attach)|system (?:list|add|sync|show|check|import)|project (?:show|use)|context|pull|validate|commit)\b([^\n`]*)/g)) {
    const flags = [...m[2].matchAll(/--[a-z]+/g)].map((f) => f[0]);
    if (!used.has(m[1])) used.set(m[1], new Set());
    flags.forEach((f) => used.get(m[1]).add(f));
  }
  for (const m of text.matchAll(/`(session new|session list|session attach|context|pull|validate|commit)( --[a-z]+[^`]*)`/g)) {
    [...m[2].matchAll(/--[a-z]+/g)].forEach((f) => used.get(m[1])?.add(f[0]) ?? used.set(m[1], new Set([f[0]])));
  }
  for (const m of text.matchAll(/`--([a-z]+)[^`]*` to `(pull|commit)`(?: and `(validate)`)?/g)) {
    [m[2], m[3]].filter(Boolean).forEach((c) => used.get(c)?.add(`--${m[1]}`));
  }
}
for (const [cmd, flags] of used) {
  expect(allowed.has(cmd), `command brainstorm ${cmd} is in brainstorm --help`);
  for (const f of flags) expect(allowed.get(cmd)?.has(f), `flag ${f} on brainstorm ${cmd} is in brainstorm --help`);
  console.log(`brainstorm ${cmd} ${[...flags].join(" ")}`);
}

const yaml = readFileSync(join(skill, "agents", "openai.yaml"), "utf8");
expect(!/html/i.test(yaml), "openai.yaml no longer mentions HTML");
expect(!existsSync(join(skill, "references", "html-report.md")), "html-report.md is gone");
for (const f of mdFiles) expect(!/html report|html-report/i.test(readFileSync(f, "utf8").replace(/replaces the old HTML report/, "")), `${f} has no stale HTML-report instruction`);

// Rob judges the designs himself, so the skill designs around hypotheses but never writes notes, rationales or picks for him.
const NOTE_WORDS = /about\.md|tradeoff|trade-off|try this|recommend/i;
const NOTE_LABELS = /\*\*(Hypothesis|Tradeoff|Try this|Recommended)\b|^(Hypothesis|Tradeoff|Try this|Recommended)[.:]/m;
const skillFiles = [];
const walkAll = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walkAll(p); else skillFiles.push(p); } };
walkAll(skill);
for (const f of skillFiles) {
  expect(!f.endsWith("about.md"), `${f}: variant notes are gone from the format`);
  const text = readFileSync(f, "utf8");
  const hit = NOTE_WORDS.exec(text) ?? NOTE_LABELS.exec(text);
  expect(hit === null, `${f} writes up a variant for Rob ("${hit?.[0]}"); the designs carry their hypotheses`);
}

if (failures.length) { console.error("FAILED\n" + failures.join("\n")); process.exit(1); }
console.log("VERIFIED");
