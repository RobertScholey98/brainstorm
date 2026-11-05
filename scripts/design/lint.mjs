// Fails on classes and colours that break the design system in renderer TSX: npm run lint:design
//
// Rules:
//   arbitrary-value  a utility with an arbitrary value, such as text-[13px] or bg-[#abc], outside components/ui
//   raw-colour       a hex, rgb(), hsl() or oklch() colour in any string, kit included
//   off-scale        a utility the closed theme in styles.css doesn't generate, a numeric z-index, a sizing-only step
//                    on padding, margin or gap, or a ring wider than 2 px
//
// A string counts as classes inside className, cn, cva, cx and clsx. Elsewhere it counts when every word in it is a
// Tailwind candidate and at least one generates CSS, so `align="end"` and `data-icon="inline-start"` aren't classes.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { literals, splitClass } from "./classes.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const STYLES = join(root, "src", "renderer", "styles.css");

/** Keys in the spacing namespace that are for sizes only, so padding, margin and gap can't use them. */
export const SIZING_ONLY = new Set(["2.5", "3.5", "4.5", "7", "16", "inspector", "popover-sm", "popover-md", "menu", "picker"]);
const SPACING_UTILITY = /^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(.+)$/;
const RING_WIDTH = /^(?:ring|inset-ring|ring-offset|outline)-(\d+)$/;
const RAW_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?<![a-z])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[\d.]/i;

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
  for (const lit of literals(source)) {
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
    });
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
