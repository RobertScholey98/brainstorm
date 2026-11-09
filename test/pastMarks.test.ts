import { describe, expect, test } from "vitest";
import type { BlockId, GraftId, Marks, PartName, Pin, SlotId, VariantKey } from "../src/core/types";
import { hasPastMarks, markPast, type PastMarks, type PastSlot } from "../src/renderer/pastMarks";

const v = (k: string) => k as VariantKey;
const wheel: PastSlot = { id: "wheel" as SlotId, variants: [v("neon"), v("calm"), v("spin-a")], active: v("neon") };
const sheet: PastSlot = { id: "result" as SlotId, variants: [v("sheet")], active: v("sheet") };
const slots = [wheel, sheet];
const SPIN = "spin-button" as PartName;
const NONE: Marks = { mains: {}, grafts: [], trashed: [] };
const fresh: PastMarks = { marks: NONE, picks: {} };
const block = (variant: string, variedFrom: Pin | null = null) => ({ id: `wheel/${variant}` as BlockId, slot: wheel.id, variant: v(variant), variedFrom });
const option = block("spin-a", { blockId: "wheel/neon" as BlockId, part: SPIN });

/** Applies marks in turn, failing on a refusal, as Rob would make them one after another. */
const after = (...marks: Parameters<typeof markPast>[2][]): PastMarks =>
  marks.reduce<PastMarks>((state, mark) => {
    const next = markPast(state, slots, mark);
    if (next === null || "refused" in next) throw new Error(`${mark.kind} didn't apply`);
    return next;
  }, fresh);

describe("marks on a past iteration", () => {
  test("a 👍 makes Main and shows it, and a second 👍 undoes Main but leaves it showing", () => {
    const approved = after({ kind: "approve", block: block("calm") });
    expect(approved).toEqual({ marks: { mains: { wheel: "calm" }, grafts: [], trashed: [] }, picks: { wheel: "calm" } });
    expect(after({ kind: "approve", block: block("calm") }, { kind: "approve", block: block("calm") })).toEqual({
      marks: { mains: {}, grafts: [], trashed: [] },
      picks: { wheel: "calm" },
    });
  });

  test("a 👍 on a vary option once there is a Main grafts its varied element instead, and doesn't move what shows", () => {
    const grafted = after({ kind: "approve", block: block("neon") }, { kind: "approve", block: option });
    expect(grafted).toEqual({
      marks: { mains: { wheel: "neon" }, grafts: [{ id: 1, from: { blockId: "wheel/spin-a", part: "spin-button" }, into: "wheel", instruction: null }], trashed: [] },
      picks: { wheel: "neon" },
    });
    expect(markPast(grafted, slots, { kind: "approve", block: option }), "a second 👍 takes the graft back").toEqual({
      marks: { mains: { wheel: "neon" }, grafts: [], trashed: [] },
      picks: { wheel: "neon" },
    });
  });

  test("trash and restore", () => {
    const trashed = after({ kind: "trash", block: block("calm") });
    expect(trashed).toEqual({ marks: { mains: {}, grafts: [], trashed: ["wheel/calm"] }, picks: {} });
    expect(markPast(trashed, slots, { kind: "restore", block: "wheel/calm" as BlockId })).toEqual({ marks: { mains: {}, grafts: [], trashed: [] }, picks: {} });
  });

  test("trashing Main, or a slot's last variant, is refused with the service's reason", () => {
    expect(markPast(after({ kind: "approve", block: block("calm") }), slots, { kind: "trash", block: block("calm") })).toEqual({ refused: "Main can't be trashed" });
    const lastOne = after({ kind: "trash", block: block("calm") }, { kind: "trash", block: block("spin-a") });
    expect(markPast(lastOne, slots, { kind: "trash", block: block("neon") })).toEqual({ refused: "Main can't be trashed" });
    expect(markPast(fresh, slots, { kind: "trash", block: { id: "result/sheet" as BlockId, slot: sheet.id, variant: v("sheet") } })).toEqual({ refused: "Main can't be trashed" });
  });

  test("a pick into a slot with no Main makes what shows there Main, and a pick from Main itself is refused", () => {
    const pin = { blockId: "result/sheet" as BlockId, part: "headline" as PartName };
    expect(after({ kind: "pick", from: pin, into: wheel.id, instruction: "above the logo" })).toEqual({
      marks: { mains: { wheel: "neon" }, grafts: [{ id: 1, from: pin, into: "wheel", instruction: "above the logo" }], trashed: [] },
      picks: {},
    });
    expect(markPast(fresh, slots, { kind: "pick", from: { blockId: "wheel/neon" as BlockId, part: SPIN }, into: wheel.id, instruction: null })).toEqual({
      refused: "That element is already in Main",
    });
  });

  test("a pick into a slot whose showing variant is trashed makes the first one left Main and shows it", () => {
    const trashed = after({ kind: "trash", block: block("neon") });
    const pin = { blockId: "result/sheet" as BlockId, part: "headline" as PartName };
    expect(markPast(trashed, slots, { kind: "pick", from: pin, into: wheel.id, instruction: null })).toEqual({
      marks: { mains: { wheel: "calm" }, grafts: [{ id: 1, from: pin, into: "wheel", instruction: null }], trashed: ["wheel/neon"] },
      picks: { wheel: "calm" },
    });
  });

  test("removing a graft leaves Main and the other grafts", () => {
    const pin = { blockId: "result/sheet" as BlockId, part: "headline" as PartName };
    const two = after({ kind: "approve", block: block("neon") }, { kind: "approve", block: option }, { kind: "pick", from: pin, into: wheel.id, instruction: null });
    expect(markPast(two, slots, { kind: "remove_graft", graft: 1 as GraftId })).toEqual({
      marks: { mains: { wheel: "neon" }, grafts: [{ id: 2, from: pin, into: "wheel", instruction: null }], trashed: [] },
      picks: { wheel: "neon" },
    });
  });

  test("a mark on a slot the iteration doesn't have does nothing", () => {
    expect(markPast(fresh, slots, { kind: "approve", block: { ...block("calm"), slot: "gone" as SlotId } })).toBe(null);
    expect(markPast(fresh, slots, { kind: "pick", from: { blockId: "result/sheet" as BlockId, part: null }, into: "gone" as SlotId, instruction: null })).toBe(null);
  });

  test("the past is marked once Rob has made a Main, trashed or grafted there, and not once he takes the marks back", () => {
    expect(hasPastMarks(fresh)).toBe(false);
    expect(hasPastMarks({ marks: NONE, picks: { wheel: v("calm") } }), "showing another variant is no mark").toBe(false);
    expect(hasPastMarks(after({ kind: "approve", block: block("calm") }))).toBe(true);
    expect(hasPastMarks(after({ kind: "trash", block: block("calm") }))).toBe(true);
    expect(hasPastMarks(after({ kind: "pick", from: { blockId: "result/sheet" as BlockId, part: null }, into: wheel.id, instruction: null }))).toBe(true);
    expect(hasPastMarks(after({ kind: "approve", block: block("calm") }, { kind: "approve", block: block("calm") })), "a second 👍 undoes the first").toBe(false);
    expect(hasPastMarks(after({ kind: "trash", block: block("calm") }, { kind: "restore", block: block("calm").id })), "a restore undoes a trash").toBe(false);
  });
});
