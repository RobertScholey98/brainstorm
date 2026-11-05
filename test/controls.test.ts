import { describe, expect, test } from "vitest";
import { controlVocabulary, deriveControls, validateControls } from "../src/core/controls";
import { parsedWheel } from "./fixtures";

const control = (type: string, prop: string, label: string | null = null) => ({
  type,
  props: { label, value: { $bindState: `/${prop}` } },
  children: [],
});

const err = (code: string, pointer: string, message: string) => ({
  severity: "error",
  code,
  file: null,
  loc: null,
  pointer,
  message,
});

const uncontrolled = (prop: string) => ({
  severity: "warning",
  code: "uncontrolled_prop",
  file: null,
  loc: null,
  pointer: null,
  message: `appearance prop "${prop}" has no control, so Rob can't adjust it`,
});

describe("validateControls", () => {
  test("accepts a spec written without children arrays and fills them and default labels", () => {
    const raw = {
      root: "main",
      elements: {
        main: { type: "Section", props: { title: "Wheel" }, children: ["spin", "look"] },
        spin: { type: "Slider", props: { label: "Speed", value: { $bindState: "/spinSeconds" } } },
        look: { type: "Section", props: {}, children: ["accent", "density", "odds", "headline"] },
        accent: { type: "Colour", props: { value: { $bindState: "/accent" } } },
        density: { type: "Select", props: { label: null, value: { $bindState: "/density" } } },
        odds: { type: "Toggle", props: { label: null, value: { $bindState: "/showOdds" } } },
        headline: { type: "Text", props: { label: null, value: { $bindState: "/headline" } } },
      },
    };
    expect(validateControls(raw, parsedWheel)).toEqual({
      ok: true,
      value: {
        root: "main",
        elements: {
          main: { type: "Section", props: { title: "Wheel" }, children: ["spin", "look"] },
          spin: control("Slider", "spinSeconds", "Speed"),
          look: { type: "Section", props: { title: null }, children: ["accent", "density", "odds", "headline"] },
          accent: control("Colour", "accent"),
          density: control("Select", "density"),
          odds: control("Toggle", "showOdds"),
          headline: control("Text", "headline"),
        },
      },
      warnings: [],
    });
  });

  test("warns for each appearance prop an explicit spec leaves without a control", () => {
    const raw = {
      root: "main",
      elements: {
        main: { type: "Section", props: { title: null }, children: ["spin"] },
        spin: control("Slider", "spinSeconds"),
      },
    };
    const result = validateControls(raw, parsedWheel);
    expect(result).toEqual({
      ok: true,
      value: raw,
      warnings: [uncontrolled("accent"), uncontrolled("density"), uncontrolled("showOdds"), uncontrolled("headline")],
    });
  });

  test("structural errors come from validateSpec", () => {
    expect(
      validateControls(
        { root: "main", elements: { main: { type: "Section", props: { title: null }, children: ["nope"] } } },
        parsedWheel,
      ),
    ).toEqual({
      ok: false,
      issues: [
        err(
          "invalid_controls",
          "/elements/main",
          'Element "main" references child "nope" which does not exist in the elements map.',
        ),
      ],
    });
    expect(validateControls([], parsedWheel)).toEqual({
      ok: false,
      issues: [err("invalid_controls", "", 'expected { "root": "<key>", "elements": { … } }')],
    });
  });

  test("unknown component types come from catalog.validate", () => {
    expect(validateControls({ root: "x", elements: { x: { type: "Knob", props: {} } } }, parsedWheel)).toEqual({
      ok: false,
      issues: [
        err(
          "invalid_controls",
          "/elements/x/type",
          'Invalid option: expected one of "Section"|"Slider"|"Select"|"Segmented"|"Colour"|"Toggle"|"Text"',
        ),
      ],
    });
  });

  test("checks props against the catalog and every binding against the props schema", () => {
    const raw = {
      root: "main",
      elements: {
        main: {
          type: "Section",
          props: { title: null },
          children: ["a", "b", "c", "d", "e", "f", "g"],
        },
        a: control("Slider", "people"),
        b: control("Slider", "missing"),
        c: control("Toggle", "accent"),
        d: { type: "Slider", props: { label: null, value: { $bindState: "/spinSeconds" }, min: 0 } },
        e: { type: "Slider", props: { label: null, value: { $bindState: "spinSeconds" } } },
        f: { ...control("Segmented", "density"), children: ["g"] },
        g: { ...control("Colour", "accent"), visible: true },
      },
    };
    expect(validateControls(raw, parsedWheel)).toEqual({
      ok: false,
      issues: [
        err("bad_binding", "/elements/a/props/value/$bindState", 'Slider binds "people", a data prop; only appearance props are controllable'),
        err("bad_binding", "/elements/b/props/value/$bindState", 'Slider binds "missing", which is not an appearance prop'),
        err("bad_binding", "/elements/c/props/value/$bindState", 'Toggle binds boolean props, but "accent" is color'),
        err("invalid_controls", "/elements/d/props", 'Unrecognized key: "min"'),
        err("invalid_controls", "/elements/e/props/value/$bindState", 'expected "/<propName>"'),
        err("invalid_controls", "/elements/f/children", "Segmented cannot have children"),
        err("invalid_controls", "/elements/g/visible", 'unexpected key "visible"; controls support type, props and children'),
        uncontrolled("spinSeconds"),
        uncontrolled("accent"),
        uncontrolled("showOdds"),
        uncontrolled("headline"),
      ],
    });
  });
});

test("deriveControls makes one titled Section with a control per appearance prop in schema order", () => {
  expect(deriveControls(parsedWheel, "Neon wheel")).toEqual({
    root: "section",
    elements: {
      section: {
        type: "Section",
        props: { title: "Neon wheel" },
        children: ["control-spinSeconds", "control-accent", "control-density", "control-showOdds", "control-headline"],
      },
      "control-spinSeconds": control("Slider", "spinSeconds"),
      "control-accent": control("Colour", "accent"),
      "control-density": control("Segmented", "density"),
      "control-showOdds": control("Toggle", "showOdds"),
      "control-headline": control("Text", "headline"),
    },
  });
});

test("a derived spec validates with no warnings, and enums with four options derive a Select", () => {
  const schema = {
    data: [],
    appearance: [
      ...parsedWheel.appearance,
      { name: "size", type: "enum", label: "Size", default: "s", options: ["s", "m", "l", "xl"] },
    ],
  } as unknown as typeof parsedWheel;
  const derived = deriveControls(schema, "Wheel");
  expect(derived.elements["control-size"]).toEqual(control("Select", "size"));
  expect(validateControls(derived, schema)).toEqual({ ok: true, value: derived, warnings: [] });
});

test("controlVocabulary lists every control with the prop type it binds and the derivation rule", () => {
  const lines = controlVocabulary().split("\n");
  expect(lines).toContain(
    '- Slider { "label": string | null, "value": { "$bindState": "/<number prop>" } }: a slider over the prop\'s min, max and step, showing its unit.',
  );
  expect(lines).toContain(
    '- Segmented { "label": string | null, "value": { "$bindState": "/<enum prop>" } }: a row of buttons, one per option; suits up to 3 options.',
  );
  expect(lines).toContain(
    "Without controls.json, Brainstorm derives one Section titled with the block title, holding one control per appearance prop in schema order: number → Slider; enum → Segmented with up to 3 options, otherwise Select; color → Colour; boolean → Toggle; text → Text.",
  );
  expect(lines.filter((l) => l.startsWith("- "))).toHaveLength(7);
});
