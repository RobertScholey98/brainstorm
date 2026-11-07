// Moves renderer classes onto the closed scales and colour roles in src/renderer/styles.css:
//
//   node scripts/design/codemod.mjs [--shadcn] [file.tsx ...]
//
// With no files it rewrites every .tsx file under src/renderer. Pass --shadcn for code that still uses shadcn's
// colour names, such as a component fresh from `shadcn add`: shadcn's `accent` is a hover fill, which Brainstorm calls
// `hover`, because `accent` is the brand hue. Without --shadcn the codemod is idempotent.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { joinClass, literals, splitClass } from "./classes.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Whole utilities that have one on-scale replacement, which may be two classes. */
const EXACT = {
  "rounded-4xl": "rounded-full",
  "rounded-[2px]": "rounded-sm",
  "rounded-[3px]": "rounded-sm",
  "rounded-[4px]": "rounded-sm",
  "rounded-[5px]": "rounded-sm",
  "rounded-[min(var(--radius-md),10px)]": "rounded-md",
  "rounded-[min(var(--radius-md),12px)]": "rounded-md",
  "rounded-[9px_9px_9px_3px]": "rounded-full rounded-bl-sm",
  "shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]": "inset-ring inset-ring-fg/15",
  "w-[300px]": "w-inspector",
  "w-[340px]": "w-popover-md",
  "w-[380px]": "w-popover-md",
  "w-72": "w-popover-sm",
  "min-w-36": "min-w-menu",
  "min-h-40": "min-h-picker",
  "max-w-[420px]": "max-w-md",
  "max-h-[220px]": "max-h-picker",
  "h-[18px]": "h-4.5",
  "min-w-[18px]": "min-w-4.5",
  "ring-3": "ring-2",
  "ring-[3px]": "ring-2",
  "font-bold": "font-semibold",
  "z-10": "z-raised",
  "z-20": "z-sticky",
  "z-50": "z-popover",
};

/** Arbitrary font sizes onto the type scale, keeping any line-height modifier. */
const FONT_SIZE = { "10px": "2xs", "11px": "xs", "12px": "xs", "13px": "sm", "14px": "base", "16px": "lg", "0.85em": "xs", "0.8rem": "sm" };

/** shadcn and pre-climb colour names onto the roles in src/core/design.ts. */
const COLOUR = {
  background: "card",
  foreground: "fg",
  "card-foreground": "fg",
  popover: "raised",
  "popover-foreground": "fg",
  primary: "inverse",
  "primary-foreground": "inverse-fg",
  secondary: "muted",
  "secondary-foreground": "fg",
  "muted-foreground": "fg-muted",
  "accent-foreground": "fg",
  destructive: "danger",
  input: "border-strong",
  sidebar: "app",
  "sidebar-foreground": "fg",
  "sidebar-primary": "inverse",
  "sidebar-primary-foreground": "inverse-fg",
  "sidebar-accent": "hover",
  "sidebar-accent-foreground": "fg",
  "sidebar-border": "border",
  "sidebar-ring": "ring",
  open: "accent",
  addressed: "accent",
  confirmed: "success",
  attached: "success",
  "warning-surface": "warning-subtle",
  white: "card",
  black: "fg",
};
const SHADCN_COLOUR = { accent: "hover" };

/** CSS variables that arbitrary values name, which the tokens renamed. */
const VARIABLE = { "--sidebar-border": "--border", "--sidebar-accent": "--hover", "--secondary": "--muted", "--foreground": "--fg" };

const COLOUR_UTILITY = /^(bg|text|border(?:-[xytrblse])?|ring|ring-offset|inset-ring|outline|fill|stroke|divide|placeholder|caret|decoration|from|via|to)-(.+?)(\/\d+)?$/;
const SPACING_UTILITY = /^(p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
/** Sizing-only steps that padding, margin and gap round down to, for density. */
const SPACING_STEP = { "2.5": "2", "3.5": "3", "4.5": "4", "7": "6" };
const SIZING_UTILITY = /^(h|w|size|min-w|min-h|max-w|max-h)-9$/;
/** A selected or pressed fill is selection, whatever shade shadcn gave it. */
const SELECTED_STATE = /(^|:)(data-active|aria-pressed|aria-selected|data-pressed|data-\[state=on\]|data-\[selected\]|data-selected):/;

function arbitraryVariables(utility) {
  return utility
    .replace(/--spacing\((\d+(?:\.\d+)?)\)/g, (_, n) => `${Number(n) * 4}px`)
    .replace(/--spacing\((var\([^)]*\))\)/g, (_, v) => `calc(${v}*4px)`)
    .replace(/var\((--[\w-]+)\)/g, (match, name) => (Object.hasOwn(VARIABLE, name) ? `var(${VARIABLE[name]})` : match));
}

function utilities(utility, variants, shadcn) {
  if (Object.hasOwn(EXACT, utility)) return EXACT[utility].split(" ");
  const size = /^text-\[([^\]]+)\](\/[\w.]+)?$/.exec(utility);
  if (size !== null && Object.hasOwn(FONT_SIZE, size[1])) return [`text-${FONT_SIZE[size[1]]}${size[2] ?? ""}`];
  const spacing = SPACING_UTILITY.exec(utility);
  if (spacing !== null && Object.hasOwn(SPACING_STEP, spacing[2])) return [`${spacing[1]}-${SPACING_STEP[spacing[2]]}`];
  if (SIZING_UTILITY.test(utility)) return [utility.replace(/-9$/, "-8")];
  const colour = COLOUR_UTILITY.exec(utility);
  if (colour !== null) {
    const [, kind, name, alpha = ""] = colour;
    const map = shadcn ? { ...COLOUR, ...SHADCN_COLOUR } : COLOUR;
    if (kind === "bg" && SELECTED_STATE.test(variants) && (Object.hasOwn(map, name) || name === "muted")) return [`bg-selected${alpha}`];
    if (Object.hasOwn(map, name)) return [`${kind}-${map[name]}${alpha}`];
  }
  return [arbitraryVariables(utility)];
}

export function migrateClass(token, { shadcn = false } = {}) {
  const parts = splitClass(token);
  return utilities(parts.utility, parts.variants, shadcn)
    .map((utility) => joinClass({ ...parts, utility }))
    .join(" ");
}

export function migrateSource(source, options) {
  let out = "";
  let at = 0;
  for (const lit of literals(source)) {
    out += source.slice(at, lit.start) + lit.text.replace(/\S+/g, (token) => migrateClass(token, options));
    at = lit.end;
  }
  return out + source.slice(at);
}

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const shadcn = args.includes("--shadcn");
  const named = args.filter((a) => a !== "--shadcn");
  const files = named.length > 0 ? named : tsxFiles(join(root, "src", "renderer"));
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = migrateSource(before, { shadcn });
    if (after !== before) {
      writeFileSync(file, after);
      console.log(`migrated ${relative(root, file)}`);
    }
  }
}
