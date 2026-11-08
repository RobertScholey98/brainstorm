import { transform } from "sucrase";
import { issue, type Issue } from "../types";
import {
  FAMILY_LABEL,
  familyOf,
  flattenCss,
  isColorValue,
  isKeyword,
  normalizeValue,
  parseCss,
  resolveVars,
  selectorClasses,
  type Family,
} from "./css";
import type { SystemStyles } from "./model";

/**
 * The rules that hold a design to its design system (ADR 007). They read sucrase's compiled output, where every JSX
 * element is `jsx.call(void 0, <type>, { …props })`: a string type is an HTML tag, and props are object keys. The risk
 * is an agent drifting from the kit, not one working around a check, so reading the compiled code is enough.
 */

const RAW_TAG = /\bjsxs?\.call\(void 0,\s*(['"])([^'"]+)\1/g;
const CREATE_ELEMENT = /\bcreateElement\(\s*(['"`])([^'"`]+)\1/g;
const STYLE_KEY = /[{,]\s*(?:(['"])(className|class|style)\1|(className|style))\s*:/g;

const unique = <T>(items: readonly T[]) => [...new Set(items)];

/**
 * Compiles a source the way the check does, so its conformance can be read even when it fails to render. Null when it
 * doesn't compile, which the check reports itself.
 */
export function compiledForConformance(source: string): string | null {
  try {
    return transform(source, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  } catch {
    return null;
  }
}

function rawTags(compiled: string): string[] {
  return unique([...compiled.matchAll(RAW_TAG), ...compiled.matchAll(CREATE_ELEMENT)].map((m) => m[2] ?? ""));
}

function styleKeys(compiled: string): string[] {
  return unique([...compiled.matchAll(STYLE_KEY)].map((m) => m[2] ?? m[3] ?? ""));
}

/** Kit exports a compiled module reads: `_kit.Button`, and `K.Button` after `import * as K from "kit"`. */
export function kitNamesUsed(compiled: string): string[] {
  const aliases = ["_kit", ...[...compiled.matchAll(/\bvar (\w+) = _interopRequireWildcard\(_kit\)/g)].map((m) => m[1] ?? "")];
  return unique(aliases.flatMap((alias) => [...compiled.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z_$][\\w$]*)`, "g"))].map((m) => m[1] ?? "")));
}

export function proposedImports(compiled: string): string[] {
  return unique([...compiled.matchAll(/\brequire\((['"])proposed\/([^'"]+)\1\)/g)].map((m) => m[2] ?? ""));
}

/** A block in a session with a design system composes the kit's components and the session's proposed ones, nothing else. */
export function blockConformance(input: {
  readonly compiled: string;
  readonly file: string;
  readonly cssFile: string | null;
  readonly exports: ReadonlySet<string>;
  readonly proposed: ReadonlySet<string>;
}): Issue[] {
  const { compiled, file } = input;
  const issues: Issue[] = [];
  for (const tag of rawTags(compiled)) {
    issues.push(
      issue(
        "raw_element",
        `writes <${tag}>; a block in a session with a design system composes the kit's components (Stack, Grid, Box, Text, Heading and the library's own), or a proposed component when the kit has nothing that fits`,
        { file },
      ),
    );
  }
  for (const key of styleKeys(compiled)) {
    issues.push(
      issue("style_prop", `passes ${key}; the kit's components carry their own styles, so pick one of their props or variants instead`, { file }),
    );
  }
  if (input.cssFile !== null) {
    issues.push(issue("css_in_system", "a block in a session with a design system has no block.css; its look comes from the kit, so delete the file", { file: input.cssFile }));
  }
  for (const name of kitNamesUsed(compiled)) {
    if (!input.exports.has(name)) {
      issues.push(issue("unknown_component", `the kit has no export "${name}"; system/CATALOG.md lists what it has`, { file }));
    }
  }
  for (const name of proposedImports(compiled)) {
    if (!input.proposed.has(name)) {
      issues.push(issue("unknown_proposed", `imports proposed/${name}, but there is no proposed/${name}/component.tsx`, { file }));
    }
  }
  return issues;
}

const CLASS_VALUE = /[{,]\s*(?:(['"])(?:className|class)\1|className)\s*:\s*/g;

/** The class names a compiled module writes as literals, and whether any className is computed. */
export function literalClasses(compiled: string): { classes: string[]; dynamic: boolean } {
  const classes: string[] = [];
  let dynamic = false;
  for (const m of compiled.matchAll(CLASS_VALUE)) {
    const rest = compiled.slice((m.index ?? 0) + m[0].length);
    const literal = /^(["'])((?:\\.|(?!\1).)*)\1\s*[,}]/.exec(rest) ?? /^`([^`$]*)`\s*[,}]/.exec(rest);
    if (literal === null) {
      dynamic = true;
      continue;
    }
    const text = literal.length === 3 ? (literal[2] ?? "") : (literal[1] ?? "");
    classes.push(...text.split(/\s+/).filter(Boolean));
  }
  return { classes: unique(classes), dynamic };
}

/**
 * A proposed component may write HTML, but in the kit's own terms: classes the kit's CSS defines, and in its
 * component.css only token variables and the values the kit already uses. That keeps its padding, radii and type on
 * the scales the real application uses, which is the drift ADR 007 exists to stop.
 */
export function proposedConformance(input: {
  readonly compiled: string;
  readonly css: string | null;
  readonly file: string;
  readonly cssFile: string;
  readonly styles: SystemStyles;
  readonly exports: ReadonlySet<string>;
  readonly proposed: ReadonlySet<string>;
}): Issue[] {
  const { compiled, file, styles } = input;
  const issues: Issue[] = [];
  if (styleKeys(compiled).includes("style")) {
    issues.push(issue("style_prop", "passes style; write the styles in component.css, where commit can hold them to the kit's scales", { file }));
  }
  const own = input.css === null ? [] : flattenCss(parseCss(input.css)).flatMap((r) => selectorClasses(r.selector));
  const known = new Set([...styles.classes, ...own]);
  const { classes, dynamic } = literalClasses(compiled);
  for (const c of classes) {
    if (!known.has(c)) {
      issues.push(issue("unknown_class", `class "${c}" isn't in the kit's CSS, so it styles nothing; use one the kit has, or a rule in component.css`, { file }));
    }
  }
  if (dynamic) {
    issues.push(issue("dynamic_class", "builds a className from an expression, so commit can't check its classes; write them as literals", { file }));
  }
  for (const name of kitNamesUsed(compiled)) {
    if (!input.exports.has(name)) issues.push(issue("unknown_component", `the kit has no export "${name}"; system/CATALOG.md lists what it has`, { file }));
  }
  for (const name of proposedImports(compiled)) {
    if (!input.proposed.has(name)) issues.push(issue("unknown_proposed", `imports proposed/${name}, but there is no proposed/${name}/component.tsx`, { file }));
  }
  if (input.css !== null) issues.push(...cssConformance(input.css, input.cssFile, styles));
  return issues;
}

const shown = (family: Family, values: readonly string[]) => {
  const list = family === "color" ? values.slice(0, 6) : values.filter((v) => !v.startsWith("-"));
  return list.length === 0 ? "nothing in this family" : list.join(", ");
};

/** The kit's value closest to an off-scale one, when both are plain numbers in one unit. */
function nearest(normal: string, values: readonly string[]): string | null {
  const unit = (v: string) => v.match(/^(-?[\d.]+)([a-z%]*)$/);
  const m = unit(normal);
  if (m === null) return null;
  let best: [string, number] | null = null;
  for (const v of values) {
    const n = unit(v);
    if (n === null || n[2] !== m[2]) continue;
    const d = Math.abs(Number(n[1]) - Number(m[1]));
    if (best === null || d < best[1]) best = [v, d];
  }
  return best?.[0] ?? null;
}

const offScale = (property: string, value: string, normal: string, family: Family, allowed: readonly string[]) => {
  const near = nearest(normal, allowed);
  return `${property}: ${value} is off the kit's ${FAMILY_LABEL[family]} scale${normal === value ? "" : ` (${normal})`}; ${near === null ? "" : `use ${near}, the nearest the kit uses, or another of `}${shown(family, allowed)}`;
};

/** Every value in a proposed component's CSS, against the kit's tokens and the values the kit uses. */
export function cssConformance(css: string, file: string, styles: SystemStyles): Issue[] {
  const tokenNames = new Set(styles.tokens.map((t) => t.name));
  const vars = new Map(styles.tokens.map((t) => [t.name, t.value || Object.values(t.byAxis)[0] || ""]));
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const rule of flattenCss(parseCss(css))) {
    for (const d of rule.decls) {
      if (d.property.startsWith("--")) {
        issues.push(issue("off_scale_value", `sets ${d.property}; a proposed component reads the kit's tokens, it doesn't define its own`, { file }));
        continue;
      }
      const family = familyOf(d.property);
      if (family === null) continue;
      const key = `${d.property}:${d.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const unknownVars = [...d.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] ?? "").filter((n) => !tokenNames.has(n) && !n.startsWith("--tw-"));
      if (unknownVars.length > 0) {
        issues.push(issue("off_scale_value", `${d.property} reads ${unknownVars.join(", ")}, which the kit doesn't define`, { file }));
        continue;
      }
      if (isKeyword(d.value)) continue;
      if (family === "color") {
        if (d.value.includes("var(")) continue;
        const normal = normalizeValue("color", d.value);
        if (normal !== null && isColorValue(d.value) && !styles.measured.color.includes(normal)) {
          issues.push(
            issue("off_scale_value", `${d.property}: ${d.value} isn't one of the kit's colours; read a colour token, such as var(${firstColorToken(styles) ?? "--foreground"})`, { file }),
          );
        }
        continue;
      }
      const normal = normalizeValue(family, resolveVars(d.value, vars));
      if (normal === null) continue;
      const allowed = styles.measured[family];
      if (normal === "0px" || allowed.includes(normal)) continue;
      // Shorthands such as `padding: 8px 12px` normalize to null above; each single value is checked here.
      issues.push(
        issue("off_scale_value", offScale(d.property, d.value, normal, family, allowed), { file }),
      );
    }
  }
  return [...issues, ...shorthandIssues(css, file, styles, vars)];
}

function firstColorToken(styles: SystemStyles): string | null {
  return styles.tokens.find((t) => t.kind === "color" && t.origin === "system")?.name ?? null;
}

/** `padding: 8px 12px` and the like: each part is held to the family's scale on its own. */
function shorthandIssues(css: string, file: string, styles: SystemStyles, vars: ReadonlyMap<string, string>): Issue[] {
  const issues: Issue[] = [];
  for (const rule of flattenCss(parseCss(css))) {
    for (const d of rule.decls) {
      const family = familyOf(d.property);
      if (family === null || family === "color" || family === "shadow") continue;
      const parts = splitTopLevel(d.value);
      if (parts.length < 2) continue;
      for (const part of parts) {
        const normal = normalizeValue(family, resolveVars(part, vars));
        if (normal === null || normal === "0px" || styles.measured[family].includes(normal)) continue;
        issues.push(
          issue("off_scale_value", offScale(d.property, part, normal, family, styles.measured[family]), { file }),
        );
      }
    }
  }
  return issues;
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const c of value.trim()) {
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (/\s/.test(c) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else current += c;
  }
  if (current) out.push(current);
  return out;
}
