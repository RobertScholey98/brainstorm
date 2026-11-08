import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { matchFiles, tiersOf, type SystemSource } from "./source";

export type SystemInputs = { readonly files: readonly string[]; readonly globs: readonly string[]; readonly fingerprint: string };

/**
 * The globs whose matches are part of the fingerprint, so a new story or component file counts as a change even
 * though the last build never read it (ADR 008).
 */
export function watchedGlobs(source: SystemSource): string[] {
  const tiers = tiersOf(source);
  return [...source.stories, ...tiers.primitive, ...tiers.composite, ...tiers.layout, ...(source.shared ?? [])];
}

/**
 * Whether anything a sync reads has changed: each file's size and modified time, and which files the globs match.
 * Only `stat` calls and one walk of the project, so auto-sync can run it every few seconds. A touched but unchanged
 * file changes the fingerprint; the sync that follows finds the same build and makes no version.
 */
export function fingerprint(root: string, files: readonly string[], globs: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    try {
      const s = statSync(file);
      hash.update(`${file}\0${s.size}\0${s.mtimeMs}\n`);
    } catch {
      hash.update(`${file}\0missing\n`);
    }
  }
  hash.update("--\n");
  try {
    for (const f of matchFiles(root, globs)) hash.update(`${f}\n`);
  } catch {
    hash.update("unreadable\n");
  }
  return hash.digest("hex");
}

export function inputsOf(source: SystemSource, files: readonly string[]): SystemInputs {
  const globs = watchedGlobs(source);
  return { files, globs, fingerprint: fingerprint(source.root, files, globs) };
}
