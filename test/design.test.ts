import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, deltaE2000, designCss, designStylesheet, lab, solidColours, THEMES } from "../src/core/design";

const SURFACES = ["app", "canvas", "card", "raised", "muted"] as const;
/** The accent and each status colour carry one meaning each, so no two may read as the same hue. */
const HUES = ["accent", "success", "warning", "danger", "info"] as const;
/** CIEDE2000 distance under which two colours read as one family at a glance. 2.3 is a just-noticeable difference. */
const MIN_HUE_DISTANCE = 20;

describe("design tokens", () => {
  it("measures contrast the WCAG way", () => {
    expect(contrast("#ffffff", "#000000")).toBe(21);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("measures colour distance as CIEDE2000, matching Sharma's reference pairs", () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(deltaE2000([2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514])).toBeCloseTo(0.9082, 4);
    expect(lab("#ffffff").map((v) => Math.round(v * 100) / 100 + 0)).toEqual([100, 0, 0]);
    expect(lab("#ff0000").map((v) => Math.round(v * 100) / 100)).toEqual([53.24, 80.09, 67.2]);
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

  for (const theme of THEMES) {
    it(`gives text, status colours, the accent and the focus ring enough contrast in ${theme}`, () => {
      const c = solidColours(theme);
      for (const s of SURFACES) {
        for (const text of ["fg", "fg-muted", ...HUES]) {
          expect(contrast(c[text]!, c[s]!), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(c.ring!, c[s]!), `ring on ${s}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(c["inverse-fg"]!, c.inverse!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c["accent-fg"]!, c.accent!)).toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps the accent and every status colour at least ${MIN_HUE_DISTANCE} CIEDE2000 apart in ${theme}`, () => {
      const c = solidColours(theme);
      const close = HUES.flatMap((x, i) =>
        HUES.slice(i + 1)
          .map((y) => ({ pair: `${x}/${y}`, distance: Math.round(deltaE2000(lab(c[x]!), lab(c[y]!)) * 10) / 10 }))
          .filter((p) => p.distance < MIN_HUE_DISTANCE),
      );
      expect(close).toEqual([]);
    });
  }
});
