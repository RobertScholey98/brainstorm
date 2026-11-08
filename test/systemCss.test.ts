import { describe, expect, test } from "vitest";
import { analyzeKitCss, htmlClasses, readsColorToken, resolveVars, selectorClasses, toPx } from "../src/core/system/css";
import { globToRegExp } from "../src/core/system/source";

const KIT = `
@layer theme {
  :root, :host { --spacing: 0.25rem; --radius-md: calc(var(--radius) * 0.8); --color-primary: var(--primary); }
}
:root, [data-theme='light'] { --radius: 0.625rem; --primary: oklch(0.5 0.13 185); --background: #fff; }
[data-theme='dark'] { --primary: oklch(0.7 0.1 185); --background: #000; }
:root, [data-theme] { --ring: var(--primary); }
.scroll-fade { --mask: linear-gradient(black, transparent); }
@layer base { body { background-color: var(--background); line-height: 1.5; } }
@layer utilities {
  .p-4 { padding: calc(var(--spacing) * 4); }
  .gap-2 { gap: calc(var(--spacing) * 2); }
  .rounded-md { border-radius: var(--radius-md); }
  .rounded-\\[7px\\] { border-radius: 7px; }
  .bg-primary { background-color: var(--color-primary); }
  .hover\\:bg-primary { &:hover { @media (hover: hover) { background-color: var(--color-primary); } } }
  .text-white { color: #fff; }
}
`;

describe("analyzeKitCss", () => {
  const kit = analyzeKitCss(KIT);

  test("finds the data-theme axis with its default, and not a helper class", () => {
    expect(kit.theme.axes).toEqual([{ attribute: "data-theme", values: ["light", "dark"], default: "light" }]);
  });

  test("reads tokens with their kind and per-theme values", () => {
    const primary = kit.theme.tokens.find((t) => t.name === "--primary");
    expect(primary).toEqual({
      name: "--primary",
      kind: "color",
      value: "oklch(0.5 0.13 185)",
      origin: "system",
      byAxis: { "data-theme=light": "oklch(0.5 0.13 185)", "data-theme=dark": "oklch(0.7 0.1 185)" },
    });
    expect(kit.theme.tokens.find((t) => t.name === "--radius")?.kind).toBe("length");
    expect(kit.theme.tokens.find((t) => t.name === "--spacing")?.origin).toBe("tailwind");
  });

  test("measures each family in px, with tokens resolved", () => {
    expect(kit.measured.spacing).toEqual(["8px", "16px"]);
    expect(kit.measured.radius).toEqual(["7px", "8px"]);
    expect(kit.measured.color).toEqual(["#fff", "oklch(0.5 0.13 185)"]);
  });

  test("flags an arbitrary value as off the scale", () => {
    expect(kit.offScale).toEqual([{ className: "rounded-[7px]", property: "border-radius", value: "7px" }]);
  });

  test("collects unescaped class names, nested rules included", () => {
    expect(kit.classes).toEqual(["bg-primary", "gap-2", "hover:bg-primary", "p-4", "rounded-[7px]", "rounded-md", "scroll-fade", "text-white"]);
  });

  test("keeps the body rule as the frame's surface", () => {
    expect(kit.surface).toEqual([
      { property: "background-color", value: "var(--background)" },
      { property: "line-height", value: "1.5" },
    ]);
  });

  test("knows which classes read a colour token", () => {
    expect(readsColorToken(["p-4", "bg-primary"], KIT)).toBe(true);
    expect(readsColorToken(["p-4", "text-white"], KIT)).toBe(false);
  });
});

describe("values", () => {
  test("toPx evaluates calc over px and rem, and refuses what isn't a length", () => {
    expect(toPx("calc(0.25rem * 4)")).toBe(16);
    expect(toPx("calc(0.625rem * 0.8)")).toBe(8);
    expect(toPx("12px")).toBe(12);
    expect(toPx("0")).toBe(0);
    expect(toPx("50%")).toBeNull();
    expect(toPx("1.5")).toBeNull();
  });

  test("resolveVars follows variables and falls back", () => {
    const vars = new Map([["--a", "var(--b)"], ["--b", "2px"]]);
    expect(resolveVars("calc(var(--a) * 2)", vars)).toBe("calc(2px * 2)");
    expect(resolveVars("var(--missing, 3px)", vars)).toBe("3px");
  });

  test("selectorClasses and htmlClasses unescape", () => {
    expect(selectorClasses(".md\\:p-4 > .w-1\\/2")).toEqual(["md:p-4", "w-1/2"]);
    expect(htmlClasses('<div class="p-4 hover:bg-x"><span class="a"></span></div>')).toEqual(["p-4", "hover:bg-x", "a"]);
  });
});

describe("globToRegExp", () => {
  test("matches Storybook's story globs", () => {
    expect(globToRegExp("src/**/*.stories.@(ts|tsx)").test("src/components/button.stories.tsx")).toBe(true);
    expect(globToRegExp("src/**/*.stories.@(ts|tsx)").test("src/button.stories.tsx")).toBe(true);
    expect(globToRegExp("src/**/*.stories.@(ts|tsx)").test("src/button.tsx")).toBe(false);
    expect(globToRegExp("src/*.{ts,tsx}").test("src/a/b.ts")).toBe(false);
  });
});
