import { describe, expect, test } from "vitest";
import { classifyOverrides, parseAppearanceValue, parsePropsSchema, resolveProps } from "../src/core/props";
import type { BlockId, Override, PropName } from "../src/core/types";
import { accent, density, headline, parsedWheel, showOdds, spin, wheelProps } from "./fixtures";

const invalid = (pointer: string, message: string) => ({
  severity: "error",
  code: "invalid_prop",
  file: null,
  loc: null,
  pointer,
  message,
});

describe("parsePropsSchema", () => {
  test("parses the design.md example in schema order with defaults filled", () => {
    expect(parsePropsSchema(wheelProps)).toEqual({ ok: true, value: parsedWheel, warnings: [] });
  });

  test("an empty object is an empty schema", () => {
    expect(parsePropsSchema({})).toEqual({ ok: true, value: { data: [], appearance: [] }, warnings: [] });
  });

  test("reports every rule break at its pointer", () => {
    const result = parsePropsSchema({
      data: { people: { type: "data", sample: [] } },
      appearance: {
        people: { type: "boolean", label: "Clash", default: false },
        "spin-time": { type: "boolean", label: "Bad name", default: false },
        key: { type: "boolean", label: "Reserved", default: false },
        speed: { type: "number", label: "Speed", default: 9, min: 0, max: 5 },
        flipped: { type: "number", label: "Flipped", default: 1, min: 5, max: 0 },
        size: { type: "enum", label: "Size", default: "xl", options: ["s", "m", "s"] },
        none: { type: "enum", label: "None", default: "a", options: [] },
        tint: { type: "color", label: "Tint", default: "pink" },
      },
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        invalid("/appearance/spin-time", '"spin-time" is not a camelCase identifier'),
        invalid("/appearance/key", '"key" is reserved by React; choose another name'),
        invalid("/appearance/people", '"people" is both a data and an appearance prop; the block gets one flat props object'),
        invalid("/appearance/speed/default", "default 9 is outside 0–5"),
        invalid("/appearance/flipped/max", "max (0) must be greater than min (5)"),
        invalid("/appearance/size/options", 'option "s" appears twice'),
        invalid("/appearance/size/default", 'default "xl" is not one of the options'),
        invalid("/appearance/none/options", "options must not be empty"),
        invalid("/appearance/tint/default", 'default "pink" is not #rrggbb'),
      ],
    });
  });

  test("reports shape errors from the field schemas", () => {
    expect(
      parsePropsSchema({
        appearance: {
          spin: { type: "slider", label: "Spin" },
          speed: { type: "number", label: "Speed", default: "1", min: 0, max: 5, defualt: 1 },
          odds: { type: "boolean", label: "Odds" },
        },
        state: {},
      }),
    ).toEqual({
      ok: false,
      issues: [
        invalid("/appearance/spin/type", "Invalid discriminator value. Expected 'number' | 'enum' | 'color' | 'boolean' | 'text'"),
        invalid("/appearance/speed/default", "Invalid input: expected number, received string"),
        invalid("/appearance/speed", 'Unrecognized key: "defualt"'),
        invalid("/appearance/odds/default", 'missing "default"'),
        invalid("", 'Unrecognized key: "state"'),
      ],
    });
  });
});

describe("parseAppearanceValue", () => {
  test("accepts a value that fits the prop", () => {
    expect(parseAppearanceValue(spin, 2)).toEqual({ ok: true, value: 2 });
    expect(parseAppearanceValue(accent, "#00ff00")).toEqual({ ok: true, value: "#00ff00" });
    expect(parseAppearanceValue(density, "compact")).toEqual({ ok: true, value: "compact" });
    expect(parseAppearanceValue(showOdds, false)).toEqual({ ok: true, value: false });
    expect(parseAppearanceValue(headline, "Spin!")).toEqual({ ok: true, value: "Spin!" });
  });

  test("names why a value does not fit", () => {
    expect(parseAppearanceValue(spin, 9)).toEqual({ ok: false, reason: "out_of_range" });
    expect(parseAppearanceValue(spin, "2")).toEqual({ ok: false, reason: "type_changed" });
    expect(parseAppearanceValue(density, "huge")).toEqual({ ok: false, reason: "option_removed" });
    expect(parseAppearanceValue(accent, "red")).toEqual({ ok: false, reason: "type_changed" });
    expect(parseAppearanceValue(showOdds, "yes")).toEqual({ ok: false, reason: "type_changed" });
    expect(parseAppearanceValue(headline, 3)).toEqual({ ok: false, reason: "type_changed" });
  });
});

describe("overrides", () => {
  const o = (blockId: string, prop: string, value: number | string | boolean): Override => ({
    blockId: blockId as BlockId,
    prop: prop as PropName,
    value,
    setAt: "2026-11-05T10:00:00Z",
  });

  test("classifies each stored override against the current schemas", () => {
    const overrides = [
      o("wheel/neon", "accent", "#000000"),
      o("wheel/neon", "spinSeconds", 7),
      o("wheel/neon", "density", "dense"),
      o("wheel/neon", "gone", 1),
      o("wheel/neon", "people", "x"),
      o("wheel/neon", "showOdds", "no"),
      o("wheel/old", "accent", "#000000"),
    ];
    expect(classifyOverrides(new Map([["wheel/neon" as BlockId, parsedWheel]]), overrides)).toEqual({
      applicable: [o("wheel/neon", "accent", "#000000")],
      inapplicable: [
        { override: o("wheel/neon", "spinSeconds", 7), reason: "out_of_range" },
        { override: o("wheel/neon", "density", "dense"), reason: "option_removed" },
        { override: o("wheel/neon", "gone", 1), reason: "prop_removed" },
        { override: o("wheel/neon", "people", "x"), reason: "type_changed" },
        { override: o("wheel/neon", "showOdds", "no"), reason: "type_changed" },
        { override: o("wheel/old", "accent", "#000000"), reason: "block_removed" },
      ],
    });
  });

  test("resolves samples, then defaults, then overrides into one flat object", () => {
    expect(resolveProps(parsedWheel, [o("wheel/neon", "accent", "#000000"), o("wheel/neon", "showOdds", false)])).toEqual({
      people: [{ name: "Kai" }, { name: "Roz" }],
      spinSeconds: 1.5,
      accent: "#000000",
      density: "roomy",
      showOdds: false,
      headline: "Who's up?",
    });
  });
});
