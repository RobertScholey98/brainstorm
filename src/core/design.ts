/**
 * Brainstorm's colour tokens, the one source for the app window and the canvas frame. The renderer reads them as
 * `src/renderer/design.css`, written by `npm run design:tokens`; the canvas inlines `designCss("bs-")`, prefixed so
 * agent block code never inherits a shell variable by accident.
 */

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];

type AccentPair = { readonly accent: string; readonly fg: string };

/** Each candidate passes 4.5:1 as text on every surface and as a fill under its `fg`, in both themes. */
export const ACCENTS = {
  iris: { light: { accent: "#5b4bd1", fg: "#ffffff" }, dark: { accent: "#a89cff", fg: "#17132e" } },
  lagoon: { light: { accent: "#0b7570", fg: "#ffffff" }, dark: { accent: "#43c4b9", fg: "#062421" } },
  plum: { light: { accent: "#a0306f", fg: "#ffffff" }, dark: { accent: "#ec8fc7", fg: "#2a0a1d" } },
} as const satisfies Record<string, Record<Theme, AccentPair>>;

export type AccentName = keyof typeof ACCENTS;

/** Rob picks the hue at the foundation checkpoint; this one value swaps it everywhere. */
export const ACCENT: AccentName = "iris";

/** Solid colours that differ by theme. Everything else is mixed from these in `designCss`. */
const SOLID = {
  light: {
    app: "#f6f5f2",
    canvas: "#efeeea",
    card: "#ffffff",
    raised: "#ffffff",
    muted: "#f1f0ec",
    fg: "#1b1b1a",
    "fg-muted": "#66655f",
    "fg-faint": "#9a9993",
    border: "#e6e5e1",
    "border-strong": "#d4d3cd",
    ring: "#85847e",
    inverse: "#1f1f1e",
    "inverse-fg": "#fafaf9",
    success: "#2a7a4b",
    warning: "#8a5300",
    danger: "#c03a2f",
    info: "#2f63c4",
    "elevation-xs": "0 1px 2px rgb(0 0 0 / 0.06)",
    "elevation-sm": "0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)",
    "elevation-md": "0 4px 16px rgb(0 0 0 / 0.10), 0 1px 3px rgb(0 0 0 / 0.06)",
    "elevation-lg": "0 8px 24px rgb(0 0 0 / 0.14), 0 2px 6px rgb(0 0 0 / 0.06)",
  },
  dark: {
    app: "#1c1c1a",
    canvas: "#21211f",
    card: "#262624",
    raised: "#30302d",
    muted: "#32322e",
    fg: "#ecebe8",
    "fg-muted": "#a8a7a1",
    "fg-faint": "#75746e",
    border: "#3a3a36",
    "border-strong": "#4a4a45",
    ring: "#8a8983",
    inverse: "#ecebe8",
    "inverse-fg": "#1f1f1d",
    success: "#5cc48a",
    warning: "#f2b860",
    danger: "#ff8a7f",
    info: "#86aeff",
    "elevation-xs": "0 1px 2px rgb(0 0 0 / 0.3)",
    "elevation-sm": "0 1px 3px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.04)",
    "elevation-md": "0 6px 20px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(255 255 255 / 0.06)",
    "elevation-lg": "0 10px 32px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.08)",
  },
} as const satisfies Record<Theme, Record<string, string>>;

/** Segoe UI Variable and Cascadia Mono ship with Windows 11; see ADR 001 for why no font is bundled. */
const FONTS = {
  "font-ui": '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  "font-code": '"Cascadia Mono", Consolas, ui-monospace, monospace',
};

/** The same mix in both themes, so a derived token can never drift from the solid it comes from. */
const DERIVED: Readonly<Record<string, (v: (name: string) => string) => string>> = {
  hover: (v) => `color-mix(in oklab, ${v("fg")} 6%, transparent)`,
  selected: (v) => `color-mix(in oklab, ${v("accent")} 14%, transparent)`,
  "accent-hover": (v) => `color-mix(in oklab, ${v("accent")} 88%, ${v("fg")})`,
  "success-subtle": (v) => `color-mix(in oklab, ${v("success")} 10%, ${v("card")})`,
  "warning-subtle": (v) => `color-mix(in oklab, ${v("warning")} 10%, ${v("card")})`,
  "danger-subtle": (v) => `color-mix(in oklab, ${v("danger")} 10%, ${v("card")})`,
  "info-subtle": (v) => `color-mix(in oklab, ${v("info")} 10%, ${v("card")})`,
  "scrollbar-thumb": (v) => `color-mix(in oklab, ${v("fg")} 22%, transparent)`,
  "scrollbar-thumb-hover": (v) => `color-mix(in oklab, ${v("fg")} 36%, transparent)`,
};

export function solidColours(theme: Theme, accent: AccentName = ACCENT): Readonly<Record<string, string>> {
  const pair = ACCENTS[accent][theme];
  return { ...SOLID[theme], accent: pair.accent, "accent-fg": pair.fg };
}

const block = (selector: string, vars: Readonly<Record<string, string>>, prefix: string, indent: string) =>
  [`${indent}${selector} {`, ...Object.entries(vars).map(([k, val]) => `${indent}  --${prefix}${k}: ${val};`), `${indent}}`].join("\n");

/** Only the accent family: what the checkpoint renders laid over a page to show another candidate. */
export function accentCss(accent: AccentName, prefix = ""): string {
  const pick = (theme: Theme) => ({ accent: ACCENTS[accent][theme].accent, "accent-fg": ACCENTS[accent][theme].fg });
  return [block(":root", pick("light"), prefix, ""), "@media (prefers-color-scheme: dark) {", block(":root", pick("dark"), prefix, "  "), "}"].join("\n");
}

export function designCss(prefix = "", accent: AccentName = ACCENT): string {
  const v = (name: string) => `var(--${prefix}${name})`;
  const derived = Object.fromEntries(Object.entries(DERIVED).map(([k, mix]) => [k, mix(v)]));
  return [
    block(":root", { ...solidColours("light", accent), ...derived, ...FONTS }, prefix, ""),
    ":root { color-scheme: light; }",
    "@media (prefers-color-scheme: dark) {",
    block(":root", solidColours("dark", accent), prefix, "  "),
    "  :root { color-scheme: dark; }",
    "}",
    // Chromium ignores these pseudo-elements once scrollbar-width or scrollbar-color is set, so neither is.
    "::-webkit-scrollbar { width: 10px; height: 10px; }",
    "::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }",
    "::-webkit-scrollbar-button { display: none; }",
    `::-webkit-scrollbar-thumb { background-color: ${v("scrollbar-thumb")}; background-clip: padding-box; border: 2px solid transparent; border-radius: 9999px; }`,
    `::-webkit-scrollbar-thumb:hover { background-color: ${v("scrollbar-thumb-hover")}; }`,
    "",
  ].join("\n");
}


const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((s) => channel(((n >> s) & 255) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2 contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The renderer's src/renderer/design.css, exactly as `npm run design:tokens` writes it. */
export const designStylesheet = () => `/* Generated from src/core/design.ts by npm run design:tokens. Edit that file, not this one. */\n${designCss()}`;
