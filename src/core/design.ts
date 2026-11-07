/**
 * Brainstorm's colour tokens, the one source for the app window and the canvas frame. The renderer reads them as
 * `src/renderer/design.css`, written by `npm run design:tokens`; the canvas inlines `designCss("bs-")`, prefixed so
 * agent block code never inherits a shell variable by accident.
 */

export type Theme = "light" | "dark";
export const THEMES: readonly Theme[] = ["light", "dark"];

/** Lagoon, Rob's pick at the foundation checkpoint (2026-11-05). */
const ACCENT: Readonly<Record<Theme, { readonly accent: string; readonly fg: string }>> = {
  light: { accent: "#0b7570", fg: "#ffffff" },
  dark: { accent: "#43c4b9", fg: "#062421" },
};

/** Solid colours that differ by theme. Everything else is mixed from these in `designCss`. */
const SOLID = {
  light: {
    app: "#eae9e4",
    canvas: "#f6f5f2",
    card: "#ffffff",
    raised: "#ffffff",
    muted: "#f1f0ec",
    fg: "#1b1b1a",
    "fg-muted": "#66655f",
    border: "#e6e5e1",
    "border-strong": "#d4d3cd",
    ring: "#73726c",
    inverse: "#1f1f1e",
    "inverse-fg": "#fafaf9",
    success: "#497011",
    warning: "#885600",
    danger: "#bb372c",
    info: "#2f63c4",
    "elevation-xs": "0 1px 2px rgb(0 0 0 / 0.06)",
    "elevation-sm": "0 1px 3px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)",
    // An overlay over the white Inspector or a card needs a lift you can see, not only its 1 px edge (T45).
    "elevation-md": "0 8px 24px rgb(0 0 0 / 0.14), 0 2px 6px rgb(0 0 0 / 0.08)",
    "elevation-lg": "0 8px 24px rgb(0 0 0 / 0.14), 0 2px 6px rgb(0 0 0 / 0.06)",
    // The shadow an edge casts over what scrolls under it, such as the history strip's ends: dark in both themes.
    shade: "rgb(0 0 0 / 0.08)",
  },
  dark: {
    app: "#161614",
    canvas: "#1f1f1d",
    card: "#2e2e2c",
    raised: "#3d3d3a",
    muted: "#3b3b37",
    fg: "#ecebe8",
    "fg-muted": "#a8a7a1",
    border: "#3d3d39",
    "border-strong": "#585852",
    ring: "#94938d",
    inverse: "#ecebe8",
    "inverse-fg": "#1f1f1d",
    success: "#9ccc5a",
    warning: "#f2b860",
    danger: "#ff8395",
    info: "#86aeff",
    "elevation-xs": "0 1px 2px rgb(0 0 0 / 0.3)",
    "elevation-sm": "0 1px 3px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(255 255 255 / 0.04)",
    "elevation-md": "0 6px 20px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(255 255 255 / 0.06)",
    "elevation-lg": "0 10px 32px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.08)",
    shade: "rgb(0 0 0 / 0.32)",
  },
} as const satisfies Record<Theme, Record<string, string>>;

/**
 * A scrollbar's width. Every scroller keeps this gutter on both sides, so its content sits as far off each edge with or
 * without a scrollbar, and pads each side by its inset less the gutter.
 */
export const SCROLLBAR = 10;

/** A scrollbar's track stops this far short of each end, the main card's corner radius, so its thumb never runs into a rounded corner. */
export const SCROLL_TRACK_INSET = 12;

/** The same in both themes. Segoe UI Variable and Cascadia Mono ship with Windows 11; see ADR 001 for why no font is bundled. */
const UNTHEMED = {
  "font-ui": '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  "font-code": '"Cascadia Mono", Consolas, ui-monospace, monospace',
  scrollbar: `${SCROLLBAR}px`,
};

/** The same mix in both themes, so a derived token can never drift from the solid it comes from. */
const DERIVED: Readonly<Record<string, (v: (name: string) => string) => string>> = {
  hover: (v) => `color-mix(in oklab, ${v("fg")} 8%, transparent)`,
  selected: (v) => `color-mix(in oklab, ${v("accent")} 18%, transparent)`,
  "accent-hover": (v) => `color-mix(in oklab, ${v("accent")} 88%, ${v("fg")})`,
  "success-subtle": (v) => `color-mix(in oklab, ${v("success")} 12%, ${v("card")})`,
  "warning-subtle": (v) => `color-mix(in oklab, ${v("warning")} 12%, ${v("card")})`,
  "danger-subtle": (v) => `color-mix(in oklab, ${v("danger")} 12%, ${v("card")})`,
  "info-subtle": (v) => `color-mix(in oklab, ${v("info")} 12%, ${v("card")})`,
  // A vertical rule between control groups, in a tone that still reads at 1.5:1 or more on the window.
  separator: (v) => `color-mix(in oklab, ${v("fg-muted")} 40%, transparent)`,
  "scrollbar-thumb": (v) => `color-mix(in oklab, ${v("fg")} 22%, transparent)`,
  "scrollbar-thumb-hover": (v) => `color-mix(in oklab, ${v("fg")} 36%, transparent)`,
};

export function solidColours(theme: Theme): Readonly<Record<string, string>> {
  return { ...SOLID[theme], accent: ACCENT[theme].accent, "accent-fg": ACCENT[theme].fg };
}

const block = (selector: string, vars: Readonly<Record<string, string>>, prefix: string, indent: string) =>
  [`${indent}${selector} {`, ...Object.entries(vars).map(([k, val]) => `${indent}  --${prefix}${k}: ${val};`), `${indent}}`].join("\n");

export function designCss(prefix = ""): string {
  const v = (name: string) => `var(--${prefix}${name})`;
  const derived = Object.fromEntries(Object.entries(DERIVED).map(([k, mix]) => [k, mix(v)]));
  return [
    block(":root", { ...solidColours("light"), ...derived, ...UNTHEMED }, prefix, ""),
    ":root { color-scheme: light; }",
    "@media (prefers-color-scheme: dark) {",
    block(":root", solidColours("dark"), prefix, "  "),
    "  :root { color-scheme: dark; }",
    "}",
    // Chromium ignores these pseudo-elements once scrollbar-width or scrollbar-color is set, so neither is.
    `::-webkit-scrollbar { width: ${SCROLLBAR}px; height: ${SCROLLBAR}px; }`,
    "::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }",
    `::-webkit-scrollbar-track:vertical { margin-block: ${SCROLL_TRACK_INSET}px; }`,
    `::-webkit-scrollbar-track:horizontal { margin-inline: ${SCROLL_TRACK_INSET}px; }`,
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

const unchannel = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((s) => channel(((n >> s) & 255) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function fromOklab([L, A, B]: readonly [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, unchannel(c))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** `color-mix(in oklab, a p%, b)` as the browser paints it over an opaque `b`, for measuring derived tokens. */
export function mixOklab(a: string, p: number, b: string): string {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab([0, 1, 2].map((i) => x[i]! * p + y[i]! * (1 - p)) as [number, number, number]);
}

type Lab = readonly [l: number, a: number, b: number];

/** CIE L*a*b* (D65) of a #rrggbb colour. */
export function lab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [16, 8, 0].map((s) => channel(((n >> s) & 255) / 255)) as [number, number, number];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIEDE2000 colour difference, as Sharma, Wu and Dalal (2005) give it. */
export function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const g7 = (c: number) => Math.sqrt(c ** 7 / (c ** 7 + 25 ** 7));
  const g = 0.5 * (1 - g7((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2));
  const [c1, c2] = [Math.hypot((1 + g) * a1, b1), Math.hypot((1 + g) * a2, b2)];
  const hue = (b: number, a: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const [h1, h2] = [hue(b1, (1 + g) * a1), hue(b2, (1 + g) * a2)];
  const chromatic = c1 * c2 !== 0;
  const dh = !chromatic ? 0 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 < -180 ? h2 - h1 + 360 : h2 - h1;
  const l = (l1 + l2) / 2;
  const c = (c1 + c2) / 2;
  const h = !chromatic ? h1 + h2 : Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
  const t = 1 - 0.17 * Math.cos((h - 30) * rad) + 0.24 * Math.cos(2 * h * rad) + 0.32 * Math.cos((3 * h + 6) * rad) - 0.2 * Math.cos((4 * h - 63) * rad);
  const dl = (l2 - l1) / (1 + (0.015 * (l - 50) ** 2) / Math.sqrt(20 + (l - 50) ** 2));
  const dc = (c2 - c1) / (1 + 0.045 * c);
  const dH = (2 * Math.sqrt(c1 * c2) * Math.sin((dh * rad) / 2)) / (1 + 0.015 * c * t);
  const rt = -Math.sin(60 * Math.exp(-(((h - 275) / 25) ** 2)) * rad) * 2 * g7(c);
  return Math.sqrt(dl ** 2 + dc ** 2 + dH ** 2 + rt * dc * dH);
}

/** The renderer's src/renderer/design.css, exactly as `npm run design:tokens` writes it. */
export const designStylesheet = () => `/* Generated from src/core/design.ts by npm run design:tokens. Edit that file, not this one. */\n${designCss()}`;

/** The mark's geometry on a 16-unit grid: the canvas pin's teardrop, and the point a comment anchors to. */
export const MARK = {
  tile: "M8 1a7 7 0 0 1 7 7a7 7 0 0 1-7 7H2.25A1.25 1.25 0 0 1 1 13.75V8a7 7 0 0 1 7-7z",
  dot: { cx: 8, cy: 8, r: 2.4 },
} as const;
