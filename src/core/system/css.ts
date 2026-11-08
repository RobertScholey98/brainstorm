/**
 * Reads a design system's compiled CSS. Tailwind v4's output is unoptimised, so it nests (`&:hover { … }`) inside
 * layers, media and supports blocks; this parser keeps the nesting and resolves `&` against the parent selector.
 * Everything here is pure: text in, plain data out.
 */

export type CssDecl = { readonly property: string; readonly value: string };

export type CssNode =
  | { readonly type: "rule"; readonly selector: string; readonly decls: readonly CssDecl[]; readonly children: readonly CssNode[] }
  | { readonly type: "at"; readonly name: string; readonly prelude: string; readonly children: readonly CssNode[] | null };

/** A rule with its selector resolved through nesting, and the at-rules around it, outermost first. */
export type FlatRule = {
  readonly selector: string;
  readonly decls: readonly CssDecl[];
  readonly layer: string | null;
  /** True inside @media, @supports, @container or @starting-style, where a value only sometimes applies. */
  readonly conditional: boolean;
};

export function parseCss(css: string): CssNode[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;

  /** Reads up to (not past) one of `stops` at depth 0, skipping strings and parentheses. */
  function readUntil(stops: string): string {
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const c = text[i] as string;
      // An escaped character, such as the \' and \[ in Tailwind's `.\*\:\[svg\:not\(\[class\*\=\'size-\'\]\)\]`, is
      // part of the name, not a string or a bracket.
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const quote = c;
        i += 1;
        while (i < text.length && text[i] !== quote) i += text[i] === "\\" ? 2 : 1;
        i += 1;
        continue;
      }
      if (c === "(" || c === "[") depth += 1;
      else if (c === ")" || c === "]") depth -= 1;
      else if (depth === 0 && stops.includes(c)) break;
      i += 1;
    }
    return text.slice(start, i);
  }

  function block(): { decls: CssDecl[]; children: CssNode[] } {
    const decls: CssDecl[] = [];
    const children: CssNode[] = [];
    while (i < text.length) {
      const chunk = readUntil(";{}");
      const c = text[i];
      const head = chunk.trim();
      if (c === "}" || c === undefined) {
        if (head) pushDecl(decls, head);
        i += 1;
        break;
      }
      if (c === ";") {
        i += 1;
        if (head.startsWith("@")) children.push(atRule(head, null));
        else if (head) pushDecl(decls, head);
        continue;
      }
      // c === "{"
      i += 1;
      const inner = block();
      if (head.startsWith("@")) children.push(atRule(head, [...nestedDeclsAsRule(inner.decls), ...inner.children]));
      else children.push({ type: "rule", selector: head, decls: inner.decls, children: inner.children });
    }
    return { decls, children };
  }

  const top: CssNode[] = [];
  while (i < text.length) {
    const chunk = readUntil(";{}");
    const c = text[i];
    const head = chunk.trim();
    if (c === undefined) break;
    i += 1;
    if (c === "}") continue;
    if (c === ";") {
      if (head.startsWith("@")) top.push(atRule(head, null));
      continue;
    }
    const inner = block();
    if (head.startsWith("@")) top.push(atRule(head, [...nestedDeclsAsRule(inner.decls), ...inner.children]));
    else top.push({ type: "rule", selector: head, decls: inner.decls, children: inner.children });
  }
  return top;
}

/** Declarations written straight inside a nested at-rule apply to the enclosing rule's selector. */
function nestedDeclsAsRule(decls: readonly CssDecl[]): CssNode[] {
  return decls.length === 0 ? [] : [{ type: "rule", selector: "&", decls, children: [] }];
}

function pushDecl(decls: CssDecl[], text: string): void {
  const colon = text.indexOf(":");
  if (colon <= 0) return;
  const property = text.slice(0, colon).trim().toLowerCase();
  const value = text
    .slice(colon + 1)
    .replace(/!important\s*$/i, "")
    .trim();
  if (property && value) decls.push({ property: property.startsWith("--") ? text.slice(0, colon).trim() : property, value });
}

function atRule(head: string, children: CssNode[] | null): CssNode {
  const match = /^@([\w-]+)\s*([\s\S]*)$/.exec(head);
  return { type: "at", name: (match?.[1] ?? "").toLowerCase(), prelude: (match?.[2] ?? "").trim(), children };
}

const CONDITIONAL = new Set(["media", "supports", "container", "starting-style"]);

/** Splits a selector list on top-level commas. */
export function splitSelectors(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth -= 1;
    else if (c === "," && depth === 0) {
      out.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(selector.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

function nest(parent: string | null, child: string): string {
  if (parent === null) return child;
  const parents = splitSelectors(parent);
  return splitSelectors(child)
    .flatMap((c) => parents.map((p) => (c.includes("&") ? c.replaceAll("&", p) : `${p} ${c}`)))
    .join(", ");
}

export function flattenCss(nodes: readonly CssNode[]): FlatRule[] {
  const out: FlatRule[] = [];
  const visit = (list: readonly CssNode[], selector: string | null, layer: string | null, conditional: boolean) => {
    for (const node of list) {
      if (node.type === "at") {
        if (node.children === null) continue;
        const nextLayer = node.name === "layer" ? node.prelude || layer : layer;
        visit(node.children, selector, nextLayer, conditional || CONDITIONAL.has(node.name));
        continue;
      }
      const resolved = nest(selector, node.selector);
      if (node.decls.length > 0) out.push({ selector: resolved, decls: node.decls, layer, conditional });
      visit(node.children, resolved, layer, conditional);
    }
  };
  visit(nodes, null, null, false);
  return out;
}

const unescapeClass = (raw: string): string =>
  raw.replace(/\\([0-9a-fA-F]{1,6})\s?|\\(.)/g, (_, hex: string | undefined, ch: string | undefined) =>
    hex !== undefined ? String.fromCodePoint(Number.parseInt(hex, 16)) : (ch ?? ""),
  );

/** Every class name a selector mentions, unescaped (`.hover\:bg-x` is `hover:bg-x`). */
export function selectorClasses(selector: string): string[] {
  return [...selector.matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[A-Za-z0-9_-])+)/g)].map((m) => unescapeClass(m[1] ?? ""));
}

// --- Theme axes and tokens -------------------------------------------------------------------------------------------

export type ThemeAxis = {
  /** `data-theme`, or `class` for a class such as `.dark`. */
  readonly attribute: string;
  readonly values: readonly string[];
  /** The value `:root` shares its rule with, so it applies with no attribute set. Null when none does. */
  readonly default: string | null;
};

export type TokenKind = "color" | "length" | "number" | "font" | "other";

export type Token = {
  readonly name: string;
  readonly kind: TokenKind;
  /** The value `:root` declares. */
  readonly value: string;
  /** `system` for the library's own tokens; `tailwind` for Tailwind's theme layer. */
  readonly origin: "system" | "tailwind";
  /** Values each axis value sets, keyed `attribute=value`. */
  readonly byAxis: Readonly<Record<string, string>>;
};

const AXIS_SELECTOR = /^\[(data-[\w-]+)=(?:'([\w-]+)'|"([\w-]+)"|([\w-]+))\]$/;
const CLASS_SELECTOR = /^\.([A-Za-z][\w-]*)$/;
/** `[data-theme]` with no value matches wherever any theme is set, so it counts as the root. */
const ROOT_SELECTOR = /^(:root|html|:host|\[data-[\w-]+\])$/;

type AxisMatch = { readonly attribute: string; readonly value: string };

function axisOf(selector: string): AxisMatch | null {
  const data = AXIS_SELECTOR.exec(selector);
  if (data !== null) return { attribute: data[1] ?? "", value: data[2] ?? data[3] ?? data[4] ?? "" };
  const cls = CLASS_SELECTOR.exec(selector);
  return cls === null ? null : { attribute: "class", value: cls[1] ?? "" };
}

const customProps = (decls: readonly CssDecl[]) => decls.filter((d) => d.property.startsWith("--") && !d.property.startsWith("--tw-"));

export type ThemeModel = { readonly axes: readonly ThemeAxis[]; readonly tokens: readonly Token[] };

export function themeModel(rules: readonly FlatRule[]): ThemeModel {
  const tokens = new Map<string, { value: string; origin: Token["origin"]; byAxis: Record<string, string> }>();
  const axes = new Map<string, { values: string[]; default: string | null }>();

  for (const rule of rules) {
    if (rule.conditional) continue;
    const props = customProps(rule.decls);
    if (props.length === 0) continue;
    const selectors = splitSelectors(rule.selector);
    const hasRoot = selectors.some((s) => ROOT_SELECTOR.test(s));
    const matches = selectors.map(axisOf);
    if (matches.some((m) => m === null) && !hasRoot) continue;
    if (!selectors.every((s, i) => ROOT_SELECTOR.test(s) || matches[i] !== null)) continue;

    for (const m of matches) {
      if (m === null) continue;
      const axis = axes.get(m.attribute) ?? { values: [], default: null };
      if (!axis.values.includes(m.value)) axis.values.push(m.value);
      if (hasRoot) axis.default = m.value;
      axes.set(m.attribute, axis);
    }
    for (const d of props) {
      const token = tokens.get(d.property) ?? { value: "", origin: rule.layer === "theme" ? "tailwind" : "system", byAxis: {} };
      if (hasRoot) token.value = d.value;
      for (const m of matches) if (m !== null) token.byAxis[`${m.attribute}=${m.value}`] = d.value;
      if (rule.layer !== "theme") token.origin = "system";
      tokens.set(d.property, token);
    }
  }

  const vars = new Map([...tokens].map(([name, t]) => [name, t.value]));
  const setsColor = (key: string) =>
    [...tokens.values()].some((t) => t.byAxis[key] !== undefined && isColorValue(resolveVars(t.byAxis[key] ?? "", vars)));
  return {
    // A class only counts as a theme when it changes a colour token, so a helper such as `.scroll-fade { --mask }` doesn't.
    axes: [...axes]
      .filter(([attribute, a]) => attribute !== "class" || a.values.some((v) => setsColor(`class=${v}`)))
      .map(([attribute, a]) => ({ attribute, values: a.values, default: a.default })),
    tokens: [...tokens].map(([name, t]) => ({
      name,
      kind: tokenKind(name, resolveVars(t.value || Object.values(t.byAxis)[0] || "", vars)),
      value: t.value,
      origin: t.origin,
      byAxis: t.byAxis,
    })),
  };
}

const COLOR_FUNCTION = /^(oklch|oklab|lch|lab|rgb|rgba|hsl|hsla|hwb|color|color-mix)\(/i;
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isColorValue(value: string): boolean {
  const v = value.trim();
  return HEX.test(v) || COLOR_FUNCTION.test(v);
}

function tokenKind(name: string, resolved: string): TokenKind {
  if (isColorValue(resolved)) return "color";
  if (/font/.test(name) && !/size|weight|leading|tracking/.test(name)) return "font";
  if (toPx(resolved) !== null) return "length";
  if (/^-?\d*\.?\d+$/.test(resolved.trim())) return "number";
  return "other";
}

// --- Values --------------------------------------------------------------------------------------------------------

/** Replaces `var(--x, fallback)` with the variable's value, recursively, using the fallback for an unknown one. */
export function resolveVars(value: string, vars: ReadonlyMap<string, string>, depth = 0): string {
  if (depth > 12 || !value.includes("var(")) return value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf("var(", i);
    if (start < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    let depthParen = 0;
    let end = start + 4;
    for (; end < value.length; end += 1) {
      if (value[end] === "(") depthParen += 1;
      else if (value[end] === ")") {
        if (depthParen === 0) break;
        depthParen -= 1;
      }
    }
    const inner = value.slice(start + 4, end);
    const comma = topLevelComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    const known = vars.get(name);
    const replacement = known !== undefined && known !== "" ? known : (fallback ?? "");
    out += resolveVars(replacement, vars, depth + 1);
    i = end + 1;
  }
  return out;
}

function topLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) return i;
  }
  return -1;
}

const ROOT_FONT_PX = 16;

/** A length or `calc()` of lengths in px, or null when it isn't one (or uses %, vw and the like). */
export function toPx(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (v === "0") return 0;
  const tokens = v.replace(/^calc/, "").match(/-?\d*\.?\d+(?:e-?\d+)?(?:px|rem|em)?|[()+*/-]/g);
  if (tokens === null || tokens.join("").length !== v.replace(/^calc/, "").replace(/\s+/g, "").length) return null;
  let pos = 0;
  type Q = { n: number; unit: boolean };
  const atom = (): Q | null => {
    const t = tokens[pos];
    if (t === undefined) return null;
    if (t === "(") {
      pos += 1;
      const inner = sum();
      if (tokens[pos] !== ")") return null;
      pos += 1;
      return inner;
    }
    if (t === "-" && tokens[pos + 1] !== undefined) {
      pos += 1;
      const a = atom();
      return a === null ? null : { n: -a.n, unit: a.unit };
    }
    const m = /^(-?\d*\.?\d+(?:e-?\d+)?)(px|rem|em)?$/.exec(t);
    if (m === null) return null;
    pos += 1;
    const n = Number(m[1]);
    return m[2] === undefined ? { n, unit: false } : { n: m[2] === "px" ? n : n * ROOT_FONT_PX, unit: true };
  };
  const product = (): Q | null => {
    let left = atom();
    while (left !== null && (tokens[pos] === "*" || tokens[pos] === "/")) {
      const op = tokens[pos];
      pos += 1;
      const right = atom();
      if (right === null) return null;
      left = op === "*" ? { n: left.n * right.n, unit: left.unit || right.unit } : { n: left.n / right.n, unit: left.unit };
    }
    return left;
  };
  const sum = (): Q | null => {
    let left = product();
    while (left !== null && (tokens[pos] === "+" || tokens[pos] === "-")) {
      const op = tokens[pos];
      pos += 1;
      const right = product();
      if (right === null) return null;
      left = { n: op === "+" ? left.n + right.n : left.n - right.n, unit: left.unit || right.unit };
    }
    return left;
  };
  const result = sum();
  if (result === null || pos !== tokens.length || !result.unit) return result !== null && result.n === 0 && pos === tokens.length ? 0 : null;
  return Math.round(result.n * 100) / 100;
}

// --- Scales a kit uses ---------------------------------------------------------------------------------------------

export type Family = "spacing" | "radius" | "fontSize" | "fontWeight" | "lineHeight" | "borderWidth" | "shadow" | "color";

export const FAMILY_LABEL: Record<Family, string> = {
  spacing: "spacing",
  radius: "corner radius",
  fontSize: "font size",
  fontWeight: "font weight",
  lineHeight: "line height",
  borderWidth: "border width",
  shadow: "shadow",
  color: "colour",
};

export function familyOf(property: string): Family | null {
  const p = property.toLowerCase();
  if (/^(padding|margin)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$/.test(p)) return "spacing";
  if (/^(gap|row-gap|column-gap)$/.test(p)) return "spacing";
  if (/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(p)) return "radius";
  if (p === "font-size") return "fontSize";
  if (p === "font-weight") return "fontWeight";
  if (p === "line-height") return "lineHeight";
  if (/^border(-(top|right|bottom|left|inline|block|x|y))?-width$/.test(p) || p === "outline-width") return "borderWidth";
  if (p === "box-shadow") return "shadow";
  if (/^(color|background-color|fill|stroke|outline-color|text-decoration-color|caret-color|accent-color)$/.test(p)) return "color";
  if (/^border(-(top|right|bottom|left|inline|block))?-color$/.test(p)) return "color";
  return null;
}

const KEYWORDS = new Set(["0", "auto", "inherit", "initial", "unset", "revert", "none", "normal", "currentcolor", "transparent"]);

export const isKeyword = (value: string): boolean => KEYWORDS.has(value.trim().toLowerCase());

/** One value in a family's comparable form: px for lengths, the bare number for weights and ratios, else the text. */
export function normalizeValue(family: Family, resolved: string): string | null {
  const v = resolved.trim().replace(/\s+/g, " ");
  if (v === "" || isKeyword(v)) return null;
  if (family === "shadow" && v.replace(/[,\s]/g, "") === "") return null;
  if (family === "color" || family === "shadow") return v.toLowerCase();
  const px = toPx(v);
  if (px !== null) return `${px}px`;
  if (/^-?\d*\.?\d+$/.test(v)) return String(Number(v));
  return null;
}

export type Measured = Readonly<Record<Family, readonly string[]>>;

export type OffScale = { readonly className: string; readonly property: string; readonly value: string };

export type KitStyles = {
  readonly theme: ThemeModel;
  /** Every class the CSS defines, unescaped. */
  readonly classes: readonly string[];
  /** The values the kit uses per family, normalized, with the default theme's tokens resolved. */
  readonly measured: Measured;
  /** Values written as literals where the kit otherwise uses tokens: spacing, radius and font size. */
  readonly offScale: readonly OffScale[];
  /** The declarations of the kit's `html` and `body` rules, which the canvas gives each frame. */
  readonly surface: readonly CssDecl[];
};

const LITERAL_CHECKED = new Set<Family>(["spacing", "radius", "fontSize"]);

export function rootVars(theme: ThemeModel): Map<string, string> {
  return new Map(theme.tokens.map((t) => [t.name, t.value || Object.values(t.byAxis)[0] || ""]));
}

export function analyzeKitCss(css: string): KitStyles {
  const rules = flattenCss(parseCss(css));
  const theme = themeModel(rules);
  const vars = rootVars(theme);
  // Utilities set their own --tw-* and other scoped variables (`--tw-leading`); resolving those falls back as browsers do.
  const classes = new Set<string>();
  const measured: Record<Family, Set<string>> = {
    spacing: new Set(),
    radius: new Set(),
    fontSize: new Set(),
    fontWeight: new Set(),
    lineHeight: new Set(),
    borderWidth: new Set(),
    shadow: new Set(),
    color: new Set(),
  };
  const offScale: OffScale[] = [];
  const surface: CssDecl[] = [];

  for (const rule of rules) {
    const ruleClasses = selectorClasses(rule.selector);
    for (const c of ruleClasses) classes.add(c);
    const selectors = splitSelectors(rule.selector);
    if (selectors.some((s) => /^(html|body)$/.test(s) || s === "html, :host") && !rule.conditional) {
      surface.push(...rule.decls.filter((d) => !d.property.startsWith("--")));
    }
    for (const d of rule.decls) {
      const family = familyOf(d.property);
      if (family === null) continue;
      const resolved = resolveVars(d.value, vars);
      const normal = normalizeValue(family, resolved);
      if (normal !== null) measured[family].add(normal);
      const literal = !d.value.includes("var(") && normal !== null && LITERAL_CHECKED.has(family) && ruleClasses.length > 0;
      if (literal && normal !== "0px") {
        const className = ruleClasses.find((c) => c.includes("[")) ?? null;
        if (className !== null) offScale.push({ className, property: d.property, value: d.value });
      }
    }
  }

  const sortValues = (family: Family, values: Set<string>) =>
    [...values].sort((a, b) => (family === "color" || family === "shadow" ? a.localeCompare(b) : Number.parseFloat(a) - Number.parseFloat(b)));
  return {
    theme,
    classes: [...classes].sort(),
    measured: Object.fromEntries(Object.entries(measured).map(([f, v]) => [f, sortValues(f as Family, v)])) as unknown as Measured,
    offScale,
    surface: dedupeDecls(surface),
  };
}

function dedupeDecls(decls: readonly CssDecl[]): CssDecl[] {
  const byProperty = new Map<string, CssDecl>();
  for (const d of decls) byProperty.set(d.property, d);
  return [...byProperty.values()];
}

/** The classes a rendered story's HTML uses. */
export function htmlClasses(html: string): string[] {
  return [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) =>
    (m[1] ?? "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** Whether any colour declaration on these classes reads a token, so a theme change reaches what they style. */
export function readsColorToken(classes: readonly string[], css: string | FlatRule[]): boolean {
  const rules = typeof css === "string" ? flattenCss(parseCss(css)) : css;
  const wanted = new Set(classes);
  return rules.some(
    (rule) =>
      selectorClasses(rule.selector).some((c) => wanted.has(c)) &&
      rule.decls.some((d) => familyOf(d.property) === "color" && /var\(--(?!tw-)/.test(d.value)),
  );
}
