import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS, contrast, designCss, designStylesheet, solidColours, THEMES, type AccentName } from "../src/core/design";

const SURFACES = ["app", "canvas", "card", "raised", "muted"] as const;

describe("design tokens", () => {
  it("measures contrast the WCAG way", () => {
    expect(contrast("#ffffff", "#000000")).toBe(21);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("keeps the committed design.css in step with design.ts", () => {
    expect(readFileSync("src/renderer/design.css", "utf8")).toBe(designStylesheet());
  });

  it("prefixes every variable for the canvas, so block code can't pick one up by accident", () => {
    const css = designCss("bs-");
    expect(css).toContain("--bs-accent: #");
    expect(css).toContain("var(--bs-fg)");
    expect(css.match(/--(?!bs-)[a-z][\w-]*:/g)).toBeNull();
  });

  for (const name of Object.keys(ACCENTS) as AccentName[]) {
    for (const theme of THEMES) {
      it(`${name} passes as text on every surface and as a fill in ${theme}`, () => {
        const c = solidColours(theme, name);
        for (const s of SURFACES) expect(contrast(c.accent!, c[s]!), `${name} on ${s}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c["accent-fg"]!, c.accent!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const theme of THEMES) {
    it(`gives secondary text, status colours and the focus ring enough contrast in ${theme}`, () => {
      const c = solidColours(theme);
      for (const s of SURFACES) {
        for (const text of ["fg", "fg-muted", "success", "warning", "danger", "info"]) {
          expect(contrast(c[text]!, c[s]!), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(c.ring!, c[s]!), `ring on ${s}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(c["inverse-fg"]!, c.inverse!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
