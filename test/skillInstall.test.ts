import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { installSkill } from "../src/core/skillInstall";

const skill = join(import.meta.dirname, "..", "skills", "use-brainstorm");
const now = new Date(2026, 10, 7, 9, 5, 3);

describe("installSkill", () => {
  test("copies the skill into an empty Claude folder, then finds it current", () => {
    const claude = mkdtempSync(join(tmpdir(), "bs-claude-"));
    const target = join(claude, "skills", "use-brainstorm");
    expect(installSkill(skill, claude, { now })).toEqual({ kind: "installed", target, backup: null });
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe(readFileSync(join(skill, "SKILL.md"), "utf8"));
    expect(installSkill(skill, claude, { now })).toEqual({ kind: "current", target });
  });

  test("moves a changed copy to skill-backups before replacing it", () => {
    const claude = mkdtempSync(join(tmpdir(), "bs-claude-"));
    const target = join(claude, "skills", "use-brainstorm");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "an edited copy");
    const backup = join(claude, "skill-backups", "use-brainstorm.bak-20261107-090503");
    expect(installSkill(skill, claude, { now })).toEqual({ kind: "installed", target, backup });
    expect(readFileSync(join(backup, "SKILL.md"), "utf8")).toBe("an edited copy");
    expect(readdirSync(join(claude, "skills"))).toEqual(["use-brainstorm"]);
  });

  test("a dry run touches nothing", () => {
    const claude = mkdtempSync(join(tmpdir(), "bs-claude-"));
    expect(installSkill(skill, claude, { now, dryRun: true }).kind).toBe("installed");
    expect(readdirSync(claude)).toEqual([]);
  });
});
