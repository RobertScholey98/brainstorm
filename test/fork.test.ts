import { describe, expect, test } from "vitest";
import { bakeDefaults, forkTitle, keyEchoesTitle, partLabel, varyNames } from "../src/core/fork";
import type { PartName, PropName, VariantKey } from "../src/core/types";

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
