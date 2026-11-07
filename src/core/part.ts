import type { PartName } from "./types";

/** A `data-part` as Rob reads it: `spin-button` is "Spin button". On its own so the canvas can name parts without zod. */
export function partLabel(part: PartName): string {
  const words = part.replace(/[-_]+/g, " ").trim();
  return words.length === 0 ? part : words[0]!.toUpperCase() + words.slice(1);
}
