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
//   focus-ring       a focus ring in any colour but the full-strength ring token, or ring-ring with an opacity, kit
//                    included, so every focus ring keeps the 3:1 the token tests measure
//   callout-actions  a button written inside a Callout's message instead of its actions, outside components/ui
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
/** A ring or outline utility that sets a colour rather than a width or a style. */
const RING_COLOUR = /^(?:ring|inset-ring|outline)-(?!\d+$|inset$|hidden$|none$|offset-|dashed$|dotted$|double$|solid$)/;
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

function focusRing(variants, utility) {
  if (!RING_COLOUR.test(utility)) return null;
  if (/^(?:ring|outline)-ring\//.test(utility)) return "the focus ring token takes no opacity; a diluted ring falls under 3:1";
  if (/focus/.test(variants) && !/^(?:ring|outline)-ring$/.test(utility)) return "focus rings are ring-ring, the one focus colour";
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
      const why2 = focusRing(splitClass(token).variants, utility);
      if (why2 !== null) problems.push({ rule: "focus-ring", line: lit.line, text: token, message: why2 });
      if (FLOATING.has(utility)) problems.push({ rule: "surface-recipe", line: lit.line, text: token, message: "floating surfaces come from overlaySurface in components/ui/overlay.ts" });
    });
  }
  if (!kit) problems.push(...elementRules(source, lits));
  return problems.sort((a, b) => a.line - b.line);
}

function elementRules(source, lits) {
  const problems = [];
  const fromKit = kitImports(source);
  const elements = jsxElements(source);
  problems.push(...calloutActions(source, elements, fromKit));
  for (const el of elements) {
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

/** A button between a Callout's tags must sit in the `actions` of the Callout or a CalloutItem, never in the message. */
function calloutActions(source, elements, fromKit) {
  if (!fromKit.has("Callout")) return [];
  const bodies = elements
    .filter((el) => el.tag === "Callout" && source[el.end] === ">")
    .map((el) => ({ start: el.end, end: source.indexOf("</Callout>", el.end) }));
  const actions = elements
    .filter((el) => el.tag === "Callout" || el.tag === "CalloutItem")
    .flatMap((el) => el.attrs.filter((a) => a.name === "actions"));
  const inside = (n, ranges) => ranges.some((r) => n > r.start && n < r.end);
  return elements
    .filter((el) => (el.tag === "Button" || el.tag === "button") && inside(el.start, bodies) && !inside(el.start, actions))
    .map((el) => ({ rule: "callout-actions", line: el.line, text: `<${el.tag}> in a Callout message`, message: "put it in the Callout's or a CalloutItem's actions, which sit under the message" }));
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
