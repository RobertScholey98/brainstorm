import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The folder name of the main checkout of the repo at `dir`, or null outside a git repo. The common dir is the main
 * checkout's `.git` even from a worktree, so an agent's worktree still reports its repo's name.
 */
export async function projectNameAt(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", windowsHide: true });
    return basename(dirname(stdout.trim())) || null;
  } catch {
    return null;
  }
}
