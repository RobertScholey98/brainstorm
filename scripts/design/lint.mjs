// Fails on classes and colours that break the design system in renderer TSX: npm run lint:design
//
// Rules:
//   arbitrary-value  a utility with an arbitrary value, such as text-[13px] or bg-[#abc], outside components/ui
//   raw-colour       a hex, rgb(), hsl() or oklch() colour in any string, kit included
//   off-scale        a utility the closed theme in styles.css doesn't generate, a numeric z-index, a sizing-only step
//                    on padding, margin or gap, or a ring wider than 2 px
//   surface-recipe   a raised fill or a floating shadow outside components/ui/overlay.ts, which owns the overlay surface
//   title-hint       a native title= hint on an element or kit component, outside components/ui; use the kit Hint
//   kit-override     a class on a kit component with variants that changes its look rather than its layout; add a
//                    variant instead
//
// A string counts as classes inside className, cn, cva, cx and clsx. Elsewhere it counts when every word in it is a
// Tailwind candidate and at least one generates CSS, so `align="end"` and `data-icon="inline-start"` aren't classes.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { jsxElements, kitImports, literals, splitClass } from "./classes.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const STYLES = join(root, "src", "renderer", "styles.css");

/** Keys in the spacing namespace that are for sizes only, so padding, margin and gap can't use them. */
export const SIZING_ONLY = new Set(["2.5", "3.5", "4.5", "7", "16", "inspector", "popover-sm", "popover-md", "menu", "picker"]);
const SPACING_UTILITY = /^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
const RING_WIDTH = /^(?:ring|inset-ring|ring-offset|outline)-(\d+)$/;
const RAW_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/i;

/** Only overlay.ts may draw a floating surface; it is a .ts file, so the TSX scan never reaches it. */
const FLOATING = new Set(["bg-raised", "shadow-md", "shadow-lg"]);
/** Kit components whose look is a typed variant. A caller may place them but not restyle them. */
export const VARIANT_KIT = new Set(["Badge", "Button", "Callout", "Kbd", "PopoverContent", "Segmented", "SidebarMenuButton", "SidebarTrigger", "Toast"]);
const LAYOUT = /^(?:m[trblxyse]?-|w-|min-w-|max-w-|flex-1$|grow|shrink|basis-|self-|justify-self-|order-|col-|row-)/;

export async function loadDesign(styles = STYLES) {
  return __unstable__loadDesignSystem(readFileSync(styles, "utf8"), { base: dirname(styles) });
}

function offScale(utility, compiled) {
  if (compiled === null) return "generates nothing under the closed theme in styles.css";
  if (/^z-\d+$/.test(utility)) return "numeric z-index; use a named layer (raised, sticky, popover, tooltip, toast)";
  const spacing = SPACING_UTILITY.exec(utility);
  if (spacing !== null && SIZING_ONLY.has(spacing[1])) return `${spacing[1]} is a sizing step; padding, margin and gap use the spacing scale`;
  const ring = RING_WIDTH.exec(utility);
  if (ring !== null && Number(ring[1]) > 2) return "rings and outlines are 0, 1 or 2 px";
  return null;
}

/** Every rule break in one file's source. `kit` is true for the upstream shadcn files in components/ui. */
export function lintSource(design, source, { kit = false } = {}) {
  const problems = [];
  const lits = literals(source);
  for (const lit of lits) {
    if (RAW_COLOUR.test(lit.text)) problems.push({ rule: "raw-colour", line: lit.line, text: lit.text.trim(), message: "use a colour token" });
    const tokens = lit.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const parsed = tokens.map((t) => design.parseCandidate(t).length > 0);
    const compiled = design.candidatesToCss(tokens);
    const classes = lit.cls || (parsed.every(Boolean) && compiled.some((c) => c !== null));
    if (!classes) continue;
    tokens.forEach((token, i) => {
      if (!parsed[i]) return;
      const { utility } = splitClass(token);
      if (compiled[i] === null && !/[-[(]/.test(utility)) return;
      if (!kit && /[[(]/.test(utility)) {
        problems.push({ rule: "arbitrary-value", line: lit.line, text: token, message: "use a step from the closed scales" });
        return;
      }
      const why = offScale(utility, compiled[i]);
      if (why !== null) problems.push({ rule: "off-scale", line: lit.line, text: token, message: why });
      if (FLOATING.has(utility)) problems.push({ rule: "surface-recipe", line: lit.line, text: token, message: "floating surfaces come from overlaySurface in components/ui/overlay.ts" });
    });
  }
  if (!kit) problems.push(...elementRules(source, lits));
  return problems.sort((a, b) => a.line - b.line);
}

function elementRules(source, lits) {
  const problems = [];
  const fromKit = kitImports(source);
  for (const el of jsxElements(source)) {
    const intrinsic = /^[a-z]/.test(el.tag);
    for (const attr of el.attrs) {
      if (attr.name === "title" && ((intrinsic && el.tag !== "iframe") || fromKit.has(el.tag))) {
        problems.push({ rule: "title-hint", line: attr.line, text: `<${el.tag} title>`, message: "native title hints ignore the theme; wrap the control in the kit Hint" });
      }
      if (attr.name !== "className" || !VARIANT_KIT.has(el.tag) || !fromKit.has(el.tag)) continue;
      const tokens = lits.filter((l) => l.start >= attr.start && l.end <= attr.end).flatMap((l) => l.text.split(/\s+/).filter(Boolean));
      for (const token of tokens) {
        const { variants, utility } = splitClass(token);
        if (variants === "" && LAYOUT.test(utility)) continue;
        problems.push({ rule: "kit-override", line: attr.line, text: `<${el.tag}> ${token}`, message: "the kit sets this look; place it with layout classes and pick a variant for its look" });
      }
    }
  }
  return problems;
}

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}

const KIT = /[\\/]components[\\/]ui[\\/]/;

export async function lintRenderer() {
  const design = await loadDesign();
  return tsxFiles(join(root, "src", "renderer")).flatMap((file) =>
    lintSource(design, readFileSync(file, "utf8"), { kit: KIT.test(file) }).map((p) => ({ file: relative(root, file), ...p })),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = await lintRenderer();
  for (const p of problems) console.log(`${p.file}:${p.line} ${p.rule}: ${p.text} (${p.message})`);
  if (problems.length > 0) {
    console.log(`${problems.length} design rule break${problems.length === 1 ? "" : "s"}`);
    process.exit(1);
  }
  console.log("design lint: clean");
}
