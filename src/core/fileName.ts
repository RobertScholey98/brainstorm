import type { IterationN, SessionId } from "./types";

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/gu;
/** Windows opens a device for these names, with or without an extension after them. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\s*\.|$)/iu;
const MAX_TITLE = 60;

/**
 * A title as the start of a file name every system accepts: no character Windows forbids, one space between words,
 * at most 60 characters, no dot or space at either end, and never a name Windows keeps for a device. Empty when the
 * title has nothing left to use.
 */
export function fileTitle(title: string): string {
  const words = title.replace(/\s/gu, " ").replace(FORBIDDEN, "").replace(/\s+/gu, " ").trim();
  const capped = Array.from(words).slice(0, MAX_TITLE).join("").replace(/^[\s.]+|[\s.]+$/gu, "");
  return capped.replace(RESERVED, "$1_");
}

/**
 * An exported iteration's file, named by its brainstorm's title, else its id, then the iteration and the time as
 * yyyyMMdd-HHmmss. The time is local, which is what Rob reads in Explorer.
 */
export function exportFileName(title: string, id: SessionId, n: IterationN, at: Date): string {
  const two = (v: number) => String(v).padStart(2, "0");
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `${fileTitle(title) || id}-i${n}-${stamp}.html`;
}
