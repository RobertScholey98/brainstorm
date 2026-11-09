import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The `.git` folder of the main checkout of the repo at `dir`, or null outside a git repo or for a folder that's gone.
 * It is the same from the main checkout and from every worktree, so it says which repo a folder belongs to.
 */
async function gitCommonDir(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: dir, encoding: "utf8", windowsHide: true });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The repo that holds `dir`, by its main checkout's `.git`, and its name, the main checkout's folder name. A worktree
 * reports its repo's name too. Null outside git, so read it while the folder exists.
 */
export async function repoAt(dir: string): Promise<{ readonly git: string; readonly name: string | null } | null> {
  const git = await gitCommonDir(dir);
  return git === null ? null : { git, name: basename(dirname(git)) || null };
}
