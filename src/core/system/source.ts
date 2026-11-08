import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { issue, type Issue, type Parsed } from "../types";

/** Where a design system's library lives, as Brainstorm found it in the package folder. Paths are absolute. */
export type SystemSource = {
  /** The library's package folder. */
  readonly root: string;
  readonly name: string;
  /** The module whose exports are the kit. */
  readonly entry: string;
  /** The library's stylesheet, or null when it ships none. */
  readonly css: string | null;
  /** Story globs, relative to `root`. */
  readonly stories: readonly string[];
  /** The export the canvas wraps every block in, as the real app wraps a page, or null. */
  readonly frame: string | null;
  /** Module specifier to a file that replaces it, for providers the canvas can't run (router, query client). */
  readonly stubs: Readonly<Record<string, string>>;
};

export type SourceOverrides = { readonly name?: string | null; readonly frame?: string | null; readonly stubs?: Readonly<Record<string, string>> };

const ENTRY_GUESSES = ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx", "src/index.js", "index.js"];
const STORY_FALLBACK = ["src/**/*.stories.tsx", "src/**/*.stories.ts", "src/**/*.stories.jsx"];

type PackageJson = { name?: unknown; exports?: unknown; main?: unknown; module?: unknown; style?: unknown };

const firstString = (value: unknown, prefer: readonly string[]): string | null => {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of prefer) {
    const found = firstString(record[key], prefer);
    if (found !== null) return found;
  }
  return null;
};

/** Finds a library's entry, stylesheet and stories from its package folder (ADR 007). */
export function detectSource(dir: string, overrides: SourceOverrides = {}): Parsed<SystemSource> {
  const root = path.resolve(dir);
  const fail = (message: string): Parsed<SystemSource> => ({ ok: false, issues: [issue("system_source", message, { file: root })] });
  if (!existsSync(root) || !statSync(root).isDirectory()) return fail(`${root} is not a folder`);
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) return fail(`${root} has no package.json; point at the library's package folder`);
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  } catch (e) {
    return fail(`package.json isn't JSON: ${(e as Error).message}`);
  }

  const exportsMap = typeof pkg.exports === "object" && pkg.exports !== null && !Array.isArray(pkg.exports) ? (pkg.exports as Record<string, unknown>) : null;
  const dotExport = exportsMap === null ? pkg.exports : (exportsMap["."] ?? null);
  const entryCandidates = [
    firstString(dotExport, ["source", "import", "default", "module", "require"]),
    typeof pkg.module === "string" ? pkg.module : null,
    typeof pkg.main === "string" ? pkg.main : null,
    ...ENTRY_GUESSES,
  ].filter((e): e is string => e !== null && /\.(tsx?|jsx?|mjs)$/.test(e));
  const entry = entryCandidates.map((e) => path.resolve(root, e)).find((e) => existsSync(e));
  if (entry === undefined) return fail(`couldn't find the library's entry; package.json exports "." should name its index file`);

  const warnings: Issue[] = [];
  const css = findCss(root, exportsMap, pkg);
  if (css === null) warnings.push(issue("system_source", "found no stylesheet; the kit renders unstyled unless its components bring their own CSS", { file: pkgPath }));
  const stories = storyGlobs(root);

  return {
    ok: true,
    value: {
      root,
      name: overrides.name ?? (typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : path.basename(root)),
      entry,
      css,
      stories,
      frame: overrides.frame ?? null,
      stubs: Object.fromEntries(Object.entries(overrides.stubs ?? {}).map(([spec, file]) => [spec, path.resolve(root, file)])),
    },
    warnings,
  };
}

function findCss(root: string, exportsMap: Record<string, unknown> | null, pkg: PackageJson): string | null {
  const fromExports = Object.entries(exportsMap ?? {})
    .filter(([key]) => key.endsWith(".css"))
    .map(([, value]) => firstString(value, ["style", "default", "import"]))
    .filter((v): v is string => v !== null);
  const fromStorybook = storybookCssImports(root);
  const candidates = [...fromStorybook, ...fromExports, ...(typeof pkg.style === "string" ? [pkg.style] : []), "src/styles.css", "src/index.css", "styles.css"];
  for (const c of candidates) {
    const p = path.resolve(root, c);
    if (existsSync(p)) return p;
  }
  return null;
}

/** `.storybook/preview.*` imports the stylesheet stories render with, so it's the most reliable pointer. */
function storybookCssImports(root: string): string[] {
  const dir = path.join(root, ".storybook");
  if (!existsSync(dir)) return [];
  const preview = readdirSync(dir).find((f) => /^preview\.(tsx?|jsx?|mjs)$/.test(f));
  if (preview === undefined) return [];
  const text = readFileSync(path.join(dir, preview), "utf8");
  return [...text.matchAll(/import\s+["']([^"']+\.css)["']/g)].map((m) => path.relative(root, path.resolve(dir, m[1] ?? "")));
}

function storyGlobs(root: string): string[] {
  const dir = path.join(root, ".storybook");
  const main = existsSync(dir) ? readdirSync(dir).find((f) => /^main\.(tsx?|jsx?|mjs|cjs)$/.test(f)) : undefined;
  if (main !== undefined) {
    const text = readFileSync(path.join(dir, main), "utf8");
    const block = /stories\s*:\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? "";
    const globs = [...block.matchAll(/["'`]([^"'`]+)["'`]/g)]
      .map((m) => m[1] ?? "")
      .filter((g) => !g.endsWith(".mdx"))
      .map((g) => path.relative(root, path.resolve(dir, g)).split(path.sep).join("/"));
    if (globs.length > 0) return globs;
  }
  return STORY_FALLBACK;
}

/** A small glob: `**`, `*`, `?`, `{a,b}` and Storybook's `@(a|b)`. */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] as string;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      out += `(?:${glob.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
      i = end;
    } else if (c === "@" && glob[i + 1] === "(") {
      const end = glob.indexOf(")", i);
      out += `(?:${glob.slice(i + 2, end).split("|").map(escapeRe).join("|")})`;
      i = end;
    } else out += escapeRe(c);
  }
  return new RegExp(`^${out}$`);
}

const escapeRe = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "storybook-static", ".turbo"]);

/** Files under `root` matching any glob, as POSIX paths relative to `root`, sorted. */
export function matchFiles(root: string, globs: readonly string[]): string[] {
  const patterns = globs.map(globToRegExp);
  const found: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const abs = path.join(dir, name);
      const r = rel === "" ? name : `${rel}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (patterns.some((p) => p.test(r))) found.push(r);
    }
  };
  walk(root, "");
  return found.sort();
}
