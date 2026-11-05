import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run")) {
  console.error("usage: node scripts/install-skill.mjs [--dry-run]");
  process.exit(2);
}
const dryRun = args.includes("--dry-run");

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..", "skills", "ux-brainstorm");
const target = join(homedir(), ".claude", "skills", "ux-brainstorm");

function readTree(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(root, path), readFileSync(path));
    }
  };
  walk(root);
  return files;
}

function sameTree(a, b) {
  if (a.size !== b.size) return false;
  for (const [path, bytes] of a) {
    const other = b.get(path);
    if (!other || !bytes.equals(other)) return false;
  }
  return true;
}

function timestamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

const say = (line) => console.log(dryRun ? `[dry run] would ${line}` : line);

if (existsSync(target)) {
  if (sameTree(readTree(source), readTree(target))) {
    console.log(`${target} is already up to date`);
    process.exit(0);
  }
  // Outside skills/, because Claude Code loads every folder there as a skill and the backup would compete to trigger.
  const backups = join(homedir(), ".claude", "skill-backups");
  const backup = join(backups, `ux-brainstorm.bak-${timestamp(new Date())}`);
  say(`move ${target} to ${backup}`);
  if (!dryRun) {
    mkdirSync(backups, { recursive: true });
    renameSync(target, backup);
  }
}
say(`copy ${source} to ${target}`);
if (!dryRun) cpSync(source, target, { recursive: true });
