// Finds the string literals in a TSX file and splits Tailwind classes, for the design codemod and lint.

const CLASS_CALLS = new Set(["cn", "cva", "cx", "clsx"]);

/**
 * Every string literal and template-literal chunk in `source`, with its offsets, line, and whether it sits in a class
 * position: a className attribute or property, or the arguments of cn, cva, cx or clsx.
 * A quote with no closing partner on its line is an apostrophe in JSX text, not a string.
 */
export function literals(source) {
  const out = [];
  const stack = [];
  let line = 1;
  let i = 0;
  const inClass = () => stack.some((f) => f.cls);
  const before = (n) => source.slice(Math.max(0, n - 40), n);
  const classAttr = (n) => /\bclassName\s*[=:]\s*$/.test(before(n));

  const template = (from) => {
    let start = from;
    let j = from;
    while (j < source.length) {
      const ch = source[j];
      if (ch === "\\") {
        j += 2;
        continue;
      }
      if (ch === "\n") line++;
      if (ch === "`") {
        out.push({ start, end: j, text: source.slice(start, j), line, cls: stack.at(-1)?.templateCls ?? false });
        return j + 1;
      }
      if (ch === "$" && source[j + 1] === "{") {
        out.push({ start, end: j, text: source.slice(start, j), line, cls: stack.at(-1)?.templateCls ?? false });
        stack.push({ ch: "${", cls: false, resume: true });
        return j + 2;
      }
      j++;
    }
    return j;
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "\n") {
      line++;
      i++;
    } else if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let k = i; k < stop; k++) if (source[k] === "\n") line++;
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      if (source[j] === ch) {
        out.push({ start: i + 1, end: j, text: source.slice(i + 1, j), line, cls: inClass() || classAttr(i) });
        i = j + 1;
      } else {
        i++;
      }
    } else if (ch === "`") {
      const cls = inClass() || classAttr(i);
      stack.push({ ch: "`", cls, templateCls: cls, template: true });
      i = template(i + 1);
      if (source[i - 1] === "`") stack.pop();
    } else if (ch === "(" || ch === "[" || ch === "{") {
      const word = /([A-Za-z_$][\w$]*)\s*$/.exec(before(i))?.[1];
      const cls = (ch === "(" && CLASS_CALLS.has(word)) || (ch === "{" && classAttr(i));
      stack.push({ ch, cls });
      i++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      const frame = stack.pop();
      i++;
      if (frame?.resume) i = template(i);
      if (frame?.resume && source[i - 1] === "`") stack.pop();
    } else {
      i++;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Splits `md:hover:!-mt-2` into its variants, `!`, `-` and the utility, ignoring colons inside brackets. */
export function splitClass(token) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) cut = i;
  }
  const variants = token.slice(0, cut + 1);
  let utility = token.slice(cut + 1);
  let important = "";
  if (utility.startsWith("!")) {
    important = "!";
    utility = utility.slice(1);
  } else if (utility.endsWith("!")) {
    important = "!";
    utility = utility.slice(0, -1);
  }
  const negative = utility.startsWith("-") ? "-" : "";
  return { variants, important, negative, utility: utility.slice(negative.length) };
}

export const joinClass = ({ variants, important, negative, utility }) => `${variants}${negative}${utility}${important}`;

/** The index just past the closing quote or backtick that `i` opens, or `i + 1` when a quote has no partner on its line. */
function skipString(source, i) {
  const q = source[i];
  let j = i + 1;
  while (j < source.length && source[j] !== q) {
    if (q !== "`" && source[j] === "\n") return i + 1;
    j += source[j] === "\\" ? 2 : 1;
  }
  return j + 1;
}

/** The index just past the brace that closes the one at `i`. */
function skipBraces(source, i) {
  let depth = 0;
  let j = i;
  while (j < source.length) {
    const ch = source[j];
    if (ch === '"' || ch === "'" || ch === "`") {
      j = skipString(source, j);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return j + 1;
    j++;
  }
  return j;
}

/**
 * Every JSX opening tag in `source`: its name, line, and attributes with the offsets of their values. A `<` counts as
 * a tag only after a character that can't end an expression, so `useState<Id>` and `a < b` are skipped.
 */
export function jsxElements(source) {
  const out = [];
  const lineAt = (n) => source.slice(0, n).split("\n").length;
  const re = /<([A-Za-z][\w.]*)/g;
  for (let m; (m = re.exec(source)) !== null; ) {
    const prev = source.slice(0, m.index).trimEnd().at(-1) ?? "";
    if (/[\w)\]]/.test(prev)) continue;
    const attrs = [];
    let i = m.index + m[0].length;
    while (i < source.length) {
      const ch = source[i];
      if (/\s/.test(ch)) i++;
      else if (ch === ">" || (ch === "/" && source[i + 1] === ">")) break;
      else if (ch === "{") i = skipBraces(source, i);
      else {
        const name = /^[\w:-]+/.exec(source.slice(i))?.[0];
        if (name === undefined) break;
        const at = i;
        i += name.length;
        if (source[i] !== "=") {
          attrs.push({ name, line: lineAt(at), start: i, end: i });
          continue;
        }
        const start = i + 1;
        i = source[start] === "{" ? skipBraces(source, start) : skipString(source, start);
        attrs.push({ name, line: lineAt(at), start, end: i });
      }
    }
    out.push({ tag: m[1], line: lineAt(m.index), start: m.index, end: i, attrs });
  }
  return out;
}

/** Local names imported from the shadcn kit, `@/components/ui/<file>`. */
export function kitImports(source) {
  const names = new Set();
  for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/components\/ui\/[\w-]+["']/g)) {
    for (const part of m[1].split(",")) {
      const local = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}
