import { partLabel } from "./part";
import { SLOT_ID_PATTERN, type NonEmpty, type PartName, type VariantKey, type VaryVariant } from "./types";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const VARY_MAX = 6;

/**
 * The variants a vary request asks for, named after the element: `spin-button-a` titled "Spin button A". Letters
 * already taken in the slot are skipped, so a second vary of the same element goes on to D, E and F.
 */
const slugOf = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Whether a variant's key only spells its title, as Vary's keys do ("spin-button-a" for "Spin button A"), so says nothing the title doesn't. */
export const keyEchoesTitle = (key: VariantKey, title: string): boolean => slugOf(title) === key;

export function varyNames(
  source: { readonly variant: VariantKey; readonly title: string },
  part: PartName | null,
  taken: readonly VariantKey[],
  count: number,
): NonEmpty<VaryVariant> {
  const slug = part === null ? source.variant : slugOf(part);
  const base = (/^[a-z]/.test(slug) ? slug : `v-${slug}`).slice(0, 30).replace(/-+$/, "");
  const label = part === null ? source.title : partLabel(part);
  const out: VaryVariant[] = [];
  for (const letter of LETTERS) {
    if (out.length === count) break;
    const key = `${base}-${letter}` as VariantKey;
    if (!taken.includes(key) && SLOT_ID_PATTERN.test(key)) out.push({ key, title: `${label} ${letter.toUpperCase()}` });
  }
  const [first, ...rest] = out;
  if (first === undefined) throw new Error(`no free variant names for ${base}`);
  return [first, ...rest];
}
