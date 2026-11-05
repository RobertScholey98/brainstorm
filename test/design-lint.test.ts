import { beforeAll, describe, expect, it } from "vitest";
import { lintRenderer, lintSource, loadDesign, type Design } from "../scripts/design/lint.mjs";

let design: Design;
beforeAll(async () => {
  design = await loadDesign();
});

const rules = (source: string, kit = false) => lintSource(design, source, { kit }).map(({ rule, line, text }) => ({ rule, line, text }));

describe("design lint", () => {
  it("arbitrary-value: fails an arbitrary value outside the kit, and allows it in components/ui", () => {
    const source = `<p className="text-sm text-[13px]">\n  <span className={cn("p-2", "w-[300px]")} />\n</p>`;
    expect(rules(source)).toEqual([
      { rule: "arbitrary-value", line: 1, text: "text-[13px]" },
      { rule: "arbitrary-value", line: 2, text: "w-[300px]" },
    ]);
    expect(rules(source, true)).toEqual([]);
    expect(rules(`<p className="data-[selected]:bg-selected [&>svg]:size-4" />`)).toEqual([]);
  });

  it("raw-colour: fails hex and colour functions in any string, kit included", () => {
    const source = `const pin = "#3b63e6";\nconst edge = { boxShadow: "0 0 0 1px rgb(0 0 0 / 0.1)" };\n<i className="shadow-[0_0_0_1px_oklch(0.5_0.1_250)]" />`;
    expect(rules(source, true)).toEqual([
      { rule: "raw-colour", line: 1, text: "#3b63e6" },
      { rule: "raw-colour", line: 2, text: "0 0 0 1px rgb(0 0 0 / 0.1)" },
      { rule: "raw-colour", line: 3, text: "shadow-[0_0_0_1px_oklch(0.5_0.1_250)]" },
    ]);
    expect(rules(`const ref = "#1"; const tag = "#abcz";`)).toEqual([]);
  });

  it("off-scale: fails utilities the closed theme doesn't generate", () => {
    expect(rules(`<p className="p-7 text-xl rounded-2xl shadow-2xl font-bold bg-white text-sm/6 p-2" />`)).toEqual([
      { rule: "off-scale", line: 1, text: "p-7" },
      { rule: "off-scale", line: 1, text: "text-xl" },
      { rule: "off-scale", line: 1, text: "rounded-2xl" },
      { rule: "off-scale", line: 1, text: "shadow-2xl" },
      { rule: "off-scale", line: 1, text: "font-bold" },
      { rule: "off-scale", line: 1, text: "bg-white" },
      { rule: "off-scale", line: 1, text: "text-sm/6" },
    ]);
  });

  it("off-scale: fails numeric z-index, sizing steps on spacing, and wide rings", () => {
    expect(rules(`<p className="z-10 z-popover gap-2.5 px-3.5 m-inspector h-7 size-3.5 ring-3 ring-2" />`, true)).toEqual([
      { rule: "off-scale", line: 1, text: "z-10" },
      { rule: "off-scale", line: 1, text: "gap-2.5" },
      { rule: "off-scale", line: 1, text: "px-3.5" },
      { rule: "off-scale", line: 1, text: "m-inspector" },
      { rule: "off-scale", line: 1, text: "ring-3" },
    ]);
  });

  it("reads class strings outside className only when they are wholly classes", () => {
    const source = `const cls = "size-4 shrink-0 text-open";\n<Popover align="end" />\n<Icon data-icon="inline-start" />\nconst note = "Pick a brainstorm to start";`;
    expect(rules(source)).toEqual([{ rule: "off-scale", line: 1, text: "text-open" }]);
  });

  it("passes on the renderer as it stands", async () => {
    expect(await lintRenderer()).toEqual([]);
  });
});
