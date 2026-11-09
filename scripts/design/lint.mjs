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
//   inverse-fill     an inverse fill, kit included; inverse is the tooltip surface overlay.ts draws, and a control fills
//                    with the accent, the one primary, or not at all
//   chip-recipe      a code or key element that paints its own fill, kit included; chips take the recipe in
//                    components/ui/chip.ts through Code, Kbd or Badge, so one chip reads on every surface
//   hint-side        a Hint that doesn't name its side, a header hint that opens up or down over the card under the
//                    header, or a sidebar hint that opens up or down over the rows beside it, outside components/ui
//   page-title       the title step of the type scale outside components/ui; a page heading comes from PageHeader, so
//                    every page title has one size
//   inline-size      an inline style that sets a size to a number or a named constant, outside components/ui; a fixed
//                    size is a step on the closed scales, and only a measured size goes inline
//   dismiss-ghost    a Cancel or Done Button that isn't ghost, outside components/ui, so dismissing has one look
//   overlay-kit      an overlaySurface() call outside components/ui; an overlay is the kit's PopoverContent, or
//                    OverlayPanel for one its caller places, so it keeps the popover's column and nothing leaves its box
//   blocked-hint     a focusable wrapper written round a disabled control, outside components/ui; the kit's BlockedHint
//                    is that wrapper, and mounts a fresh tooltip so the hint opens on hover as well as on focus
//   truncate-text    text cut by the bare truncate class, outside components/ui; the kit's Truncate cuts it after a
//                    letter, never after a space or a comma
//   count-badge      a count in a Badge, outside components/ui; a count is the kit's Count, a muted numeral after its
//                    label, and a Badge is a label such as the iteration
//   prose-wrap       balanced wrapping, kit included; it evens a short sentence into two short lines and strands a
//                    clause's first word at a line end, so copy wraps pretty, as the base layer sets on p
//   frame-sandbox    an iframe anywhere in the renderer that isn't the canvas's: its src must be /canvas or
//                    /canvas/preview and its sandbox exactly "allow-scripts", so agent code always runs in an opaque
//                    origin under the canvas CSP, a home preview included
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
export const SIZING_ONLY = new Set(["2.5", "3.5", "4.5", "7", "16", "inspector", "popover-sm", "popover-md", "menu", "picker", "frame", "preview"]);
const SPACING_UTILITY = /^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
const RING_WIDTH = /^(?:ring|inset-ring|ring-offset|outline)-(\d+)$/;
/** A ring or outline utility that sets a colour rather than a width or a style. */
const RING_COLOUR = /^(?:ring|inset-ring|outline)-(?!\d+$|inset$|hidden$|none$|offset-|dashed$|dotted$|double$|solid$)/;
const RAW_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/i;

/** Only overlay.ts may draw a floating surface; it is a .ts file, so the TSX scan never reaches it. */
const FLOATING = new Set(["bg-raised", "shadow-md", "shadow-lg"]);
/** Kit components whose look is a typed variant. A caller may place them but not restyle them. */
export const VARIANT_KIT = new Set(["Badge", "Button", "Callout", "Kbd", "PopoverContent", "Segmented", "SidebarMenuButton", "SidebarTrigger", "Toast"]);
const INVERSE_FILL = /^bg-inverse(?:\/\d+)?$/;
const PAGE_TITLE = /^text-title(?:\/|$)/;
/** Files whose hints sit on the window header, where opening down would cover the canvas bar or the Inspector header. */
const HEADER_FILES = /(?:^|[\\/])(?:TopBar|Regenerate|Export)\.tsx$/;
/** Above and below a sidebar row are its neighbours. */
const SIDEBAR_FILES = /(?:^|[\\/])Sidebar\.tsx$/;
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
  if (/^(?:ring|inset-ring|outline)-ring\//.test(utility)) return "the focus ring token takes no opacity; a diluted ring falls under 3:1";
  if (/focus/.test(variants) && !/^(?:ring|inset-ring|outline)-ring$/.test(utility)) return "focus rings are ring-ring, the one focus colour";
  return null;
}

/** Every rule break in one file's source. `kit` is true for the upstream shadcn files in components/ui. */
export function lintSource(design, source, { kit = false, file = "" } = {}) {
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
      if (!kit && PAGE_TITLE.test(utility)) problems.push({ rule: "page-title", line: lit.line, text: token, message: "a page heading is the kit's PageHeader, the one user of the title step" });
      if (utility === "transition-all") problems.push({ rule: "layout-transition", line: lit.line, text: token, message: "transition-all eases padding and size, which the header and row fits read mid-flight; transition leaves layout alone" });
      if (utility === "text-balance") problems.push({ rule: "prose-wrap", line: lit.line, text: token, message: "copy wraps pretty, the base layer's rule; balance strands a clause's first word" });
      if (INVERSE_FILL.test(utility)) problems.push({ rule: "inverse-fill", line: lit.line, text: token, message: "inverse is the tooltip surface; fill a control with the accent or not at all" });
      if (FLOATING.has(utility)) problems.push({ rule: "surface-recipe", line: lit.line, text: token, message: "floating surfaces come from overlaySurface in components/ui/overlay.ts" });
    });
  }
  problems.push(...chipRecipe(source, lits), ...frameSandbox(source), ...fieldFill(source), ...tintMark(source, lits));
  if (!kit) problems.push(...elementRules(source, lits), ...hintSide(source, file), ...inlineSize(source), ...overlayKit(source), ...dismissGhost(source), ...rawPart(source), ...blockedHint(source), ...truncateText(source, lits), ...countBadge(source));
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

const CANVAS_PAGES = new Set(["/canvas", "/canvas/preview"]);

/** Every iframe is a canvas page under the canvas sandbox, with no other privilege. */
function frameSandbox(source) {
  return jsxElements(source)
    .filter((el) => el.tag === "iframe")
    .flatMap((el) => {
      const value = (name) => {
        const attr = el.attrs.find((a) => a.name === name);
        return attr === undefined ? undefined : source.slice(attr.start, attr.end).replace(/^\{?"|"\}?$/g, "");
      };
      const [src, sandbox] = [value("src"), value("sandbox")];
      if (CANVAS_PAGES.has(src) && sandbox === "allow-scripts") return [];
      return [{ rule: "frame-sandbox", line: el.line, text: `<iframe src=${src} sandbox=${sandbox}>`, message: 'an iframe is a canvas page, /canvas or /canvas/preview, with sandbox="allow-scripts" and nothing more' }];
    });
}

/** A code or key element whose own classes paint a fill, instead of taking the chip recipe. */
function chipRecipe(source, lits) {
  return jsxElements(source)
    .filter((el) => el.tag === "code" || el.tag === "kbd")
    .flatMap((el) => el.attrs.filter((a) => a.name === "className").map((attr) => ({ el, attr })))
    .flatMap(({ el, attr }) =>
      lits
        .filter((l) => l.start >= attr.start && l.end <= attr.end)
        .flatMap((l) => l.text.split(/\s+/))
        .filter((token) => /^bg-/.test(splitClass(token).utility))
        .map((token) => ({ rule: "chip-recipe", line: attr.line, text: `<${el.tag}> ${token}`, message: "take the chip recipe: Code, Kbd, Badge or chip from components/ui/chip.ts" })),
    );
}

const TINT = /^bg-(?:danger|warning|info|success)-subtle$|^bg-selected$/;

/** A surface filled with a status or selection tint says so with `data-tint`, so an outline button on it drops the card fill. */
function tintMark(source, lits) {
  return jsxElements(source)
    .filter((el) => !el.attrs.some((a) => a.name === "data-tint"))
    .flatMap((el) => el.attrs.filter((a) => a.name === "className").map((attr) => ({ el, attr })))
    .flatMap(({ el, attr }) =>
      lits
        .filter((l) => l.start >= attr.start && l.end <= attr.end)
        .flatMap((l) => l.text.split(/\s+/))
        .filter((token) => splitClass(token).variants === "" && TINT.test(splitClass(token).utility))
        .map((token) => ({ rule: "tint-mark", line: attr.line, text: `<${el.tag}> ${token}`, message: "a tinted surface carries data-tint, so the outline buttons on it draw their edge alone" })),
    );
}

const SIZE_KEY = /\b((?:min|max)?(?:Width|Height)|width|height|inlineSize|blockSize)\s*:\s*([^,}]+)/g;
/** A literal or a CONSTANT_CASE name, possibly a member of one, as opposed to a value measured at run time. */
const FIXED = /^(?:-?\d[\d.]*|["'`][^"'`]*["'`]|[A-Z][A-Z0-9_]*(?:\.\w+)*)$/;

/** An inline style may size an element only by a measured value; a fixed size comes from the scales. */
function inlineSize(source) {
  return jsxElements(source).flatMap((el) =>
    el.attrs
      .filter((a) => a.name === "style")
      .flatMap((attr) => [...source.slice(attr.start, attr.end).matchAll(SIZE_KEY)].filter((m) => FIXED.test(m[2].trim())).map((m) => ({ attr, m })))
      .map(({ attr, m }) => ({ rule: "inline-size", line: attr.line, text: `<${el.tag}> ${m[1]}: ${m[2].trim()}`, message: "a fixed size is a step on the closed scales; only a measured size goes inline" })),
  );
}

/** A Button that only dismisses, Cancel or Done, is ghost everywhere, so dismissing has one look beside an outline action. */
function dismissGhost(source) {
  return jsxElements(source)
    .filter((el) => el.tag === "Button" && source[el.end] === ">")
    .filter((el) => /^(?:Cancel|Done)$/.test(source.slice(el.end + 1, source.indexOf("</Button>", el.end)).trim()))
    .filter((el) => {
      const variant = el.attrs.find((a) => a.name === "variant");
      return variant === undefined || source.slice(variant.start, variant.end).replace(/^\{?"?|"?\}?$/g, "") !== "ghost";
    })
    .map((el) => ({ rule: "dismiss-ghost", line: el.line, text: "<Button> Cancel", message: "a dismiss button is ghost, as every overlay footer has it" }));
}

/**
 * A field filled with a tint of its border in dark. Every field, from a text input to a select and a checkbox, fills
 * with the card, so one Inspector column has one field fill in both themes.
 */
function fieldFill(source) {
  return source.split("\n").flatMap((text, i) =>
    /\bdark:bg-border-strong\//.test(text)
      ? [{ rule: "field-fill", line: i + 1, text: text.match(/dark:bg-border-strong\/\d+/)[0], message: "fill a field with bg-card, the one field fill in both themes" }]
      : [],
  );
}

/** A pin's part rendered as its raw id, "spin-button", where Rob reads the words partLabel gives, "Spin button". */
function rawPart(source) {
  return source.split("\n").flatMap((text, i) =>
    /(?<!=)\{[^{}]*\.part\s*(?:\?\?[^{}]*)?\}/.test(text) && !/partLabel\(/.test(text)
      ? [{ rule: "raw-part", line: i + 1, text: text.trim(), message: "show a part through partLabel, as every surface names it" }]
      : [],
  );
}

/** An overlay built by hand from the surface recipe, outside the kit components that lay it out. */
function overlayKit(source) {
  return source.split("\n").flatMap((text, i) =>
    /\boverlaySurface\(/.test(text)
      ? [{ rule: "overlay-kit", line: i + 1, text: "overlaySurface()", message: "an overlay is the kit's PopoverContent, or OverlayPanel for one placed by hand" }]
      : [],
  );
}

/** A Badge holding only a number: a length, a count, or a numeral. */
function countBadge(source) {
  return jsxElements(source)
    .filter((el) => el.tag === "Badge" && source[el.end] === ">")
    .flatMap((el) => {
      const child = source.slice(el.end + 1, source.indexOf("</Badge>", el.end)).trim();
      if (!/^(?:\{[^{}]*(?:\.length|[cC]ount)\}|\d+)$/.test(child)) return [];
      return [{ rule: "count-badge", line: el.line, text: `<Badge> ${child}`, message: "a count is the kit's Count, a muted numeral after its label" }];
    });
}

/** An element cut by the truncate class whose children are only text, which the kit's Truncate would cut on a letter. */
function truncateText(source, lits) {
  return jsxElements(source).flatMap((el) => {
    const cls = el.attrs.find((a) => a.name === "className");
    if (cls === undefined || source[el.end] !== ">") return [];
    const cut = lits.some((l) => l.start >= cls.start && l.end <= cls.end && l.text.split(/\s+/).includes("truncate"));
    const next = source.indexOf("<", el.end);
    const child = source.slice(el.end + 1, next).trim();
    if (!cut || child === "" || !source.startsWith(`</${el.tag}>`, next)) return [];
    return [{ rule: "truncate-text", line: el.line, text: `<${el.tag} truncate> ${child.replace(/\s+/g, " ")}`, message: "cut text with the kit's Truncate, which never ends on a space or a comma" }];
  });
}

/** A span made focusable to carry the hint of the disabled control it wraps. */
function blockedHint(source) {
  const elements = jsxElements(source);
  return elements.flatMap((el, i) => {
    if (el.tag !== "span" || !el.attrs.some((a) => a.name === "tabIndex")) return [];
    const child = elements[i + 1];
    if (child === undefined || child.start > source.indexOf("</span>", el.end) || !child.attrs.some((a) => a.name === "disabled" && a.start === a.end)) return [];
    return [{ rule: "blocked-hint", line: el.line, text: `<span tabIndex> round <${child.tag} disabled>`, message: "a disabled control's hint is the kit's BlockedHint" }];
  });
}

/** A Hint names its side; on the window header and in the sidebar that side is left or right. */
function hintSide(source, file) {
  return jsxElements(source)
    .filter((el) => el.tag === "Hint" || el.tag === "BlockedHint")
    .flatMap((el) => {
      const side = el.attrs.find((a) => a.name === "side");
      if (side === undefined) return [{ rule: "hint-side", line: el.line, text: "<Hint> without side", message: "name the side, so the hint opens off the controls it serves" }];
      const value = source.slice(side.start, side.end).replace(/^\{?"?|"?\}?$/g, "");
      if (HEADER_FILES.test(file) && /^(?:top|bottom)$/.test(value)) {
        return [{ rule: "hint-side", line: side.line, text: `<Hint side="${value}">`, message: "a header hint opens left or right, off the canvas bar and the Inspector header" }];
      }
      if (SIDEBAR_FILES.test(file) && /^(?:top|bottom)$/.test(value)) {
        return [{ rule: "hint-side", line: side.line, text: `<Hint side="${value}">`, message: "a sidebar hint opens left or right, off the rows beside it" }];
      }
      return [];
    });
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
    lintSource(design, readFileSync(file, "utf8"), { kit: KIT.test(file), file }).map((p) => ({ file: relative(root, file), ...p })),
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
