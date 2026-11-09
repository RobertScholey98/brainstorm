import { describe, expect, test } from "vitest";
import { partLabel } from "../src/core/part";
import { keyEchoesTitle, varyNames } from "../src/core/vary";
import type { PartName, VariantKey } from "../src/core/types";

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
