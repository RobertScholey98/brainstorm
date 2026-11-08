import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join, relative } from "node:path";

export const SKILL_NAME = "use-brainstorm";

import type { SkillInstall } from "./about";

export type { SkillInstall };

function readTree(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(root, path), readFileSync(path));
    }
  };
  walk(root);
  return files;
}

function sameTree(a: Map<string, Buffer>, b: Map<string, Buffer>): boolean {
  if (a.size !== b.size) return false;
  for (const [path, bytes] of a) {
    const other = b.get(path);
    if (other === undefined || !bytes.equals(other)) return false;
  }
  return true;
}

function timestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Copies the skill folder `source` to `<claudeDir>/skills/use-brainstorm`, unless an identical copy is already there.
 * A copy that differs moves to `<claudeDir>/skill-backups` first: outside skills/, because Claude Code loads every
 * folder there as a skill and a backup would compete to trigger. `dryRun` reports what it would do and touches nothing.
 */
export function installSkill(source: string, claudeDir: string, options: { now?: Date; dryRun?: boolean } = {}): SkillInstall {
  const target = join(claudeDir, "skills", SKILL_NAME);
  let backup: string | null = null;
  if (existsSync(target)) {
    if (sameTree(readTree(source), readTree(target))) return { kind: "current", target };
    backup = join(claudeDir, "skill-backups", `${SKILL_NAME}.bak-${timestamp(options.now ?? new Date())}`);
    if (!options.dryRun) {
      mkdirSync(join(claudeDir, "skill-backups"), { recursive: true });
      renameSync(target, backup);
    }
  }
  if (!options.dryRun) cpSync(source, target, { recursive: true });
  return { kind: "installed", target, backup };
}
