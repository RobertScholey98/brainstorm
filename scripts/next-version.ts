// The version a release gets: node scripts/next-version.ts <patch|minor|major>
//
// The latest vX.Y.Z tag, bumped. With no such tag yet, the first release takes package.json's version as it is.
// Tags that aren't three-part versions, such as v0.1, are ignored.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BUMPS: readonly string[] = ["patch", "minor", "major"];
const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** `tags` are git tag names; `base` is package.json's version. */
export function nextVersion(tags: readonly string[], base: string, bump: string): string {
  if (!BUMPS.includes(bump)) throw new Error(`bump must be one of ${BUMPS.join(", ")}, got ${bump}`);
  const versions = tags.flatMap((tag): [number, number, number][] => {
    const m = TAG.exec(tag);
    return m === null ? [] : [[Number(m[1]), Number(m[2]), Number(m[3])]];
  });
  if (versions.length === 0) return base;
  const [major, minor, patch] = versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).at(-1) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const tags = execFileSync("git", ["tag", "--list", "v*"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const base = JSON.parse(readFileSync(`${root}/package.json`, "utf8")).version;
  process.stdout.write(`${nextVersion(tags, base, process.argv[2] ?? "")}\n`);
}
