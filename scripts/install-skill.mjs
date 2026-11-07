// Installs this checkout's use-brainstorm skill into ~/.claude/skills. An installed app does the same on start.
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installSkill, SKILL_NAME } from "../src/core/skillInstall.ts";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run")) {
  console.error("usage: node scripts/install-skill.mjs [--dry-run]");
  process.exit(2);
}
const dryRun = args.includes("--dry-run");

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", SKILL_NAME);
const result = installSkill(source, join(homedir(), ".claude"), { dryRun });
const say = (line) => console.log(dryRun ? `[dry run] would ${line}` : line);

if (result.kind === "current") console.log(`${result.target} is already up to date`);
else {
  if (result.backup !== null) say(`move ${result.target} to ${result.backup}`);
  say(`copy ${source} to ${result.target}`);
}
