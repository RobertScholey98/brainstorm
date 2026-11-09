import { partLabel } from "./part";
import {
  SLOT_ID_PATTERN,
  type AppearanceValue,
  type NonEmpty,
  type PartName,
  type PropName,
  type VariantKey,
  type VaryVariant,
} from "./types";

/** `block.json` with `settings` as its appearance defaults. Only the defaults change, so the schema stays the agent's. */
export function bakeDefaults(json: string, settings: readonly { readonly prop: PropName; readonly value: AppearanceValue }[]): string {
  if (settings.length === 0) return json;
  const block = JSON.parse(json) as { props: { appearance: Record<string, { default: unknown }> } };
  for (const s of settings) {
    const spec = block.props.appearance[s.prop];
    if (spec !== undefined) spec.default = s.value;
  }
  return `${JSON.stringify(block, null, 2)}\n`;
}

const TITLE_MAX = 48;

/** A fork is named for what Rob asked of it: the instruction's first clause, cut at a word near 48 characters. */
export function forkTitle(instruction: string): string {
  const line = instruction.trim().split(/\r?\n/)[0] ?? "";
  const clause = line.split(/[,;:.!?]\s|\s[-–—]\s/)[0]?.trim() ?? "";
  const text = clause.length >= 3 ? clause : line;
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export { partLabel };

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

