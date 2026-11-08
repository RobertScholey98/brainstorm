/**
 * Layout and text primitives Brainstorm adds to a design system that has none (ADR 007). A design in a session with a
 * system can't write HTML, so without them it couldn't lay anything out. Every prop is a named step on the system's
 * scales, read from Tailwind v4's theme variables and shadcn's colour names, with fixed steps as the fallback. They pass
 * through only `data-*`, `aria-*`, `id`, `role`, `tabIndex` and event handlers, so no class or style gets in.
 */

export const PRIMITIVE_NAMES = ["Box", "Stack", "Grid", "Text", "Heading"] as const;
export type PrimitiveName = (typeof PRIMITIVE_NAMES)[number];

/** Spacing steps, as multiples of `--spacing` (Tailwind's 0.25rem by default). */
export const SPACE_STEPS = ["0", "0.5", "1", "1.5", "2", "3", "4", "5", "6", "8", "10", "12", "16"] as const;
export const TEXT_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl"] as const;
export const TONES = ["default", "muted", "primary", "destructive"] as const;
export const WEIGHTS = ["normal", "medium", "semibold", "bold"] as const;

const TEXT_FALLBACK: Record<(typeof TEXT_SIZES)[number], [string, string]> = {
  xs: ["0.75rem", "1.333"],
  sm: ["0.875rem", "1.429"],
  base: ["1rem", "1.5"],
  lg: ["1.125rem", "1.556"],
  xl: ["1.25rem", "1.4"],
  "2xl": ["1.5rem", "1.333"],
  "3xl": ["1.875rem", "1.2"],
};
const TONE_VAR: Record<(typeof TONES)[number], string> = {
  default: "inherit",
  muted: "var(--color-muted-foreground, var(--muted-foreground, currentColor))",
  primary: "var(--color-primary, var(--primary, currentColor))",
  destructive: "var(--color-destructive, var(--destructive, currentColor))",
};
const WEIGHT_VAR: Record<(typeof WEIGHTS)[number], string> = {
  normal: "var(--font-weight-normal, 400)",
  medium: "var(--font-weight-medium, 500)",
  semibold: "var(--font-weight-semibold, 600)",
  bold: "var(--font-weight-bold, 700)",
};

const stepClass = (step: string) => step.replace(".", "_");
const space = (step: string) => `calc(var(--spacing, 0.25rem) * ${step})`;

/** The primitives' stylesheet, appended to the system's CSS so the scale check measures it like the library's own. */
export function primitivesCss(): string {
  const rules: string[] = [
    ".bsk-box{box-sizing:border-box;min-width:0}",
    ".bsk-stack{display:flex;flex-direction:column;min-width:0}",
    ".bsk-row{flex-direction:row}",
    ".bsk-wrap{flex-wrap:wrap}",
    ".bsk-grow>*{flex:1 1 0;min-width:0}",
    ".bsk-grid{display:grid;min-width:0}",
    ".bsk-text{margin:0}",
    ".bsk-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".bsk-heading{margin:0;font-family:var(--font-heading, inherit);font-weight:var(--font-weight-semibold, 600);letter-spacing:var(--tracking-tight, -0.025em)}",
    ...["start", "center", "end", "stretch", "baseline"].map((a) => `.bsk-align-${a}{align-items:${a === "start" || a === "end" ? `flex-${a}` : a}}`),
    ...["start", "center", "end", "between"].map(
      (j) => `.bsk-justify-${j}{justify-content:${j === "between" ? "space-between" : j === "center" ? "center" : `flex-${j}`}}`,
    ),
    ...[1, 2, 3, 4, 5, 6].map((n) => `.bsk-cols-${n}{grid-template-columns:repeat(${n},minmax(0,1fr))}`),
  ];
  for (const step of SPACE_STEPS) {
    const c = stepClass(step);
    rules.push(
      `.bsk-gap-${c}{gap:${space(step)}}`,
      `.bsk-p-${c}{padding:${space(step)}}`,
      `.bsk-px-${c}{padding-inline:${space(step)}}`,
      `.bsk-py-${c}{padding-block:${space(step)}}`,
    );
  }
  for (const size of TEXT_SIZES) {
    const [fs, lh] = TEXT_FALLBACK[size];
    rules.push(`.bsk-size-${size}{font-size:var(--text-${size}, ${fs});line-height:var(--text-${size}--line-height, ${lh})}`);
  }
  for (const tone of TONES) rules.push(`.bsk-tone-${tone}{color:${TONE_VAR[tone]}}`);
  for (const weight of WEIGHTS) rules.push(`.bsk-weight-${weight}{font-weight:${WEIGHT_VAR[weight]}}`);
  return `@layer components {\n${rules.join("\n")}\n}\n`;
}

/** Bundled into the kit as the module `brainstorm:primitives`. */
export const PRIMITIVES_SOURCE = `
import { createElement } from "react";

const SPACE = ${JSON.stringify(SPACE_STEPS)};
const SIZES = ${JSON.stringify(TEXT_SIZES)};
const TONES = ${JSON.stringify(TONES)};
const WEIGHTS = ${JSON.stringify(WEIGHTS)};

function passThrough(props) {
  const out = {};
  for (const key of Object.keys(props)) {
    if (key === "children" || key === "id" || key === "role" || key === "tabIndex" || /^(data|aria)-/.test(key) || /^on[A-Z]/.test(key)) out[key] = props[key];
  }
  return out;
}

function pick(list, value, fallback, what) {
  if (value === undefined || value === null) return fallback;
  const v = String(value);
  if (!list.includes(v)) throw new Error(what + " must be one of " + list.join(", ") + "; got " + JSON.stringify(value));
  return v;
}

const step = (value, what) => (value === undefined ? null : pick(SPACE, value, null, what).replace(".", "_"));

function classes(...names) {
  return names.filter(Boolean).join(" ");
}

function spacing(props) {
  const p = step(props.padding, "padding");
  const px = step(props.paddingX, "paddingX");
  const py = step(props.paddingY, "paddingY");
  return [p && "bsk-p-" + p, px && "bsk-px-" + px, py && "bsk-py-" + py];
}

export function Box(props) {
  const tag = pick(["div", "section", "article", "header", "footer", "main", "nav", "aside", "form", "ul", "ol", "li"], props.as, "div", "Box as");
  return createElement(tag, { ...passThrough(props), className: classes("bsk-box", ...spacing(props)) });
}

export function Stack(props) {
  const tag = pick(["div", "section", "header", "footer", "nav", "ul", "ol", "li", "form"], props.as, "div", "Stack as");
  const direction = pick(["column", "row"], props.direction, "column", "direction");
  const gap = step(props.gap, "gap");
  const align = props.align === undefined ? null : pick(["start", "center", "end", "stretch", "baseline"], props.align, null, "align");
  const justify = props.justify === undefined ? null : pick(["start", "center", "end", "between"], props.justify, null, "justify");
  return createElement(tag, {
    ...passThrough(props),
    className: classes(
      "bsk-stack",
      direction === "row" && "bsk-row",
      props.wrap && "bsk-wrap",
      props.grow && "bsk-grow",
      gap && "bsk-gap-" + gap,
      align && "bsk-align-" + align,
      justify && "bsk-justify-" + justify,
      ...spacing(props),
    ),
  });
}

export function Grid(props) {
  const columns = pick(["1", "2", "3", "4", "5", "6"], props.columns, "2", "columns");
  const gap = step(props.gap, "gap");
  return createElement(props.as === "ul" ? "ul" : "div", {
    ...passThrough(props),
    className: classes("bsk-grid", "bsk-cols-" + columns, gap && "bsk-gap-" + gap, ...spacing(props)),
  });
}

export function Text(props) {
  const tag = pick(["p", "span", "div", "label", "small", "strong", "em", "code"], props.as, "p", "Text as");
  return createElement(tag, {
    ...passThrough(props),
    className: classes(
      "bsk-text",
      "bsk-size-" + pick(SIZES, props.size, "sm", "size"),
      "bsk-tone-" + pick(TONES, props.tone, "default", "tone"),
      "bsk-weight-" + pick(WEIGHTS, props.weight, "normal", "weight"),
      props.truncate && "bsk-truncate",
    ),
  });
}

const HEADING_SIZE = { 1: "3xl", 2: "2xl", 3: "xl", 4: "lg", 5: "base", 6: "sm" };

export function Heading(props) {
  const level = Number(pick(["1", "2", "3", "4", "5", "6"], props.level, "2", "level"));
  return createElement("h" + level, {
    ...passThrough(props),
    className: classes(
      "bsk-heading",
      "bsk-size-" + pick(SIZES, props.size, HEADING_SIZE[level], "size"),
      "bsk-tone-" + pick(TONES, props.tone, "default", "tone"),
      props.truncate && "bsk-truncate",
    ),
  });
}
`;

/** What the agent's catalog says about each primitive. */
export const PRIMITIVE_DOCS: Record<PrimitiveName, string> = {
  Box: `as ("div" | "section" | "article" | "header" | "footer" | "main" | "nav" | "aside" | "form" | "ul" | "ol" | "li"), padding, paddingX, paddingY`,
  Stack: `direction ("column" | "row"), gap, align ("start" | "center" | "end" | "stretch" | "baseline"), justify ("start" | "center" | "end" | "between"), wrap, grow (children share the row), padding, paddingX, paddingY, as`,
  Grid: `columns (1–6), gap, padding, paddingX, paddingY, as ("div" | "ul")`,
  Text: `as ("p" | "span" | "div" | "label" | "small" | "strong" | "em" | "code"), size (${TEXT_SIZES.join(", ")}), tone (${TONES.join(", ")}), weight (${WEIGHTS.join(", ")}), truncate`,
  Heading: `level (1–6), size, tone, truncate`,
};

export const SPACE_DOC = `Spacing props take a step on the system's spacing scale: ${SPACE_STEPS.map((s) => `"${s}"`).join(", ")} (multiples of --spacing).`;
