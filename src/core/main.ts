import {
  blockIdOf,
  splitBlockId,
  type BlockId,
  type BlockView,
  type ConfirmScope,
  type Marks,
  type Pin,
  type SlotId,
  type StoredGraft,
  type VariantKey,
} from "./types";

/**
 * The rules for Main, the marks and Confirm (ADR 009). The service applies them to Rob's stored marks on the latest
 * iteration, and the window applies the same ones to the marks it keeps for a past iteration, so the two can't differ.
 */

type SlotShape = { readonly id: SlotId; readonly variants: readonly VariantKey[] };
type BlockShape = Pick<BlockView, "id" | "slot" | "variant" | "variedFrom">;

/** The marks that still name something in this iteration. A regenerate can remove a block a mark pointed at. */
export function liveMarks(marks: Marks, slots: readonly SlotShape[]): Marks {
  const exists = (b: BlockId) => {
    const { slot, variant } = splitBlockId(b);
    return slots.some((s) => s.id === slot && s.variants.includes(variant));
  };
  const mains: Partial<Record<SlotId, VariantKey>> = {};
  for (const s of slots) {
    const v = marks.mains[s.id];
    if (v !== undefined && s.variants.includes(v)) mains[s.id] = v;
  }
  const trashed = marks.trashed.filter((b) => exists(b) && mains[splitBlockId(b).slot] !== splitBlockId(b).variant);
  const grafts = marks.grafts.filter((g) => exists(g.from.blockId) && slots.some((s) => s.id === g.into));
  return { mains, grafts, trashed };
}

/** The slot's variants Rob hasn't trashed, in order. Never empty: the last one can't be trashed. */
export function shownVariants(slot: SlotShape, marks: Marks): VariantKey[] {
  const shown = slot.variants.filter((v) => !marks.trashed.includes(blockIdOf(slot.id, v)));
  return shown.length > 0 ? shown : [...slot.variants];
}

/** The slot's Main: the variant Rob chose, or the only one left showing. Null while he hasn't chosen among several. */
export function mainOf(slot: SlotShape, marks: Marks): VariantKey | null {
  const chosen = marks.mains[slot.id];
  if (chosen !== undefined && slot.variants.includes(chosen)) return chosen;
  const shown = shownVariants(slot, marks);
  return shown.length === 1 ? shown[0]! : null;
}

/** What a 👍 on `block` does. The window labels the button with it, and the service applies it. */
export type Approval =
  | { readonly kind: "main" }
  | { readonly kind: "unmain" }
  | { readonly kind: "graft"; readonly from: Pin }
  | { readonly kind: "ungraft"; readonly graft: StoredGraft };

/**
 * A 👍 makes a variant its slot's Main. On a vary option, once the slot has a Main, it brings the varied element into
 * Main instead. A second 👍 undoes either.
 */
export function approval(slot: SlotShape, block: BlockShape, marks: Marks): Approval {
  if (marks.mains[slot.id] === block.variant) return { kind: "unmain" };
  const main = mainOf(slot, marks);
  const varied = block.variedFrom;
  if (main !== null && main !== block.variant && varied !== null && varied.part !== null) {
    const graft = marks.grafts.find((g) => g.from.blockId === block.id && g.from.part === varied.part && g.into === slot.id);
    return graft === undefined ? { kind: "graft", from: { blockId: block.id, part: varied.part } } : { kind: "ungraft", graft };
  }
  return { kind: "main" };
}

/** Why a variant can't be trashed, or null when it can. */
export function trashRefusal(slot: SlotShape, variant: VariantKey, marks: Marks): string | null {
  if (mainOf(slot, marks) === variant) return "Main can't be trashed";
  if (shownVariants(slot, marks).length <= 1) return "A slot keeps at least one variant";
  return null;
}

/**
 * What Confirm locks in, or null when there is nothing to lock. A slot with a Main keeps only Main; a slot without one
 * keeps its variants that aren't trashed. Grafts go to the agent; with none the app narrows the iteration itself.
 */
export function confirmPlan(slots: readonly SlotShape[], marks: Marks): ConfirmScope | null {
  const live = liveMarks(marks, slots);
  const mains: { slot: SlotId; variant: VariantKey }[] = [];
  const drop: BlockId[] = [];
  for (const slot of slots) {
    const main = live.mains[slot.id];
    if (main !== undefined) mains.push({ slot: slot.id, variant: main });
    const keep = main !== undefined ? [main] : shownVariants(slot, live);
    drop.push(...slot.variants.filter((v) => !keep.includes(v)).map((v) => blockIdOf(slot.id, v)));
  }
  const grafts = live.grafts.map(({ from, into, instruction }) => ({ from, into, instruction }));
  if (drop.length === 0 && grafts.length === 0) return null;
  return { kind: "confirm", mains, grafts, drop };
}

/** Each slot as the confirm leaves it, for the popover: what Main is, what goes into it, and how many options go. */
export type ConfirmLine = {
  readonly slot: SlotId;
  readonly keeps: readonly VariantKey[];
  readonly grafts: ConfirmScope["grafts"];
  readonly dropped: number;
};

export function confirmLines(slots: readonly SlotShape[], plan: ConfirmScope): ConfirmLine[] {
  return slots.flatMap((slot) => {
    const dropped = plan.drop.filter((b) => splitBlockId(b).slot === slot.id).length;
    const grafts = plan.grafts.filter((g) => g.into === slot.id);
    if (dropped === 0 && grafts.length === 0) return [];
    return [{ slot: slot.id, keeps: slot.variants.filter((v) => !plan.drop.includes(blockIdOf(slot.id, v))), grafts, dropped }];
  });
}
