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

  it("surface-recipe: fails a raised fill or floating shadow outside the overlay recipe, kit included", () => {
    expect(rules(`<div className="rounded-lg bg-raised shadow-md" />\nconst pill = "shadow-lg bg-card shadow-sm";`, true)).toEqual([
      { rule: "surface-recipe", line: 1, text: "bg-raised" },
      { rule: "surface-recipe", line: 1, text: "shadow-md" },
      { rule: "surface-recipe", line: 2, text: "shadow-lg" },
    ]);
  });

  it("title-hint: fails a native title on an element or kit component, and allows the iframe's name and plain props", () => {
    const source = [
      `import { Button, Hint } from "@/components/ui/button";`,
      `<span title="Thread lost" />`,
      `<Button variant="ghost"\n  title={label}>Reset</Button>`,
      `<iframe title="Canvas" src="/canvas" sandbox="allow-scripts" />`,
      `<SessionPanel title={view.title} />`,
      `<Hint label="Reset" side="left"><Button>Reset</Button></Hint>`,
    ].join("\n");
    expect(rules(source)).toEqual([
      { rule: "title-hint", line: 2, text: "<span title>" },
      { rule: "title-hint", line: 4, text: "<Button title>" },
    ]);
    expect(rules(`<span title="x" />`, true)).toEqual([]);
  });

  it("kit-override: fails a look class on a kit component with variants, and allows layout", () => {
    const source = [
      `import { Button } from "@/components/ui/button";`,
      `import { Badge as Chip } from "@/components/ui/badge";`,
      `<Button variant="ghost" className="ml-auto w-fit shrink-0 text-warning hover:bg-warning/10">Dismiss</Button>`,
      `<Button className={cn("flex-1", open && "bg-muted")} />`,
      `<Chip className="ml-2" />`,
      `<Badge className="text-xs" />`,
    ].join("\n");
    expect(rules(source)).toEqual([
      { rule: "kit-override", line: 3, text: "<Button> text-warning" },
      { rule: "kit-override", line: 3, text: "<Button> hover:bg-warning/10" },
      { rule: "kit-override", line: 4, text: "<Button> bg-muted" },
    ]);
  });

  it("focus-ring: fails a diluted ring token and any other focus ring colour, kit included", () => {
    const source = `<p className="focus-visible:ring-2 focus-visible:ring-ring/50 ring-ring/40 focus-visible:ring-danger/20 has-focus-visible:ring-accent" />\n<p className="focus-visible:ring-2 focus-visible:ring-ring has-focus-visible:ring-ring hover:ring-border-strong ring-inset outline-hidden ring-0" />`;
    expect(rules(source, true)).toEqual([
      { rule: "focus-ring", line: 1, text: "focus-visible:ring-ring/50" },
      { rule: "focus-ring", line: 1, text: "ring-ring/40" },
      { rule: "focus-ring", line: 1, text: "focus-visible:ring-danger/20" },
      { rule: "focus-ring", line: 1, text: "has-focus-visible:ring-accent" },
    ]);
  });

  it("callout-actions: fails a button in a Callout's message, and allows one in its actions or a CalloutItem's", () => {
    const source = [
      `import { Callout, CalloutItem } from "@/components/ui/callout";`,
      `<Callout tone="warning" actions={<Button>Copy</Button>}>`,
      `  <p>Say this</p>`,
      `  <CalloutItem actions={<Button>Dismiss</Button>}>accent</CalloutItem>`,
      `  <li><span>accent</span> <Button variant="ghost">Dismiss</Button></li>`,
      `</Callout>`,
      `<Button>Outside</Button>`,
    ].join("\n");
    expect(rules(source)).toEqual([{ rule: "callout-actions", line: 5, text: "<Button> in a Callout message" }]);
  });

  it("inverse-fill: fails an inverse fill on any control, kit included", () => {
    expect(rules(`<Button className={cn("bg-inverse")} />\nconst v = cva("data-checked:bg-inverse hover:bg-inverse/80");`, true)).toEqual([
      { rule: "inverse-fill", line: 1, text: "bg-inverse" },
      { rule: "inverse-fill", line: 2, text: "data-checked:bg-inverse" },
      { rule: "inverse-fill", line: 2, text: "hover:bg-inverse/80" },
    ]);
    expect(rules(`<span className="bg-inverse-fg/15 text-inverse-fg" />`, true)).toEqual([]);
  });

  it("chip-recipe: fails a code or key element that paints its own fill, kit included", () => {
    const source = [`<code className="rounded-md bg-muted px-1">x</code>`, `<kbd className={cn("bg-card", size)}>K</kbd>`, `<code className={cn(chip, "px-1")}>y</code>`, `<span className="bg-muted" />`].join("\n");
    expect(rules(source, true)).toEqual([
      { rule: "chip-recipe", line: 1, text: "<code> bg-muted" },
      { rule: "chip-recipe", line: 2, text: "<kbd> bg-card" },
    ]);
  });

  it("hint-side: fails a Hint without a side, and a header hint that opens up or down", () => {
    const source = [`<Hint label="a"><b /></Hint>`, `<Hint label="b" side="bottom"><b /></Hint>`, `<Hint label="c" side={"top"}><b /></Hint>`, `<Hint label="d" side="left"><b /></Hint>`].join("\n");
    const header = (file: string) => lintSource(design, source, { file }).map(({ rule, line, text }) => ({ rule, line, text }));
    expect(header("src/renderer/TopBar.tsx")).toEqual([
      { rule: "hint-side", line: 1, text: "<Hint> without side" },
      { rule: "hint-side", line: 2, text: `<Hint side="bottom">` },
      { rule: "hint-side", line: 3, text: `<Hint side="top">` },
    ]);
    expect(header("src/renderer/CanvasBar.tsx")).toEqual([{ rule: "hint-side", line: 1, text: "<Hint> without side" }]);
  });

  it("dismiss-ghost: fails a Cancel or Done button that isn't ghost, and leaves other buttons alone", () => {
    const source = [
      `<Button onClick={close}>Cancel</Button>`,
      `<Button variant="outline">Done</Button>`,
      `<Button variant="ghost" onClick={close}>Cancel</Button>`,
      `<Button variant="outline">Delete</Button>`,
    ].join("\n");
    expect(rules(source)).toEqual([
      { rule: "dismiss-ghost", line: 1, text: "<Button> Cancel" },
      { rule: "dismiss-ghost", line: 2, text: "<Button> Cancel" },
    ]);
  });

  it("raw-part: fails a pin's part shown as its raw id, and allows partLabel and a data attribute", () => {
    const source = [
      `<span>{f.pin.part ?? "whole block"}</span>`,
      `<span>{pin.part === null ? "whole block" : partLabel(pin.part)}</span>`,
      `<i data-part={pin.part} />`,
      `<b>{target.part}</b>`,
    ].join("\n");
    expect(rules(source)).toEqual([
      { rule: "raw-part", line: 1, text: `<span>{f.pin.part ?? "whole block"}</span>` },
      { rule: "raw-part", line: 4, text: "<b>{target.part}</b>" },
    ]);
  });

  it("field-fill: fails a field tinted with its border in dark, in the kit and out of it, and allows the card fill", () => {
    const source = [`<div className="rounded-md border border-border-strong dark:bg-border-strong/30" />`, `<div className="rounded-md border border-border-strong bg-card" />`].join("\n");
    expect(rules(source)).toEqual([{ rule: "field-fill", line: 1, text: "dark:bg-border-strong/30" }]);
    expect(rules(source, true)).toEqual([{ rule: "field-fill", line: 1, text: "dark:bg-border-strong/30" }]);
  });

  it("overlay-kit: fails an overlay drawn from the surface recipe outside the kit, and allows the kit", () => {
    const source = [`<div className={cn(overlaySurface(), "absolute grid w-popover-sm p-3")} />`, `<OverlayPanel style={{ left, top }} />`].join("\n");
    expect(rules(source)).toEqual([{ rule: "overlay-kit", line: 1, text: "overlaySurface()" }]);
    expect(rules(source, true)).toEqual([]);
  });

  it("hint-side: fails a sidebar hint that opens anywhere but left, over the main panel or the rows beside it", () => {
    const source = [`<Hint label="a" side="right"><b /></Hint>`, `<Hint label="b" side="top"><b /></Hint>`, `<Hint label="c" side="left"><b /></Hint>`].join("\n");
    expect(lintSource(design, source, { file: "src/renderer/Sidebar.tsx" }).map(({ rule, line, text }) => ({ rule, line, text }))).toEqual([
      { rule: "hint-side", line: 1, text: `<Hint side="right">` },
      { rule: "hint-side", line: 2, text: `<Hint side="top">` },
    ]);
  });

  it("page-title: fails the title step outside the kit, where PageHeader is its one user", () => {
    const source = `<h1 className="text-title font-semibold" />\n<h2 className="text-lg font-semibold" />`;
    expect(rules(source)).toEqual([{ rule: "page-title", line: 1, text: "text-title" }]);
    expect(rules(source, true)).toEqual([]);
  });

  it("inline-size: fails an inline size that is a number or a named constant, and allows a measured one and the kit", () => {
    const source = [
      `<div style={{ left, top, width: COMPOSER.width }} />`,
      `<div style={{ minHeight: 120, maxWidth: "20rem" }} />`,
      `<div style={{ width }} />`,
      `<div style={{ width: frame.width * zoom, height: rect.height }} />`,
    ].join("\n");
    expect(rules(source)).toEqual([
      { rule: "inline-size", line: 1, text: "<div> width: COMPOSER.width" },
      { rule: "inline-size", line: 2, text: "<div> minHeight: 120" },
      { rule: "inline-size", line: 2, text: `<div> maxWidth: "20rem"` },
    ]);
    expect(rules(source, true)).toEqual([]);
  });

  it("frame-sandbox: fails an iframe that isn't a canvas page under the bare scripts sandbox, kit included", () => {
    expect(rules(`<iframe src="/canvas" sandbox="allow-scripts" />\n<iframe title="Preview" src="/canvas/preview" sandbox="allow-scripts" />`, true)).toEqual([]);
    expect(rules(`<iframe src="/canvas/preview" sandbox="allow-scripts allow-same-origin" />\n<iframe src="https://x.test" sandbox="allow-scripts" />\n<iframe src="/canvas" />`, true)).toEqual([
      { rule: "frame-sandbox", line: 1, text: "<iframe src=/canvas/preview sandbox=allow-scripts allow-same-origin>" },
      { rule: "frame-sandbox", line: 2, text: "<iframe src=https://x.test sandbox=allow-scripts>" },
      { rule: "frame-sandbox", line: 3, text: "<iframe src=/canvas sandbox=undefined>" },
    ]);
  });

  it("passes on the renderer as it stands", async () => {
    expect(await lintRenderer()).toEqual([]);
  });
});
