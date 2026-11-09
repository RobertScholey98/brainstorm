import { expect, test } from "vitest";
import { bakeDefaults, branchTitle } from "../src/core/branch";
import type { PropName } from "../src/core/types";

test("bakeDefaults changes only the defaults it names", () => {
  const json = JSON.stringify({ title: "Neon wheel", props: { appearance: { accent: { type: "color", label: "Accent", default: "#ff2bd6" } } } });
  expect(JSON.parse(bakeDefaults(json, [{ prop: "accent" as PropName, value: "#00ff88" }]))).toEqual({
    title: "Neon wheel",
    props: { appearance: { accent: { type: "color", label: "Accent", default: "#00ff88" } } },
  });
  expect(bakeDefaults(json, []), "nothing to bake leaves the file byte for byte").toBe(json);
});

test("branchTitle is the instruction's first clause, cut at a word", () => {
  expect(branchTitle("Try it as a slot machine, with three reels")).toBe("Try it as a slot machine");
  expect(branchTitle("  calmer\nand smaller")).toBe("calmer");
  expect(branchTitle("A very long instruction that keeps going well past the limit of the title")).toBe("A very long instruction that keeps going well…");
  expect(branchTitle("ok. then more")).toBe("ok. then more");
});
