import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { projectNameAt } from "../src/cli/projectName";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });

test("names the main checkout from the repo, a subfolder and a worktree, and nothing outside git", () => {
  const base = mkdtempSync(join(tmpdir(), "bs-project-"));
  const repo = join(base, "chore-app");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.txt"), "a");
  git(repo, "init", "-q");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  git(repo, "worktree", "add", "-q", join(base, "t3-1cb06952"));
  const outside = join(base, "loose");
  mkdirSync(outside);

  expect([repo, join(repo, "src"), join(base, "t3-1cb06952"), outside, join(base, "missing")].map(projectNameAt)).toEqual([
    "chore-app",
    "chore-app",
    "chore-app",
    null,
    null,
  ]);
});
