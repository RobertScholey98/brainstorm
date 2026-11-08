import { describe, expect, test } from "vitest";
import type { BlockFiles, FileMap, IterationContents, IterationN, SessionId } from "../src/core/types";
import { contentHash, emitWorkingCopy, parseWorkingCopy } from "../src/core/workingCopy";
import { parsedWheel, wheelProps } from "./fixtures";

const wheelTsx = `import { useState } from "react";
export default function Wheel({ people, accent }) {
  const [spinning, setSpinning] = useState(false);
  return <div style={{ "--accent": accent }}>{people.map((p) => <span key={p.name} data-part={\`slice-\${p.name}\`}>{p.name}</span>)}</div>;
}
`;
const neonJson = JSON.stringify({ title: "Neon wheel", props: wheelProps }, null, 2) + "\n";
const classicJson = JSON.stringify({ title: "Classic wheel", props: {} }) + "\n";
const neonControls =
  JSON.stringify({
    root: "main",
    elements: {
      main: { type: "Section", props: { title: "Spin" }, children: ["spin"] },
      spin: { type: "Slider", props: { label: null, value: { $bindState: "/spinSeconds" } } },
    },
  }) + "\n";

const manifest = (slots: unknown[] = [{ id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } }]) =>
  JSON.stringify({ format: 1, session: "s_8f2k3a", base: 4, slots });

const goodCopy: FileMap = {
  ".gitignore": "*\n",
  "GUIDE.md": "anything",
  "brainstorm.json": manifest([
    { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } },
    { id: "result", title: "Result" },
  ]),
  "slots/wheel/neon/block.tsx": wheelTsx,
  "slots/wheel/neon/block.json": neonJson,
  "slots/wheel/neon/block.css": ".wheel { color: var(--accent); }\n",
  "slots/wheel/neon/controls.json": neonControls,
  "slots/wheel/classic/block.tsx": wheelTsx,
  "slots/wheel/classic/block.json": classicJson,
  "slots/result/sheet/block.tsx": wheelTsx,
  "slots/result/sheet/block.json": classicJson,
};

const neonFiles: BlockFiles = {
  tsx: wheelTsx,
  json: neonJson,
  css: ".wheel { color: var(--accent); }\n",
  controls: neonControls,
};
const classicFiles: BlockFiles = { tsx: wheelTsx, json: classicJson, css: null, controls: null };

const uncontrolled = (prop: string) => ({
  severity: "warning",
  code: "uncontrolled_prop",
  file: "slots/wheel/neon/controls.json",
  loc: null,
  pointer: null,
  message: `appearance prop "${prop}" has no control, so Rob can't adjust it`,
});

const err = (code: string, file: string | null, message: string, pointer: string | null = null) => ({
  severity: "error",
  code,
  file,
  loc: null,
  pointer,
  message,
});

describe("parseWorkingCopy", () => {
  test("parses a valid copy into a draft in manifest order, variants sorted", () => {
    const result = parseWorkingCopy(goodCopy);
    expect(result).toEqual({
      ok: true,
      value: {
        manifest: {
          format: 1,
          session: "s_8f2k3a",
          base: 4,
          slots: [
            { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } },
            { id: "result", title: "Result", frame: { width: 390, height: null } },
          ],
        },
        blocks: [
          {
            id: "wheel/classic",
            slot: "wheel",
            variant: "classic",
            hash: contentHash(classicFiles),
            files: classicFiles,
            title: "Classic wheel",
            props: { data: [], appearance: [] },
            controls: { root: "section", elements: { section: { type: "Section", props: { title: "Classic wheel" }, children: [] } } },
          },
          {
            id: "wheel/neon",
            slot: "wheel",
            variant: "neon",
            hash: contentHash(neonFiles),
            files: neonFiles,
            title: "Neon wheel",
            props: parsedWheel,
            controls: {
              root: "main",
              elements: {
                main: { type: "Section", props: { title: "Spin" }, children: ["spin"] },
                spin: { type: "Slider", props: { label: null, value: { $bindState: "/spinSeconds" } }, children: [] },
              },
            },
          },
          {
            id: "result/sheet",
            slot: "result",
            variant: "sheet",
            hash: contentHash(classicFiles),
            files: classicFiles,
            title: "Classic wheel",
            props: { data: [], appearance: [] },
            controls: { root: "section", elements: { section: { type: "Section", props: { title: "Classic wheel" }, children: [] } } },
          },
        ],
        proposed: [],
      },
      warnings: [uncontrolled("accent"), uncontrolled("density"), uncontrolled("showOdds"), uncontrolled("headline")],
    });
  });

  test("the content hash is sha256 over the block's files, blind to CRLF and a BOM", () => {
    expect(contentHash(classicFiles)).toBe("acc3c049ffdc48f82f66b016cc687faf587f2fb857116ef342075b357884bd8e");
    const windows = parseWorkingCopy({
      ...goodCopy,
      "slots/wheel/classic/block.tsx": "﻿" + wheelTsx.replace(/\n/g, "\r\n"),
    });
    const byId = (r: typeof windows) => (r.ok ? Object.fromEntries(r.value.blocks.map((b) => [b.id, b.hash])) : {});
    expect(byId(windows)["wheel/classic"]).toBe(contentHash(classicFiles));
    expect(contentHash({ ...classicFiles, css: "" })).not.toBe(contentHash(classicFiles));
    expect(contentHash({ ...classicFiles, css: "x", controls: null })).not.toBe(contentHash({ ...classicFiles, css: null, controls: "x" }));
  });

  test("every structural rule fails with an issue keyed by file", () => {
    const result = parseWorkingCopy({
      "brainstorm.json": manifest([
        { id: "wheel", title: "The wheel" },
        { id: "empty", title: "Nothing here" },
        { id: "wheel", title: "Again" },
        { id: "Bad", title: "Bad id" },
      ]),
      "notes.txt": "x",
      "slots/wheel/helper.ts": "x",
      "slots/wheel/neon/utils.ts": "x",
      "slots/wheel/neon/about.md": "**Hypothesis.** Loud wins.",
      "slots/wheel/Neon/block.tsx": wheelTsx,
      "slots/extra/one/block.tsx": wheelTsx,
      "slots/extra/one/block.json": classicJson,
      "slots/wheel/neon/block.tsx": wheelTsx,
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        err(
          "unexpected_file",
          "notes.txt",
          "Brainstorm reads only brainstorm.json, slots/<slot>/<variant>/{block.tsx,block.json,block.css,controls.json} and, with a design system, proposed/<Name>/{component.tsx,component.json,component.css}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.",
        ),
        err("invalid_id", "slots/wheel/Neon", '"Neon" must match ^[a-z][a-z0-9-]{0,31}$'),
        err(
          "unexpected_file",
          "slots/wheel/helper.ts",
          "Brainstorm reads only brainstorm.json, slots/<slot>/<variant>/{block.tsx,block.json,block.css,controls.json} and, with a design system, proposed/<Name>/{component.tsx,component.json,component.css}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.",
        ),
        err(
          "unexpected_file",
          "slots/wheel/neon/about.md",
          "Brainstorm no longer reads variant notes, so delete about.md and write no more. Rob judges the designs on the canvas himself; keep each variant's hypothesis in its design, not in a note.",
        ),
        err(
          "unexpected_file",
          "slots/wheel/neon/utils.ts",
          "Brainstorm reads only brainstorm.json, slots/<slot>/<variant>/{block.tsx,block.json,block.css,controls.json} and, with a design system, proposed/<Name>/{component.tsx,component.json,component.css}, so this file would be dropped. Blocks can't import local files; inline helpers in block.tsx.",
        ),
        err("invalid_manifest", "brainstorm.json", 'slot "wheel" is listed twice', "/slots/2/id"),
        err("invalid_id", "brainstorm.json", '"Bad" must match ^[a-z][a-z0-9-]{0,31}$', "/slots/3/id"),
        err("missing_file", "slots/wheel/neon/block.json", "block.json is required in every block (`{ \"title\": \"Neon wheel\", \"props\": { \"data\": {…}, \"appearance\": {…} } }`)"),
      ],
    });
  });

  test("an unlisted slot directory and a listed slot with no variant are both errors", () => {
    const result = parseWorkingCopy({
      "brainstorm.json": manifest([
        { id: "wheel", title: "The wheel" },
        { id: "empty", title: "Nothing here" },
      ]),
      "slots/wheel/classic/block.tsx": wheelTsx,
      "slots/wheel/classic/block.json": classicJson,
      "slots/extra/one/block.tsx": wheelTsx,
      "slots/extra/one/block.json": classicJson,
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        err("unlisted_slot", "brainstorm.json", 'slots/extra exists but "extra" is not listed in slots', "/slots"),
        err("empty_slot", "brainstorm.json", 'slot "empty" has no variants; add slots/empty/<variant>/', "/slots/1"),
      ],
    });
  });

  test("manifest problems point into brainstorm.json", () => {
    expect(parseWorkingCopy({})).toEqual({
      ok: false,
      issues: [err("missing_file", "brainstorm.json", "brainstorm.json is required; run brainstorm pull to recreate it")],
    });
    const broken = parseWorkingCopy({ "brainstorm.json": "{ nope" });
    expect(broken.ok ? [] : broken.issues.map((i) => [i.code, i.file])).toEqual([["invalid_json", "brainstorm.json"]]);
    expect(
      parseWorkingCopy({
        "brainstorm.json": JSON.stringify({
          format: 2,
          session: "nope",
          base: 0,
          slots: [{ id: "wheel", title: "W", frame: { width: 100 } }],
        }),
      }),
    ).toEqual({
      ok: false,
      issues: [
        err("invalid_manifest", "brainstorm.json", "Invalid input: expected 1", "/format"),
        err("invalid_manifest", "brainstorm.json", "Too small: expected number to be >=240", "/slots/0/frame/width"),
      ],
    });
    expect(
      parseWorkingCopy({ "brainstorm.json": JSON.stringify({ format: 1, session: "nope", base: 0, slots: [] }) }),
    ).toEqual({
      ok: false,
      issues: [
        err("invalid_manifest", "brainstorm.json", '"nope" is not a session id', "/session"),
        err("invalid_manifest", "brainstorm.json", "base must be a positive integer or null", "/base"),
      ],
    });
  });

  test("block file problems are reported in the file they belong to", () => {
    const result = parseWorkingCopy({
      "brainstorm.json": manifest([{ id: "wheel", title: "The wheel" }]),
      "slots/wheel/a/block.tsx": wheelTsx,
      "slots/wheel/a/block.json": "{ title: oops }",
      "slots/wheel/b/block.tsx": wheelTsx,
      "slots/wheel/b/block.json": JSON.stringify({ props: {}, author: "me" }),
      "slots/wheel/c/block.tsx": wheelTsx,
      "slots/wheel/c/block.json": JSON.stringify({
        title: "C",
        props: { appearance: { speed: { type: "number", label: "Speed", default: 9, min: 0, max: 5 } } },
      }),
      "slots/wheel/d/block.tsx": wheelTsx,
      "slots/wheel/d/block.json": neonJson,
      "slots/wheel/d/controls.json": JSON.stringify({
        root: "main",
        elements: { main: { type: "Toggle", props: { label: null, value: { $bindState: "/accent" } } } },
      }),
    });
    expect(result.ok).toBe(false);
    const issues = result.ok ? [] : result.issues;
    expect(issues.map((i) => ({ code: i.code, file: i.file, pointer: i.pointer }))).toEqual([
      { code: "invalid_json", file: "slots/wheel/a/block.json", pointer: null },
      { code: "invalid_block", file: "slots/wheel/b/block.json", pointer: "/title" },
      { code: "invalid_block", file: "slots/wheel/b/block.json", pointer: "" },
      { code: "invalid_prop", file: "slots/wheel/c/block.json", pointer: "/props/appearance/speed/default" },
      { code: "bad_binding", file: "slots/wheel/d/controls.json", pointer: "/elements/main/props/value/$bindState" },
      { code: "uncontrolled_prop", file: "slots/wheel/d/controls.json", pointer: null },
      { code: "uncontrolled_prop", file: "slots/wheel/d/controls.json", pointer: null },
      { code: "uncontrolled_prop", file: "slots/wheel/d/controls.json", pointer: null },
      { code: "uncontrolled_prop", file: "slots/wheel/d/controls.json", pointer: null },
      { code: "uncontrolled_prop", file: "slots/wheel/d/controls.json", pointer: null },
    ]);
    expect(issues[2]?.message).toBe('Unrecognized key: "author"');
    expect(issues[1]?.message).toBe('missing "title"');
  });
});

describe("emitWorkingCopy", () => {
  const session = "s_8f2k3a" as SessionId;

  test("an empty session gets a manifest with base null and no slots", () => {
    const files = emitWorkingCopy(session, null);
    expect(Object.keys(files)).toEqual([".gitignore", "GUIDE.md", "brainstorm.json"]);
    expect(files[".gitignore"]).toBe("*\n");
    expect(JSON.parse(files["brainstorm.json"] ?? "")).toEqual({ format: 1, session: "s_8f2k3a", base: null, slots: [] });
  });

  test("pull then commit round-trips a draft", () => {
    const parsed = parseWorkingCopy(goodCopy);
    if (!parsed.ok) throw new Error("fixture must parse");
    const iteration: IterationContents = {
      n: 4 as IterationN,
      slots: parsed.value.manifest.slots,
      blocks: parsed.value.blocks.map((b) => ({ id: b.id, files: b.files })),
      proposed: [],
    };
    const emitted = emitWorkingCopy(session, iteration);
    expect(Object.keys(emitted).sort()).toEqual([
      ".gitignore",
      "GUIDE.md",
      "brainstorm.json",
      "slots/result/sheet/block.json",
      "slots/result/sheet/block.tsx",
      "slots/wheel/classic/block.json",
      "slots/wheel/classic/block.tsx",
      "slots/wheel/neon/block.css",
      "slots/wheel/neon/block.json",
      "slots/wheel/neon/block.tsx",
      "slots/wheel/neon/controls.json",
    ]);
    expect(JSON.parse(emitted["brainstorm.json"] ?? "").slots).toEqual([
      { id: "wheel", title: "The wheel", frame: { width: 390, height: 760 } },
      { id: "result", title: "Result", frame: { width: 390 } },
    ]);
    expect(parseWorkingCopy(emitted)).toEqual(parsed);
  });

  test("GUIDE.md is generated from the validator's own rules", () => {
    const guide = emitWorkingCopy(session, null)["GUIDE.md"] ?? "";
    const lines = guide.split("\n");
    expect(lines[0]).toBe("# Brainstorm working copy for s_8f2k3a");
    expect(lines).toContain("- `frame.width` is an integer 240–1920, default 390. `frame.height` is an integer 100–4000, or absent for auto.");
    expect(lines).toContain("- It may import only `react` and `react/jsx-runtime`. TypeScript types are stripped, not checked.");
    expect(lines).toContain("- `\"number\"`: label, default, min, max, step?, unit?. `min` < `max`, and `default` within them.");
    expect(lines).toContain("  - `controls.json` (optional): a json-render controls spec; absent means derived from the props.");
    expect(lines).toContain("## Controls (`controls.json`)");
  });
});
