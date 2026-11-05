import { execFileSync } from "node:child_process";
import { basename, dirname } from "node:path";

/**
 * The folder name of the main checkout of the repo at `dir`, or null outside a git repo. The common dir is the main
 * checkout's `.git` even from a worktree, so an agent's worktree still reports its repo's name.
 */
export function projectNameAt(dir: string): string | null {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    return basename(dirname(common)) || null;
  } catch {
    return null;
  }
}
