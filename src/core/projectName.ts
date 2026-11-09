import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The `.git` folder of the main checkout of the repo at `dir`, or null outside a git repo or for a folder that's gone.
 * It is the same from the main checkout and from every worktree, so it says which repo a folder belongs to.
 */
export async function gitCommonDir(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** The folder name of the main checkout of the repo at `dir`, so an agent's worktree still reports its repo's name. */
export async function projectNameAt(dir: string): Promise<string | null> {
  const common = await gitCommonDir(dir);
  return common === null ? null : basename(dirname(common)) || null;
}
