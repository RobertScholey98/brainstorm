/**
 * A component's props, read from the library's source without a type checker: the destructured parameter gives names
 * and defaults, and the props type, where it's written in the library itself, gives which are required, their types and
 * a union's or cva variant's options. Types from other packages, like `React.ComponentProps<"button">`, are skipped, so
 * the list holds the props the library declares, which are the ones a reader wants to see.
 */

export type PropInfo = {
  readonly name: string;
  /** The default as written in source, e.g. `"default"`, `false`, `3`; null when none. */
  readonly default: string | null;
  /** True for `name: T`, false for `name?: T` or a prop with a default; null when the props type couldn't be read. */
  readonly required: boolean | null;
  /** A cva variant's keys, or a string-literal union's members; null otherwise. */
  readonly options: readonly string[] | null;
  /** The declared type's source text, short (e.g. `string`, `"sm" | "md"`); null when unknown. */
  readonly type: string | null;
};

/** Props for each named component, read statically from the library's source files (path → text). */
export function componentProps(files: ReadonlyMap<string, string>, names: readonly string[]): Readonly<Record<string, readonly PropInfo[]>> {
  const lib = new Library(files);
  const result: Record<string, readonly PropInfo[]> = {};
  for (const name of names) {
    try {
      result[name] = lib.component(name);
    } catch {
      result[name] = [];
    }
  }
  return result;
}

type Tok = { readonly kind: "id" | "str" | "num" | "tmpl" | "regex" | "punct" | "eof"; readonly text: string; readonly start: number; readonly end: number; readonly nl: boolean };
type Range = readonly [start: number, end: number];
type TypeProp = { readonly name: string; readonly required: boolean; readonly default: string | null; readonly options: readonly string[] | null; readonly type: string | null };

const TYPE_MAX = 80;
const DEPTH_MAX = 8;

class Library {
  private readonly parsed = new Map<string, Parsed | null>();
  private readonly files: ReadonlyMap<string, string>;

  constructor(files: ReadonlyMap<string, string>) {
    this.files = files;
  }

  component(name: string): PropInfo[] {
    for (const path of this.files.keys()) {
      const f = this.file(path);
      const at = f?.values.get(name);
      if (f === undefined || f === null || at === undefined) continue;
      const signature = this.signature(f, at);
      if (signature !== null) return this.merge(f, signature);
    }
    return [];
  }

  private file(path: string): Parsed | null | undefined {
    if (!this.parsed.has(path)) {
      const src = this.files.get(path);
      this.parsed.set(path, src === undefined ? null : parse(src, path));
    }
    return this.parsed.get(path);
  }

  /** The props a component's first parameter destructures, and its type, from a `function` or `const` declaration. */
  private signature(f: Parsed, at: number): Signature | null {
    if (f.tok(at).text === "function") {
      let i = at + 1;
      if (f.tok(i).kind === "id") i++;
      return this.params(f, f.skipAngle(i), null);
    }
    // `const X = …` or `const X: React.FC<Props> = …`.
    let i = at + 2;
    let hint: Range | null = null;
    if (f.tok(i).text === ":") {
      const eq = f.findTop(i + 1, f.toks.length, (t) => t.text === "=" || t.text === ";", true);
      if (eq < 0 || f.tok(eq).text !== "=") return null;
      hint = componentTypeArg(f, i + 1, eq);
      i = eq;
    }
    if (f.tok(i).text !== "=") return null;
    return this.expression(f, i + 1, hint, 0);
  }

  /** A function expression, an arrow, or a wrapper call such as `forwardRef(…)` or `memo(…)` around one. */
  private expression(f: Parsed, i: number, hint: Range | null, depth: number): Signature | null {
    if (depth > DEPTH_MAX) return null;
    if (f.tok(i).text === "async") i++;
    const t = f.tok(i);
    if (t.text === "function") {
      let j = i + 1;
      if (f.tok(j).kind === "id") j++;
      return this.params(f, f.skipAngle(j), hint);
    }
    if (t.text === "(" || t.text === "<") {
      const open = f.skipAngle(i);
      const close = f.match[open] ?? -1;
      if (f.tok(open).text !== "(" || close < 0) return null;
      const arrow = f.tok(close + 1).text === "=>" || (f.tok(close + 1).text === ":" && f.tok(f.findTop(close + 2, f.toks.length, (x) => x.text === "=>" || x.text === ";" || x.text === "{", true)).text === "=>");
      return arrow ? this.params(f, open, hint) : null;
    }
    if (t.kind === "id" && f.tok(i + 1).text === "=>") return { destructured: [], type: hint };
    if (t.kind !== "id") return null;
    // A wrapper: `forwardRef`, `React.forwardRef<Ref, Props>`, `memo`, and the like, with the component as its first argument.
    let j = i;
    while (f.tok(j + 1).text === "." && f.tok(j + 2).kind === "id") j += 2;
    const callee = f.tok(j).text;
    let open = j + 1;
    if (f.tok(open).text === "<") {
      const close = f.angleEnd(open, f.toks.length);
      if (close < 0) return null;
      const args = f.split(open + 1, close, ",", true);
      if (callee === "forwardRef" && args[1] !== undefined) hint = args[1];
      open = close + 1;
    }
    const close = f.match[open] ?? -1;
    if (f.tok(open).text !== "(" || close < 0) return null;
    return this.expression(f, open + 1, hint, depth + 1);
  }

  /** The first parameter of the list opening at `open`: a destructuring pattern or a name, with its type if it has one. */
  private params(f: Parsed, open: number, hint: Range | null): Signature | null {
    const close = f.match[open] ?? -1;
    if (f.tok(open).text !== "(" || close < 0) return null;
    const [first] = f.split(open + 1, close, ",", true);
    if (first === undefined || first[0] >= first[1]) return { destructured: [], type: null };
    const [s, e] = first;
    let destructured: Destructured[] = [];
    let i = s;
    if (f.tok(s).text === "{") {
      const end = f.match[s] ?? -1;
      if (end < 0 || end >= e) return null;
      destructured = this.pattern(f, s, end);
      i = end + 1;
    } else if (f.tok(s).kind === "id") {
      i = s + 1;
      if (f.tok(i).text === "?") i++;
    } else return null;
    if (f.tok(i).text !== ":") return { destructured, type: hint };
    const eq = f.findTop(i + 1, e, (t) => t.text === "=", true);
    return { destructured, type: [i + 1, eq < 0 ? e : eq] };
  }

  /** The names a destructuring pattern takes, in order, with their defaults; the rest element and computed keys are skipped. */
  private pattern(f: Parsed, open: number, close: number): Destructured[] {
    const out: Destructured[] = [];
    for (const [s, e] of f.split(open + 1, close, ",", true)) {
      const key = f.tok(s);
      if (s >= e || key.text === "..." || !isKey(key)) continue;
      const eq = f.findTop(s + 1, e, (t) => t.text === "=", true);
      out.push({ name: keyName(key), default: eq < 0 || eq + 1 >= e ? null : f.text(eq + 1, e, Infinity) });
    }
    return out;
  }

  private merge(f: Parsed, signature: Signature): PropInfo[] {
    const typed = signature.type === null ? null : this.readType(f, signature.type, 0, new Set());
    const byName = new Map((typed ?? []).map((p) => [p.name, p]));
    const out: PropInfo[] = [];
    const seen = new Set<string>();
    for (const d of signature.destructured) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      const t = byName.get(d.name);
      const value = d.default ?? t?.default ?? null;
      out.push({ name: d.name, default: value, required: value !== null ? false : t !== undefined ? t.required : null, options: t?.options ?? null, type: t?.type ?? null });
    }
    for (const t of typed ?? []) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push({ name: t.name, default: t.default, required: t.default !== null ? false : t.required, options: t.options, type: t.type });
    }
    return out;
  }

  /**
   * The props a type names: an intersection's readable parts in order, a type literal's members, a same-file (or, when
   * only one file declares it, another file's) alias or interface, `VariantProps<typeof x>` of a cva call, and `Omit`,
   * `Pick`, `Partial` and `Required` of any of those.
   */
  /** `seen` holds the declarations being read on the way here, so a type that names itself stops. */
  private readType(f: Parsed, [a, b]: Range, depth: number, seen: ReadonlySet<string>): TypeProp[] {
    if (depth > DEPTH_MAX || a >= b) return [];
    const parts = f.split(a, b, "&", true).filter(([s, e]) => s < e);
    if (parts.length > 1) return combine(parts.map((p) => this.readType(f, p, depth + 1, seen)));
    const [s, e] = parts[0] ?? [a, b];
    if (f.split(s, e, "|", true).filter(([x, y]) => x < y).length > 1) return [];
    const t = f.tok(s);
    if ((t.text === "{" || t.text === "(") && f.match[s] === e - 1) {
      return t.text === "{" ? this.members(f, s, e - 1) : this.readType(f, [s + 1, e - 1], depth + 1, seen);
    }
    if (t.kind !== "id") return [];
    let j = s;
    while (f.tok(j + 1).text === "." && f.tok(j + 2).kind === "id") j += 2;
    const args: Range[] = [];
    if (f.tok(j + 1).text === "<") {
      const close = f.angleEnd(j + 1, e);
      if (close !== e - 1) return [];
      args.push(...f.split(j + 2, close, ",", true));
    } else if (j + 1 !== e) return [];
    // A qualified name, such as `React.ComponentProps<"div">`, is another package's type.
    if (j !== s) return [];
    const name = t.text;
    const [first, second] = args;
    if (name === "VariantProps" && first !== undefined && f.tok(first[0]).text === "typeof" && first[1] === first[0] + 2) {
      return this.variants(f, f.tok(first[0] + 1).text);
    }
    if ((name === "Omit" || name === "Pick") && first !== undefined && second !== undefined) {
      const inner = this.readType(f, first, depth + 1, seen);
      const keys = new Set(literals(f, second) ?? []);
      return inner.filter((p) => keys.has(p.name) === (name === "Pick"));
    }
    if ((name === "Partial" || name === "Required" || name === "Readonly") && first !== undefined) {
      const inner = this.readType(f, first, depth + 1, seen);
      return name === "Readonly" ? inner : inner.map((p) => ({ ...p, required: name === "Required" }));
    }
    const found = this.declaration(f, name, (p) => p.types);
    if (found === null) return [];
    const key = `${found.path}\0${found.at}`;
    if (seen.has(key)) return [];
    return this.typeDeclaration(found.file, found.at, depth + 1, new Set([...seen, key]));
  }

  /** `type P = …` or `interface P extends A, B { … }`, the extended types first, as they're written. */
  private typeDeclaration(f: Parsed, at: number, depth: number, seen: ReadonlySet<string>): TypeProp[] {
    const after = f.skipAngle(at + 2);
    if (f.tok(at).text === "type") {
      if (f.tok(after).text !== "=") return [];
      return this.readType(f, [after + 1, f.statementEnd(after + 1, f.toks.length)], depth, seen);
    }
    const body = f.findTop(after, f.toks.length, (t) => t.text === "{" || t.text === ";", true);
    if (f.tok(body).text !== "{" || (f.match[body] ?? -1) < 0) return [];
    const bases = f.tok(after).text === "extends" ? f.split(after + 1, body, ",", true).map((r) => this.readType(f, r, depth, seen)) : [];
    return combine([...bases, this.members(f, body, f.match[body] ?? body)]);
  }

  /** A type literal's or interface body's property and method members; index and call signatures are skipped. */
  private members(f: Parsed, open: number, close: number): TypeProp[] {
    const out: TypeProp[] = [];
    let i = open + 1;
    while (i < close) {
      if (f.tok(i).text === ";" || f.tok(i).text === ",") {
        i++;
        continue;
      }
      const end = f.memberEnd(i, close);
      let k = i;
      if (f.tok(k).text === "readonly" && isKey(f.tok(k + 1))) k++;
      const key = f.tok(k);
      if (isKey(key)) {
        let optional = false;
        k++;
        if (f.tok(k).text === "?") {
          optional = true;
          k++;
        }
        const colon = f.tok(k).text === ":";
        const method = f.tok(k).text === "(" || f.tok(k).text === "<";
        if (colon || method) {
          const range: Range = colon ? [k + 1, end] : [k, end];
          out.push({ name: keyName(key), required: !optional, default: null, options: colon ? literals(f, range) : null, type: f.text(range[0], range[1], TYPE_MAX, true) || null });
        }
      }
      i = Math.max(end, i + 1);
    }
    return out;
  }

  /** The props `VariantProps<typeof x>` gives: each of the cva (or tailwind-variants) call's variants, none required. */
  private variants(f: Parsed, name: string): TypeProp[] {
    const found = this.declaration(f, name, (p) => p.values);
    if (found === null) return [];
    const g = found.file;
    const call = found.at + 3;
    const open = call + 1;
    if (!["cva", "tv"].includes(g.tok(call).text) || g.tok(open).text !== "(" || (g.match[open] ?? -1) < 0) return [];
    const objects = g.split(open + 1, g.match[open] ?? open, ",", false).filter(([s, e]) => g.tok(s).text === "{" && g.match[s] === e - 1);
    const fields = new Map(objects.flatMap(([s, e]) => g.entries(s, e - 1)).map((x) => [x.name, x.value]));
    const variants = fields.get("variants");
    if (variants === undefined || g.tok(variants[0]).text !== "{" || g.match[variants[0]] !== variants[1] - 1) return [];
    const defaults = fields.get("defaultVariants");
    const defaultOf = new Map(defaults !== undefined && g.tok(defaults[0]).text === "{" && g.match[defaults[0]] === defaults[1] - 1 ? g.entries(defaults[0], defaults[1] - 1).map((x) => [x.name, g.text(x.value[0], x.value[1], Infinity)]) : []);
    return g.entries(variants[0], variants[1] - 1).map(({ name: key, value: [s, e] }) => ({
      name: key,
      required: false,
      default: defaultOf.get(key) ?? null,
      options: g.tok(s).text === "{" && g.match[s] === e - 1 ? g.entries(s, e - 1).map((x) => x.name) : null,
      type: null,
    }));
  }

  /** A declaration by name in this file, else in the one other file that declares it; two or more is ambiguous. */
  private declaration(f: Parsed, name: string, pick: (p: Parsed) => ReadonlyMap<string, number>): { file: Parsed; path: string; at: number } | null {
    const own = pick(f).get(name);
    if (own !== undefined) return { file: f, path: f.path, at: own };
    const others: { file: Parsed; path: string; at: number }[] = [];
    for (const path of this.files.keys()) {
      const g = this.file(path);
      const at = g === null || g === undefined || g === f ? undefined : pick(g).get(name);
      if (g && at !== undefined) others.push({ file: g, path, at });
    }
    return others.length === 1 ? (others[0] ?? null) : null;
  }
}

type Destructured = { readonly name: string; readonly default: string | null };
type Signature = { readonly destructured: readonly Destructured[]; readonly type: Range | null };

/** The parts' props in order, the first of any name winning. */
function combine(parts: readonly (readonly TypeProp[])[]): TypeProp[] {
  const seen = new Set<string>();
  return parts.flat().filter((p) => !seen.has(p.name) && seen.add(p.name));
}

/** `P` from `FC<P>`, `React.FunctionComponent<P>` and the like, the props of a `const` typed as a component. */
function componentTypeArg(f: Parsed, a: number, b: number): Range | null {
  let j = a;
  while (f.tok(j + 1).text === "." && f.tok(j + 2).kind === "id") j += 2;
  if (!["FC", "VFC", "FunctionComponent", "ComponentType"].includes(f.tok(j).text) || f.tok(j + 1).text !== "<") return null;
  const close = f.angleEnd(j + 1, b);
  return close < 0 ? null : (f.split(j + 2, close, ",", true)[0] ?? null);
}

/** A union's string members with `undefined` and `null` left out, or null when it has any other kind of member. */
function literals(f: Parsed, [a, b]: Range): string[] | null {
  const members = f.split(a, b, "|", true).filter(([s, e]) => s < e);
  const out: string[] = [];
  for (const [s, e] of members) {
    const t = f.tok(s);
    if (e !== s + 1) return null;
    if (t.kind === "str") out.push(t.text.slice(1, -1));
    else if (t.text !== "undefined" && t.text !== "null") return null;
  }
  return out.length > 0 ? out : null;
}

const isKey = (t: Tok) => t.kind === "id" || t.kind === "str" || t.kind === "num";
const keyName = (t: Tok) => (t.kind === "str" ? t.text.slice(1, -1) : t.text);

const EOF: Tok = { kind: "eof", text: "", start: 0, end: 0, nl: true };
/** A token after which a type carries on to the next line, and one that carries on the line before it. */
const CONTINUES_AFTER = new Set(["|", "&", ":", "=>", "?", "<", ",", "(", "[", "{", ".", "=", "extends", "keyof", "typeof", "infer", "is", "readonly", "as", "new"]);
const CONTINUES_BEFORE = new Set(["|", "&", ".", "?.", "=>", "?", ":", "extends", ">", ")", "]", "}", "as", "is"]);
const OPENS = new Set(["<", "(", "["]);
const CLOSES = new Set([">", ")", "]"]);

/** A file's tokens with their brackets matched, and where each top-level name is declared. */
type Parsed = ReturnType<typeof parse>;

function parse(src: string, path: string) {
  const toks = tokenize(src);
  const match = matchBrackets(toks);
  const tok = (i: number): Tok => toks[i] ?? EOF;

  /** The `>` closing the `<` at `i`, or -1 when it isn't a type argument list (a less-than, say). */
  const angleEnd = (i: number, limit: number): number => {
    let depth = 0;
    for (let j = i; j < limit; j++) {
      const t = tok(j);
      if (t.kind !== "punct") continue;
      if (t.text === "<") depth++;
      else if (t.text === ">" && --depth === 0) return j;
      else if (t.text === "(" || t.text === "[" || t.text === "{") {
        const m = match[j] ?? -1;
        if (m < 0 || m >= limit) return -1;
        j = m;
      } else if (t.text === ")" || t.text === "]" || t.text === "}" || t.text === ";") return -1;
    }
    return -1;
  };
  const skipAngle = (i: number) => (tok(i).text === "<" ? angleEnd(i, toks.length) + 1 || i : i);
  /** The index after the group that starts at `i`, or `i + 1` when no group starts there. */
  const step = (i: number, limit: number, angles: boolean): number => {
    const t = tok(i);
    if (t.kind === "punct" && (t.text === "(" || t.text === "[" || t.text === "{")) {
      const m = match[i] ?? -1;
      if (m > i && m < limit) return m + 1;
    }
    if (angles && t.text === "<") {
      const m = angleEnd(i, limit);
      if (m > i) return m + 1;
    }
    return i + 1;
  };
  const findTop = (a: number, b: number, test: (t: Tok) => boolean, angles: boolean): number => {
    for (let i = a; i < b; i = step(i, b, angles)) if (tok(i).kind === "punct" || tok(i).kind === "id" ? test(tok(i)) : false) return i;
    return -1;
  };
  const split = (a: number, b: number, sep: string, angles: boolean): Range[] => {
    const parts: Range[] = [];
    let s = a;
    for (let i = a; i < b; ) {
      if (tok(i).kind === "punct" && tok(i).text === sep) {
        parts.push([s, i]);
        s = i + 1;
        i++;
      } else i = step(i, b, angles);
    }
    parts.push([s, b]);
    return parts;
  };
  /**
   * Where a member or a statement that may leave out its semicolon ends: at a top-level `;` or `,`, or at a line break
   * where neither side carries the type on.
   */
  const endAt = (a: number, b: number, stops: string): number => {
    for (let i = a; i < b; ) {
      const t = tok(i);
      if (i > a && t.kind === "punct" && stops.includes(t.text)) return i;
      if (i > a && t.nl && !CONTINUES_BEFORE.has(t.text) && !CONTINUES_AFTER.has(tok(i - 1).text)) return i;
      i = step(i, b, true);
    }
    return b;
  };
  /**
   * The source from token `a` to before token `b` on one line, without comments, cut at `max` characters. In a type, a
   * line break that ends a member becomes `; `, so a multi-line `{ width: number height: number }` keeps its members apart.
   */
  const text = (a: number, b: number, max: number, type = false): string => {
    if (type && tok(a).text === "|") a++;
    let out = "";
    for (let i = a; i < b; i++) {
      const t = tok(i);
      const prev = tok(i - 1).text;
      const gap = i === a ? "" : src.slice(tok(i - 1).end, t.start);
      if (gap !== "") {
        if (!gap.includes("\n")) out += " ";
        else if (type && !CONTINUES_BEFORE.has(t.text) && !CONTINUES_AFTER.has(prev)) out += "; ";
        else if (!OPENS.has(prev) && !CLOSES.has(t.text)) out += " ";
      }
      out += t.text;
    }
    return out.length <= max ? out : `${out.slice(0, max - 1)}…`;
  };
  /** An object literal's `key: value` entries; shorthand, spread and computed entries are skipped. */
  const entries = (open: number, close: number) =>
    split(open + 1, close, ",", false).flatMap(([s, e]) =>
      s + 2 < e && isKey(tok(s)) && tok(s + 1).text === ":" ? [{ name: keyName(tok(s)), value: [s + 2, e] as Range }] : [],
    );

  const values = new Map<string, number>();
  const types = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    const t = tok(i);
    const name = tok(i + 1);
    if (t.kind !== "id" || name.kind !== "id" || tok(i - 1).text === ".") continue;
    const next = tok(i + 2).text;
    if (t.text === "function" && !values.has(name.text)) values.set(name.text, i);
    else if ((t.text === "const" || t.text === "let" || t.text === "var") && (next === "=" || next === ":") && !values.has(name.text)) values.set(name.text, i);
    else if (((t.text === "type" && (next === "=" || next === "<")) || t.text === "interface") && !types.has(name.text)) types.set(name.text, i);
  }

  return {
    path,
    toks,
    match,
    tok,
    values,
    types,
    angleEnd,
    skipAngle,
    findTop,
    split,
    text,
    entries,
    memberEnd: (a: number, b: number) => endAt(a, b, ";,"),
    statementEnd: (a: number, b: number) => endAt(a, b, ";"),
  };
}

const PUNCTS = ["...", "===", "!==", "=>", "==", "!=", "&&", "||", "??", "?."];
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

/**
 * JavaScript and TypeScript tokens, comments dropped. `<` and `>` are always single tokens so generics nest; a quote
 * that isn't closed on its line ends there, so an apostrophe in JSX text costs one line rather than the rest of the file.
 */
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  let nl = false;
  while (i < n) {
    const c = src[i] ?? "";
    if (c === "\n") {
      nl = true;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      if (src.slice(i, stop).includes("\n")) nl = true;
      i = stop;
      continue;
    }
    const start = i;
    let kind: Tok["kind"] = "punct";
    const prev = toks.at(-1);
    if (c === '"' || c === "'") {
      i = skipQuoted(src, i);
      kind = "str";
    } else if (c === "`") {
      i = skipTemplate(src, i);
      kind = "tmpl";
    } else if (isIdStart(c)) {
      i++;
      while (i < n && isIdPart(src[i] ?? "")) i++;
      kind = "id";
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      i++;
      while (i < n && /[\w.]/.test(src[i] ?? "")) i++;
      kind = "num";
    } else if (c === "/" && (prev === undefined || (prev.kind === "punct" && !")]}<>".includes(prev.text)) || (prev.kind === "id" && REGEX_AFTER_WORD.has(prev.text))) && skipRegex(src, i) > 0) {
      i = skipRegex(src, i);
      kind = "regex";
    } else {
      const p = PUNCTS.find((x) => src.startsWith(x, i) && !(x === "?." && /[0-9]/.test(src[i + 2] ?? ""))) ?? c;
      i += p.length;
    }
    toks.push({ kind, text: src.slice(start, i), start, end: i, nl });
    nl = false;
  }
  return toks;
}

const isIdStart = (c: string) => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127;
const isIdPart = (c: string) => /[\w$]/.test(c) || c.charCodeAt(0) > 127;

function skipQuoted(src: string, i: number): number {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === q) return j + 1;
    else if (c === "\n") return j;
  }
  return src.length;
}

function skipTemplate(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "`") return j + 1;
    else if (c === "$" && src[j + 1] === "{") j = skipCode(src, j + 2) - 1;
  }
  return src.length;
}

/** Past the `}` that closes a template's `${`, skipping the strings, templates and comments inside it. */
function skipCode(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") j = skipQuoted(src, j);
    else if (c === "`") j = skipTemplate(src, j);
    else if (c === "/" && src[j + 1] === "/") j = src.indexOf("\n", j) < 0 ? src.length : src.indexOf("\n", j);
    else if (c === "/" && src[j + 1] === "*") j = src.indexOf("*/", j + 2) < 0 ? src.length : src.indexOf("*/", j + 2) + 2;
    else {
      if (c === "{") depth++;
      else if (c === "}" && depth-- === 0) return j + 1;
      j++;
    }
  }
  return src.length;
}

/** The end of a regex literal starting at `i`, or -1 when none closes on its line, so the `/` was a division. */
function skipRegex(src: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\n") return -1;
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let k = j + 1;
      while (k < src.length && isIdPart(src[k] ?? "")) k++;
      return k;
    }
  }
  return -1;
}

/** Each bracket's partner index, -1 for one left unmatched; a closer with no opener of its kind is ignored. */
function matchBrackets(toks: readonly Tok[]): Int32Array {
  const match = new Int32Array(toks.length).fill(-1);
  const stack: number[] = [];
  const pair: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };
  toks.forEach((t, i) => {
    if (t.kind !== "punct") return;
    if (t.text === "(" || t.text === "[" || t.text === "{") stack.push(i);
    else if (pair[t.text] !== undefined) {
      const at = stack.findLastIndex((o) => toks[o]?.text === pair[t.text]);
      if (at < 0) return;
      const open = stack[at] ?? -1;
      stack.length = at;
      match[open] = i;
      match[i] = open;
    }
  });
  return match;
}

/**
 * The catalog components each component renders, read from its source: the JSX tags between its declaration and the
 * next one in its file. It says why a component renders differently when only one it renders changed ("MealCard renders
 * Button"). Approximate by design: a component its source never names as a tag isn't found.
 */
export function componentUses(files: ReadonlyMap<string, string>, names: readonly string[]): Readonly<Record<string, readonly string[]>> {
  const known = new Set(names);
  const uses: Record<string, string[]> = {};
  for (const text of files.values()) {
    const declared = [...text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:function|const|let)\s+([A-Z]\w*)/g)]
      .filter((m) => known.has(m[1]!))
      .map((m) => ({ name: m[1]!, at: m.index }));
    declared.forEach((d, i) => {
      const body = text.slice(d.at, declared[i + 1]?.at ?? text.length);
      const tags = new Set([...body.matchAll(/<([A-Z]\w*)[\s/>]/g)].map((m) => m[1]!).filter((t) => known.has(t) && t !== d.name));
      if (tags.size > 0) uses[d.name] = [...new Set([...(uses[d.name] ?? []), ...tags])];
    });
  }
  return uses;
}
