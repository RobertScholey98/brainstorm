import { partLabel } from "./part";
import { appearanceProp } from "./props";
import {
  blockIdOf,
  SLOT_ID_PATTERN,
  type AppearanceProp,
  type AppearanceValue,
  type BlockId,
  type BlockView,
  type Feedback,
  type NonEmpty,
  type Override,
  type PartName,
  type PropName,
  type SlotView,
  type VariantKey,
  type VaryVariant,
} from "./types";

/** One slot as the fork carries it: its picked variant only. */
export type CarriedSlot = { readonly slot: SlotView; readonly blockId: BlockId; readonly title: string };
export type CarriedSetting = { readonly blockId: BlockId; readonly prop: PropName; readonly value: AppearanceValue; readonly text: string };

/** What a fork of one iteration carries. The popover lists it and the service writes it, so the two can't disagree. */
export type CarryOver = {
  readonly slots: readonly CarriedSlot[];
  /** Rob's settings that apply to a picked variant, baked into its defaults. */
  readonly settings: readonly CarriedSetting[];
  /** Open feedback pinned to a picked variant. */
  readonly pins: readonly Feedback[];
};

export type CarryOverInput = {
  readonly slots: readonly SlotView[];
  readonly blocks: readonly Pick<BlockView, "id" | "title" | "props">[];
  /** Variants Rob picked; a slot left out carries the variant it shows. */
  readonly picks: Readonly<Record<string, VariantKey>>;
  readonly applicable: readonly Override[];
  readonly feedback: readonly Feedback[];
};

export function carryOver(input: CarryOverInput): { ok: true; value: CarryOver } | { ok: false; message: string } {
  for (const [slot, variant] of Object.entries(input.picks)) {
    const s = input.slots.find((x) => x.id === slot);
    if (s === undefined || !s.variants.includes(variant)) return { ok: false, message: `${slot}/${variant} is not in this iteration` };
  }
  const slots = input.slots.map((slot) => {
    const blockId = blockIdOf(slot.id, input.picks[slot.id] ?? slot.active);
    return { slot, blockId, title: input.blocks.find((b) => b.id === blockId)?.title ?? blockId };
  });
  const carried = new Set(slots.map((s) => s.blockId));
  const settings = input.applicable.flatMap((o) => {
    const prop = carried.has(o.blockId) ? input.blocks.find((b) => b.id === o.blockId)?.props : undefined;
    const spec = prop === undefined ? undefined : appearanceProp(prop, o.prop);
    return spec === undefined || spec.default === o.value ? [] : [{ blockId: o.blockId, prop: o.prop, value: o.value, text: settingText(spec, o.value) }];
  });
  const pins = input.feedback.filter((f) => f.status.state === "open" && carried.has(f.pin.blockId));
  return { ok: true, value: { slots, settings, pins } };
}

/** How the carry list names a setting: its label and value, as the control shows it. */
export function settingText(prop: AppearanceProp, value: AppearanceValue): string {
  switch (prop.type) {
    case "number":
      return `${prop.label} ${value}${prop.unit ?? ""}`;
    case "color":
      return `${prop.label} ${String(value).toUpperCase()}`;
    case "boolean":
      return `${prop.label} ${value ? "on" : "off"}`;
    case "enum":
    case "text":
      return `${prop.label} “${String(value)}”`;
  }
}

/** `block.json` with `settings` as its appearance defaults. Only the defaults change, so the schema stays the agent's. */
export function bakeDefaults(json: string, settings: readonly Pick<CarriedSetting, "prop" | "value">[]): string {
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

