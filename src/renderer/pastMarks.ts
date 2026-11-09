import { approval, trashRefusal, withApproval, withPick, withTrash } from "../core/main";
import type { BlockId, BlockView, GraftId, Marks, Pin, SlotId, VariantKey } from "../core/types";

/**
 * Rob's marks on a past iteration (ADR 010), which the window keeps itself until Confirm makes a branch from them. It
 * applies `main.ts`'s rules, as the service does to its rows at the latest, and moves what shows the way the latest
 * does: a variant made Main is the one that shows in its slot.
 */
export type PastMarks = {
  readonly marks: Marks;
  /** The variant Rob chose to show per slot, over the stored iteration's own. */
  readonly picks: Readonly<Record<string, VariantKey>>;
};

export type PastSlot = { readonly id: SlotId; readonly variants: readonly VariantKey[]; readonly active: VariantKey };

export type PastMark =
  | { readonly kind: "approve"; readonly block: Pick<BlockView, "id" | "slot" | "variant" | "variedFrom"> }
  | { readonly kind: "trash"; readonly block: Pick<BlockView, "id" | "slot" | "variant"> }
  | { readonly kind: "restore"; readonly block: BlockId }
  | { readonly kind: "remove_graft"; readonly graft: GraftId }
  | { readonly kind: "pick"; readonly from: Pin; readonly into: SlotId; readonly instruction: string | null };

/** Whether Rob has marked anything on the past iteration: what goes when he leaves it, unless he confirms a branch. */
export const hasPastMarks = ({ marks }: PastMarks): boolean =>
  Object.keys(marks.mains).length > 0 || marks.grafts.length > 0 || marks.trashed.length > 0;

/**
 * The past's marks after one of Rob's, or why it is refused, or null when the slot it names isn't in the iteration and
 * there is nothing to do.
 */
export function markPast(state: PastMarks, slots: readonly PastSlot[], mark: PastMark): PastMarks | { readonly refused: string } | null {
  const { marks, picks } = state;
  switch (mark.kind) {
    case "approve": {
      const s = slots.find((x) => x.id === mark.block.slot);
      if (s === undefined) return null;
      const main = approval(s, mark.block, marks).kind === "main";
      return { marks: withApproval(marks, s, mark.block), picks: main ? { ...picks, [s.id]: mark.block.variant } : picks };
    }
    case "trash": {
      const s = slots.find((x) => x.id === mark.block.slot);
      const refused = s === undefined ? null : trashRefusal(s, mark.block.variant, marks);
      return refused !== null ? { refused } : { marks: withTrash(marks, mark.block.id, true), picks };
    }
    case "restore":
      return { marks: withTrash(marks, mark.block, false), picks };
    case "remove_graft":
      return { marks: { ...marks, grafts: marks.grafts.filter((g) => g.id !== mark.graft) }, picks };
    case "pick": {
      const s = slots.find((x) => x.id === mark.into);
      if (s === undefined) return null;
      // A slot with no Main takes what shows there as Main, and Main's own elements are refused.
      const next = withPick(marks, s, mark.from, mark.instruction, s.active);
      if ("refused" in next) return next;
      const main = next.mains[s.id]!;
      return { marks: next, picks: main === s.active ? picks : { ...picks, [s.id]: main } };
    }
  }
}
