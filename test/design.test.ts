import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, deltaE2000, designCss, designStylesheet, lab, mixOklab, SCROLL_TRACK_INSET, solidColours, THEMES } from "../src/core/design";

const SURFACES = ["app", "canvas", "card", "raised", "muted"] as const;
/** The accent and each status colour carry one meaning each, so no two may read as the same hue. */
const HUES = ["accent", "success", "warning", "danger", "info"] as const;
/** CIEDE2000 distance under which two colours read as one family at a glance. 2.3 is a just-noticeable difference. */
const MIN_HUE_DISTANCE = 20;
const STATUSES = ["success", "warning", "danger", "info"] as const;
/** Two subtle fills closer than this read as one tint at a glance. */
const MIN_SUBTLE_DISTANCE = 5;
/**
 * Two status fills side by side need more: light warning and danger sat at 5.3 and read as peach on pink (R6-45). Dark
 * fills sit low and dull over the card, so dark needs more again: at 6.0 its send-failed and thread-lost strips read as
 * one brown (R7-42, R8-29).
 */
const MIN_STATUS_FILL_DISTANCE = { light: 6, dark: 7 } as const;
/** The smallest step a hover fill makes off the surface under it, so the pointer's row reads at a glance. */
const MIN_HOVER_STEP = 3.5;
/** The smallest surface step that reads without leaning on a border. */
const MIN_STEP = 2.5;

const srgbOver = (fg: string, alpha: number, base: string) => {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(fg, i) * alpha + ch(base, i) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
};

/**
 * Every surface a control can sit on, painted as the browser paints the generated CSS: the solid surfaces, each
 * `-subtle` fill, and the hover and selected tints over the window and the card. Mixes are read from `designCss`.
 */
function paintedSurfaces(theme: (typeof THEMES)[number]): Record<string, string> {
  const c = solidColours(theme);
  const out: Record<string, string> = Object.fromEntries(SURFACES.map((s) => [s, c[s]!]));
  for (const [, name = "", a = "", p = "", b = ""] of designCss().matchAll(/--([\w-]+): color-mix\(in oklab, var\(--([\w-]+)\) (\d+)%, (transparent|var\(--([\w-]+)\))\)/g)) {
    const pct = Number(p) / 100;
    if (name.startsWith("scrollbar") || name === "accent-hover" || name === "separator" || name.endsWith("-ink")) continue;
    if (b === "transparent") for (const base of ["app", "card"]) out[`${name} on ${base}`] = srgbOver(c[a]!, pct, c[base]!);
    else out[name] = mixOklab(c[a]!, pct, c[b.slice(6, -1)]!);
  }
  return out;
}

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

  it("stops every scrollbar track short of the main card's rounded corners", () => {
    const radius = /--radius-xl:\s*(\d+)px/.exec(readFileSync("src/renderer/styles.css", "utf8"))?.[1];
    expect(SCROLL_TRACK_INSET).toBe(Number(radius));
    expect(designCss()).toContain(`::-webkit-scrollbar-track:vertical { margin-block: ${radius}px; }`);
    expect(designCss()).toContain(`::-webkit-scrollbar-track:horizontal { margin-inline: ${radius}px; }`);
  });

  it("lifts an overlay in light with a soft shadow you can see over a white panel, not only its 1 px edge", () => {
    const md = /--elevation-md:\s*([^;]+);/.exec(designCss())?.[1] ?? "";
    const layers = [...md.matchAll(/0 (\d+)px (\d+)px rgb\(0 0 0 \/ ([\d.]+)\)/g)].map(([, y, blur, alpha]) => ({ y: Number(y), blur: Number(blur), alpha: Number(alpha) }));
    expect(layers.some((l) => l.blur >= 20 && l.alpha >= 0.12 && l.y >= 6)).toBe(true);
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

    it(`gives the focus ring 3:1 on every surface a focused control sits on in ${theme}, derived fills included`, () => {
      const c = solidColours(theme);
      const low = Object.entries(paintedSurfaces(theme))
        .map(([surface, hex]) => ({ surface, ratio: Math.round(contrast(c.ring!, hex) * 100) / 100 }))
        .filter((s) => s.ratio < 3);
      expect(low).toEqual([]);
    });

    it(`keeps each status colour readable on its subtle fill, and the subtle fills apart, in ${theme}`, () => {
      const c = solidColours(theme);
      const painted = paintedSurfaces(theme);
      const subtle = STATUSES.map((s) => painted[`${s}-subtle`]!);
      expect(STATUSES.filter((s, i) => contrast(c[s]!, subtle[i]!) < 4.5)).toEqual([]);
      const close = STATUSES.flatMap((x, i) =>
        STATUSES.slice(i + 1)
          .map((y, j) => ({ pair: `${x}/${y}`, distance: deltaE2000(lab(subtle[i]!), lab(subtle[i + 1 + j]!)) }))
          .filter((p) => p.distance < MIN_STATUS_FILL_DISTANCE[theme]),
      );
      expect(close).toEqual([]);
    });

    it(`makes the card the brightest layer and lets the window recede behind the canvas in ${theme}`, () => {
      const c = solidColours(theme);
      const L = (s: string) => lab(c[s]!)[0];
      expect(L("card")).toBeGreaterThan(L("canvas"));
      expect(L("canvas")).toBeGreaterThan(L("app"));
      expect(deltaE2000(lab(c.card!), lab(c.canvas!)), "a home card lifts off the canvas").toBeGreaterThanOrEqual(MIN_STEP);
      expect(deltaE2000(lab(c.canvas!), lab(c.app!)), "the canvas steps off the window").toBeGreaterThanOrEqual(MIN_STEP);
    });

    it.runIf(theme === "dark")("steps the dark surfaces at least as clearly as T3 Code does, sampled from its window", () => {
      const c = solidColours(theme);
      const step = (a: string, b: string) => Math.round(deltaE2000(lab(c[a]!), lab(c[b]!)) * 100) / 100;
      // T3 Code's dark window, round 8: its main view off its sidebar is 4.69, and its inset panel off the main view 4.45 (ADR 001).
      expect({ sidebarToCard: step("app", "card") >= 4.69, cardToCanvas: step("card", "canvas") >= 4.45 }).toEqual({ sidebarToCard: true, cardToCanvas: true });
    });

    it.runIf(theme === "dark")("lifts an overlay off the card as clearly as the card lifts off the canvas, where a shadow barely shows", () => {
      const c = solidColours(theme);
      const step = (a: string, b: string) => Math.round(deltaE2000(lab(c[a]!), lab(c[b]!)) * 100) / 100;
      expect({ cardToRaised: step("card", "raised"), cardToCanvas: step("card", "canvas") }).toEqual({ cardToRaised: 4.85, cardToCanvas: 4.74 });
    });

    it(`casts the strip's edge shade darker than the card it falls on in ${theme}, never lighter`, () => {
      const c = solidColours(theme);
      const alpha = Number(/^rgb\(0 0 0 \/ ([\d.]+)\)$/.exec(c.shade!)?.[1]);
      const over = srgbOver("#000000", alpha, c.card!);
      expect(lab(c.card!)[0] - lab(over)[0]).toBeGreaterThanOrEqual(5);
    });

    it(`draws the one chip recipe so its edge reads on every surface in ${theme}`, () => {
      // components/ui/chip.ts: a card fill inside a border-strong edge.
      const c = solidColours(theme);
      const faint = SURFACES.filter((s) => deltaE2000(lab(c["border-strong"]!), lab(c[s]!)) < MIN_SUBTLE_DISTANCE);
      expect(faint).toEqual([]);
    });

    it(`draws a vertical separator at 1.5:1 or more on the window, the canvas and the card in ${theme}`, () => {
      const c = solidColours(theme);
      const [, a = "", p = ""] = /--separator: color-mix\(in oklab, var\(--([\w-]+)\) (\d+)%, transparent\)/.exec(designCss()) ?? [];
      const faint = ["app", "canvas", "card"].filter((s) => contrast(srgbOver(c[a]!, Number(p) / 100, c[s]!), c[s]!) < 1.5);
      expect(faint).toEqual([]);
    });

    it(`edges each status strip in its own tone at 1.5:1 or more on its fill, so a band reads by more than its icon in ${theme}`, () => {
      // components/ui/callout.tsx: a full-width strip's fill converges with its neighbour's at that size, so its edge carries the tone.
      const c = solidColours(theme);
      const painted = paintedSurfaces(theme);
      const source = readFileSync("src/renderer/components/ui/callout.tsx", "utf8");
      const faint = STATUSES.filter((s) => source.includes(`tone: "${s}"`)).filter((s) => {
        const alpha = new RegExp(`layout: "strip", tone: "${s}", className: "border-${s}/(\\d+)"`).exec(source)?.[1];
        return alpha === undefined || contrast(srgbOver(c[s]!, Number(alpha) / 100, painted[`${s}-subtle`]!), painted[`${s}-subtle`]!) < 1.5;
      });
      expect(faint).toEqual([]);
    });

    it(`reads a destructive label at 4.5:1 or more on the selection tint, in the danger ink, in ${theme}`, () => {
      // components/ui/button.tsx: the destructive variant takes danger-ink inside a data-tint surface.
      const c = solidColours(theme);
      const painted = paintedSurfaces(theme);
      const [, p = ""] = /--danger-ink: color-mix(in oklab, var(--danger) (d+)%, var(--fg))/.exec(designCss()) ?? [];
      expect(contrast(mixOklab(c.danger!, Number(p) / 100, c.fg!), painted["selected on card"]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(solidColours(theme)["danger"]!, painted["selected on card"]!)).toBeLessThan(4.5);
    });

    it(`lifts a hovered row off the window, the canvas and the card in ${theme}`, () => {
      const c = solidColours(theme);
      const painted = paintedSurfaces(theme);
      const faint = ["app", "card"].filter((base) => deltaE2000(lab(painted[`hover on ${base}`]!), lab(c[base]!)) < MIN_HOVER_STEP);
      expect(faint).toEqual([]);
    });

    it(`keeps a selected row apart from a hovered one in ${theme}`, () => {
      const painted = paintedSurfaces(theme);
      for (const base of ["app", "card"]) {
        expect(deltaE2000(lab(painted[`selected on ${base}`]!), lab(painted[`hover on ${base}`]!)), base).toBeGreaterThanOrEqual(MIN_SUBTLE_DISTANCE);
      }
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

describe("the window's rules", () => {
  it("draws the sidebar's section rules in the separator, the tone its foot rule takes, so one pane's rules read alike", () => {
    const sidebar = readFileSync("src/renderer/components/ui/sidebar.tsx", "utf8");
    const pane = readFileSync("src/renderer/components/ui/scroll-pane.tsx", "utf8");
    const separator = /function SidebarSeparator[\s\S]*?className=\{cn\("([^"]*)"/.exec(sidebar)?.[1]?.split(" ").filter((c) => c.startsWith("bg-"));
    expect([separator, /window: \{ foot: "data-more:border-(\w+)"/.exec(pane)?.[1]]).toEqual([["bg-separator"], "separator"]);
  });
});
