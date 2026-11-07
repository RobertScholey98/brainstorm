import { describe, expect, test } from "vitest";
import { bakeDefaults, carryOver, forkTitle, keyEchoesTitle, partLabel, settingText, varyNames } from "../src/core/fork";
import type { BlockId, Feedback, FeedbackId, IterationN, Override, PartName, PropName, PropsSchema, SlotId, SlotView, VariantKey } from "../src/core/types";
import { accent, density, headline, showOdds, spin } from "./fixtures";

const FRAME = { width: 390, height: null };
const slots: SlotView[] = [
  { id: "wheel" as SlotId, title: "The wheel", frame: FRAME, variants: ["neon", "calm"] as [VariantKey, VariantKey], active: "calm" as VariantKey },
  { id: "result" as SlotId, title: "Result", frame: FRAME, variants: ["sheet"] as [VariantKey], active: "sheet" as VariantKey },
];
const props: PropsSchema = { data: [], appearance: [spin, accent, density, showOdds, headline] };
const blocks = [
  { id: "wheel/neon" as BlockId, title: "Neon wheel", props },
  { id: "wheel/calm" as BlockId, title: "Calm wheel", props },
  { id: "result/sheet" as BlockId, title: "Result sheet", props: { data: [], appearance: [headline] } },
];
const override = (blockId: string, prop: string, value: Override["value"]): Override => ({ blockId: blockId as BlockId, prop: prop as PropName, value, setAt: "t" });
const pin = (id: number, blockId: string, state: "open" | "addressed"): Feedback => ({
  id: id as FeedbackId,
  pin: { blockId: blockId as BlockId, part: null },
  text: `note ${id}`,
  createdIn: 1 as IterationN,
  createdAt: "t",
  status: state === "open" ? { state, previouslyAddressedIn: null } : { state, in: 1 as IterationN },
  history: [],
});

describe("carryOver", () => {
  const input = {
    slots,
    blocks,
    picks: { wheel: "neon" as VariantKey },
    applicable: [override("wheel/neon", "accent", "#00ff88"), override("wheel/neon", "density", "roomy"), override("wheel/calm", "spinSeconds", 3)],
    feedback: [pin(1, "wheel/neon", "open"), pin(2, "wheel/calm", "open"), pin(3, "wheel/neon", "addressed"), pin(4, "result/sheet", "open")],
  };

  test("narrows each slot to its pick, keeps settings that differ from the default on a carried variant, and its open pins", () => {
    const carried = carryOver(input);
    expect(carried.ok && carried.value.slots.map((s) => [s.slot.id, s.blockId, s.title])).toEqual([
      ["wheel", "wheel/neon", "Neon wheel"],
      ["result", "result/sheet", "Result sheet"],
    ]);
    expect(carried.ok && carried.value.settings).toEqual([{ blockId: "wheel/neon", prop: "accent", value: "#00ff88", text: "Accent #00FF88" }]);
    expect(carried.ok && carried.value.pins.map((f) => f.id)).toEqual([1, 4]);
  });

  test("a slot left out of the picks carries the variant it shows", () => {
    const carried = carryOver({ ...input, picks: {} });
    expect(carried.ok && carried.value.slots[0]?.blockId).toBe("wheel/calm");
    expect(carried.ok && carried.value.settings.map((s) => s.text)).toEqual(["Spin time 3s"]);
  });

  test("refuses a pick that isn't in the iteration", () => {
    expect(carryOver({ ...input, picks: { wheel: "reel" as VariantKey } })).toEqual({ ok: false, message: "wheel/reel is not in this iteration" });
    expect(carryOver({ ...input, picks: { nope: "neon" as VariantKey } })).toEqual({ ok: false, message: "nope/neon is not in this iteration" });
  });
});

test("settingText names a setting as its control shows it, a word in the curly quotes the UI uses everywhere", () => {
  expect(settingText(spin, 2.5)).toBe("Spin time 2.5s");
  expect(settingText(accent, "#ff2bd6")).toBe("Accent #FF2BD6");
  expect(settingText(showOdds, false)).toBe("Show odds off");
  expect(settingText(density, "compact")).toBe("Density “compact”");
});

test("bakeDefaults changes only the defaults it names", () => {
  const json = JSON.stringify({ title: "Neon wheel", props: { appearance: { accent: { type: "color", label: "Accent", default: "#ff2bd6" } } } });
  expect(JSON.parse(bakeDefaults(json, [{ prop: "accent" as PropName, value: "#00ff88" }]))).toEqual({
    title: "Neon wheel",
    props: { appearance: { accent: { type: "color", label: "Accent", default: "#00ff88" } } },
  });
  expect(bakeDefaults(json, []), "nothing to bake leaves the file byte for byte").toBe(json);
});

test("forkTitle is the instruction's first clause, cut at a word", () => {
  expect(forkTitle("Try it as a slot machine, with three reels")).toBe("Try it as a slot machine");
  expect(forkTitle("  calmer\nand smaller")).toBe("calmer");
  expect(forkTitle("A very long instruction that keeps going well past the limit of the title")).toBe("A very long instruction that keeps going well…");
  expect(forkTitle("ok. then more")).toBe("ok. then more");
});

test("partLabel reads a data-part as words", () => {
  expect(partLabel("spin-button" as PartName)).toBe("Spin button");
  expect(partLabel("slice_kai" as PartName)).toBe("Slice kai");
});

describe("varyNames", () => {
  test("names variants after the element, skipping letters the slot already has", () => {
    expect(varyNames({ variant: "neon" as VariantKey, title: "Neon wheel" }, "spin-button" as PartName, ["neon", "spin-button-a"] as VariantKey[], 3)).toEqual([
      { key: "spin-button-b", title: "Spin button B" },
      { key: "spin-button-c", title: "Spin button C" },
      { key: "spin-button-d", title: "Spin button D" },
    ]);
  });

  test("a whole block is named after the block, and a part that can't start a key gets a prefix", () => {
    expect(varyNames({ variant: "neon" as VariantKey, title: "Neon wheel" }, null, [], 1)).toEqual([{ key: "neon-a", title: "Neon wheel A" }]);
    expect(varyNames({ variant: "neon" as VariantKey, title: "Neon wheel" }, "3d" as PartName, [], 1)).toEqual([{ key: "v-3d-a", title: "3d A" }]);
  });
});

test("keyEchoesTitle tells a key that only spells its title from one that says more", () => {
  expect(keyEchoesTitle("spin-button-a" as VariantKey, "Spin button A")).toBe(true);
  expect(keyEchoesTitle("neon" as VariantKey, "Neon wheel")).toBe(false);
  expect(keyEchoesTitle("reel" as VariantKey, "reel")).toBe(true);
});
