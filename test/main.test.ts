import { describe, expect, test } from "vitest";
import { approval, confirmLines, confirmPlan, liveMarks, mainOf, shownVariants, trashRefusal, withApproval, withGraft, withPick, withTrash } from "../src/core/main";
import type { BlockId, Marks, PartName, Pin, SlotId, StoredGraft, VariantKey } from "../src/core/types";

const v = (k: string) => k as VariantKey;
const wheel = { id: "wheel" as SlotId, variants: [v("neon"), v("calm"), v("spin-a")] };
const sheet = { id: "result" as SlotId, variants: [v("sheet")] };
const slots = [wheel, sheet];
const NONE: Marks = { mains: {}, grafts: [], trashed: [] };
const SPIN = "spin-button" as PartName;
const block = (variant: string, variedFrom: Pin | null = null) => ({ id: `wheel/${variant}` as BlockId, slot: wheel.id, variant: v(variant), variedFrom });
const option = block("spin-a", { blockId: "wheel/neon" as BlockId, part: SPIN });
const main = (variant: string): Marks => ({ ...NONE, mains: { [wheel.id]: v(variant) } });

describe("Main", () => {
  test("is the variant Rob chose, or the only one left showing, and nothing while he hasn't chosen among several", () => {
    expect(mainOf(wheel, NONE)).toBe(null);
    expect(mainOf(wheel, main("calm"))).toBe("calm");
    expect(mainOf(sheet, NONE), "a slot with one variant has its Main already").toBe("sheet");
    expect(mainOf(wheel, { ...NONE, trashed: ["wheel/neon", "wheel/spin-a"] as BlockId[] })).toBe("calm");
  });

  test("trashing never hides the last variant, and never Main", () => {
    expect(shownVariants(wheel, { ...NONE, trashed: ["wheel/calm"] as BlockId[] })).toEqual(["neon", "spin-a"]);
    expect(trashRefusal(wheel, v("calm"), main("calm"))).toBe("Main can't be trashed");
    expect(trashRefusal(wheel, v("neon"), main("calm"))).toBe(null);
    expect(trashRefusal(sheet, v("sheet"), NONE)).toBe("Main can't be trashed");
  });

  test("a 👍 makes Main, a second undoes it, and on a vary option it brings the varied element into Main instead", () => {
    expect(approval(wheel, block("calm"), NONE)).toEqual({ kind: "main" });
    expect(approval(wheel, block("calm"), main("calm"))).toEqual({ kind: "unmain" });
    expect(approval(wheel, option, NONE), "with no Main yet, an option can become Main").toEqual({ kind: "main" });
    expect(approval(wheel, option, main("neon"))).toEqual({ kind: "graft", from: { blockId: "wheel/spin-a", part: SPIN } });
    const grafted = withApproval(main("neon"), wheel, option);
    expect(approval(wheel, option, grafted)).toEqual({ kind: "ungraft", graft: grafted.grafts[0] });
    expect(withApproval(grafted, wheel, option).grafts).toEqual([]);
    expect(approval(wheel, block("calm", { blockId: "wheel/neon" as BlockId, part: null }), main("neon")), "a whole-block vary has no element to bring").toEqual({ kind: "main" });
  });

  test("a 👍 that makes Main brings a trashed variant back", () => {
    const marks = withApproval(withTrash(NONE, "wheel/calm" as BlockId, true), wheel, block("calm"));
    expect(marks).toEqual({ ...main("calm"), trashed: [] });
  });
});

describe("confirm", () => {
  test("has nothing to do until a Main, a trash or a pick narrows something", () => {
    expect(confirmPlan(slots, NONE)).toBe(null);
    expect(confirmPlan([sheet], main("sheet")), "a lone variant chosen as Main changes nothing").toBe(null);
  });

  test("keeps only Main where there is one, chosen or the only one left, drops the trashed elsewhere, and carries the picks", () => {
    const sheetMain = { slot: "result", variant: "sheet" };
    expect(confirmPlan(slots, main("neon"))).toEqual({ kind: "confirm", mains: [{ slot: "wheel", variant: "neon" }, sheetMain], grafts: [], drop: ["wheel/calm", "wheel/spin-a"] });
    expect(confirmPlan(slots, withTrash(NONE, "wheel/calm" as BlockId, true))).toEqual({ kind: "confirm", mains: [sheetMain], grafts: [], drop: ["wheel/calm"] });
    const picked = withGraft(main("neon"), { from: { blockId: "wheel/calm" as BlockId, part: SPIN }, into: wheel.id, instruction: "under the title" });
    const plan = confirmPlan(slots, picked)!;
    expect(plan.grafts).toEqual([{ from: { blockId: "wheel/calm", part: SPIN }, into: "wheel", instruction: "under the title" }]);
    expect(confirmLines(slots, plan), "every slot, the unchanged one too").toEqual([
      { slot: "wheel", keeps: ["neon"], grafts: plan.grafts, dropped: 2 },
      { slot: "result", keeps: ["sheet"], grafts: [], dropped: 0 },
    ]);
  });

  test("names a slot's only variant as its Main, so a pick into it reaches the agent with somewhere to go", () => {
    const narrowed = [{ id: wheel.id, variants: [v("neon")] }, sheet];
    const plan = confirmPlan(narrowed, withGraft(NONE, { from: { blockId: "result/sheet" as BlockId, part: SPIN }, into: wheel.id, instruction: null }))!;
    expect(plan.mains).toEqual([{ slot: "wheel", variant: "neon" }, { slot: "result", variant: "sheet" }]);
    expect(plan.grafts.map((g) => g.into)).toEqual(["wheel"]);
  });

  test("reads no graft into a slot with no Main, nor one taken from Main itself, and reads them again once Main makes sense of them", () => {
    const grafted = withApproval(main("neon"), wheel, option);
    const unmained = withApproval(grafted, wheel, block("neon"));
    expect(liveMarks(unmained, slots).grafts, "Stop keeping this as Main leaves the pick waiting").toEqual([]);
    expect(confirmPlan(slots, unmained), "so Confirm has nothing to send").toBe(null);
    expect(liveMarks(withApproval(unmained, wheel, block("neon")), slots).grafts).toEqual(grafted.grafts);
    const fromMain = { ...grafted, mains: { [wheel.id]: v("spin-a") } };
    expect(liveMarks(fromMain, slots).grafts, "an element already in Main").toEqual([]);
  });

  test("forgets marks on blocks a later iteration no longer has", () => {
    const stale: Marks = {
      mains: { [wheel.id]: v("gone") },
      grafts: [{ id: 1 as StoredGraft["id"], from: { blockId: "wheel/gone" as BlockId, part: null }, into: wheel.id, instruction: null }],
      trashed: ["wheel/gone", "wheel/calm"] as BlockId[],
    };
    expect(liveMarks(stale, slots)).toEqual({ mains: {}, grafts: [], trashed: ["wheel/calm"] });
  });

  test("a pick lands in the slot's Main, or makes what Rob is looking at Main first, and refuses Main's own elements", () => {
    const from = { blockId: "result/sheet" as BlockId, part: SPIN };
    expect(withPick(main("calm"), wheel, from, "smaller", v("neon"))).toEqual({ ...main("calm"), grafts: [{ id: 1, from, into: "wheel", instruction: "smaller" }] });
    expect(withPick(NONE, wheel, from, null, v("spin-a"))).toEqual({ ...main("spin-a"), grafts: [{ id: 1, from, into: "wheel", instruction: null }] });
    const trashedActive = withTrash(NONE, "wheel/spin-a" as BlockId, true);
    expect(withPick(trashedActive, wheel, from, null, v("spin-a")), "a trashed variant on show never becomes Main").toEqual({
      ...trashedActive,
      mains: { [wheel.id]: v("neon") },
      grafts: [{ id: 1, from, into: "wheel", instruction: null }],
    });
    expect(withPick(NONE, wheel, { blockId: "wheel/calm" as BlockId, part: SPIN }, null, v("calm"))).toEqual({ refused: "That element is already in Main" });
    expect(withPick(NONE, sheet, from, null, null), "the only variant is Main already").toEqual({ refused: "That element is already in Main" });
  });

  test("numbers the window's own picks on from the highest", () => {
    const one = withGraft(NONE, { from: { blockId: "wheel/calm" as BlockId, part: null }, into: wheel.id, instruction: null });
    const two = withGraft(one, { from: { blockId: "wheel/neon" as BlockId, part: SPIN }, into: sheet.id, instruction: null });
    expect(two.grafts.map((g) => g.id)).toEqual([1, 2]);
  });
});
