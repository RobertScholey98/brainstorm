import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseWith } from "../parse";
import { issue, type Issue, type Parsed } from "../types";
import type { Tier } from "./model";

/** Where a design system's library lives, as Brainstorm found it. Paths are absolute unless a field says otherwise. */
export type SystemSource = {
  /** The library's package folder, or the project root that holds `.brainstorm/system.json`. */
  readonly root: string;
  readonly name: string;
  /** The module whose exports are the kit, or null when Brainstorm generates it from the tier globs (ADR 008). */
  readonly entry: string | null;
  /** The library's stylesheet, or null when it ships none. */
  readonly css: string | null;
  /** Story globs, relative to `root`. */
  readonly stories: readonly string[];
  /** The export the canvas wraps every block in, as the real app wraps a page, or null. */
  readonly frame: string | null;
  /** Module specifier to a file that replaces it, for providers the canvas can't run (router, query client). */
  readonly stubs: Readonly<Record<string, string>>;
  /** `.brainstorm/system.json`, or null for a package folder synced as ADR 007 describes. Missing in older rows. */
  readonly adapter?: string | null;
  /** Globs relative to `root` for each tier's files. Empty for a package folder. */
  readonly tiers?: Readonly<Record<Tier, readonly string[]>>;
  /** Globs relative to `root`: files in the tier globs that aren't the kit, and app files the kit may import. */
  readonly exclude?: readonly string[];
  readonly shared?: readonly string[];
  /** Import prefix to an absolute folder, as tsconfig `paths` map `@/` to `src/`. */
  readonly aliases?: Readonly<Record<string, string>>;
};

export type SourceOverrides = { readonly name?: string | null; readonly frame?: string | null; readonly stubs?: Readonly<Record<string, string>> };

export const ADAPTER_FILE = ".brainstorm/system.json";
const ENTRY_GUESSES = ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx", "src/index.js", "index.js"];
const STORY_FALLBACK = ["src/**/*.stories.tsx", "src/**/*.stories.ts", "src/**/*.stories.jsx"];
export const ADAPTER_STORIES = ".brainstorm/stories/**/*.stories.@(tsx|ts|jsx)";
const NO_TIERS: Readonly<Record<Tier, readonly string[]>> = { primitive: [], composite: [], layout: [] };

/** The file an issue about the source as a whole points at. */
export const sourceFile = (s: SystemSource): string => s.entry ?? s.adapter ?? s.root;
export const tiersOf = (s: SystemSource): Readonly<Record<Tier, readonly string[]>> => s.tiers ?? NO_TIERS;

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

const globs = z.array(z.string().min(1)).default([]);

/** `.brainstorm/system.json` (ADR 008). Unknown keys are refused, so a typo can't silently drop a setting. */
const adapterShape = z.strictObject({
  $schema: z.string().optional(),
  name: z.string().min(1).optional(),
  entry: z.string().min(1).nullable().default(null),
  primitives: globs,
  composites: globs,
  layouts: globs,
  exclude: globs,
  shared: globs,
  stylesheet: z.string().min(1).nullable().default(null),
  aliases: z.record(z.string().min(1), z.string()).default({}),
  stories: z.array(z.string().min(1)).nullable().default(null),
  frame: z.string().min(1).nullable().default(null),
  stubs: z.record(z.string().min(1), z.string().min(1)).default({}),
});

export type Adapter = z.output<typeof adapterShape>;

/**
 * Finds a design system in a folder: from `.brainstorm/system.json` when the folder has one (ADR 008), else from the
 * library's package (ADR 007). A folder with neither fails with `no_system`, which the window answers with an import.
 */
export function detectSource(dir: string, overrides: SourceOverrides = {}): Parsed<SystemSource> {
  const root = path.resolve(dir);
  const fail = (message: string, code: "system_source" | "no_system" = "system_source"): Parsed<SystemSource> => ({ ok: false, issues: [issue(code, message, { file: root })] });
  if (!existsSync(root) || !statSync(root).isDirectory()) return fail(`${root} is not a folder`);
  const adapterPath = path.join(root, ADAPTER_FILE);
  if (existsSync(adapterPath)) return fromAdapter(root, adapterPath, overrides.name ?? null);
  const pkgPath = path.join(root, "package.json");
  if (!existsSync(pkgPath)) {
    return fail(`${root} has no package.json and no ${ADAPTER_FILE}; point at a library's package folder, or import the project's components with an agent`, "no_system");
  }
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
  if (entry === undefined) {
    return fail(`${root} has no library entry (package.json exports "." names none) and no ${ADAPTER_FILE}; if this is an app, import its components with an agent`, "no_system");
  }

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
      adapter: null,
      tiers: NO_TIERS,
      exclude: [],
      shared: [],
      aliases: {},
    },
    warnings,
  };
}

function fromAdapter(root: string, adapterPath: string, name: string | null): Parsed<SystemSource> {
  const fail = (issues: Issue[]): Parsed<SystemSource> => ({ ok: false, issues });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(adapterPath, "utf8"));
  } catch (e) {
    return fail([issue("invalid_adapter", `${ADAPTER_FILE} isn't JSON: ${(e as Error).message}`, { file: adapterPath })]);
  }
  const parsed = parseWith(adapterShape, raw, "invalid_adapter", { file: adapterPath });
  if (!parsed.ok) return fail(parsed.issues);
  const a = parsed.data;
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const tiers: Record<Tier, readonly string[]> = { primitive: a.primitives, composite: a.composites, layout: a.layouts };
  const tierGlobs = [...a.primitives, ...a.composites, ...a.layouts];
  if (a.entry === null && tierGlobs.length === 0) {
    issues.push(issue("invalid_adapter", 'names no components; list their files in "primitives", "composites" or "layouts", or name the library\'s "entry"', { file: adapterPath }));
  }
  const entry = a.entry === null ? null : path.resolve(root, a.entry);
  if (entry !== null && !existsSync(entry)) issues.push(issue("invalid_adapter", `"entry" ${a.entry} doesn't exist`, { file: adapterPath, pointer: "/entry" }));
  for (const [key, list] of [["primitives", a.primitives], ["composites", a.composites], ["layouts", a.layouts], ["shared", a.shared]] as const) {
    list.forEach((glob, i) => {
      if (matchFiles(root, [glob]).length === 0) warnings.push(issue("empty_glob", `"${glob}" matches no files`, { file: adapterPath, pointer: `/${key}/${i}` }));
    });
  }
  let css: string | null = null;
  if (a.stylesheet !== null) {
    css = path.resolve(root, a.stylesheet);
    if (!existsSync(css)) issues.push(issue("invalid_adapter", `"stylesheet" ${a.stylesheet} doesn't exist`, { file: adapterPath, pointer: "/stylesheet" }));
  } else {
    css = findCss(root, null, {});
    if (css === null) warnings.push(issue("system_source", 'names no "stylesheet" and none was found; the kit renders unstyled', { file: adapterPath }));
  }
  for (const [spec, file] of Object.entries(a.stubs)) {
    if (!existsSync(path.resolve(root, file))) issues.push(issue("invalid_adapter", `the stub for "${spec}", ${file}, doesn't exist`, { file: adapterPath, pointer: `/stubs/${spec}` }));
  }
  if (issues.length > 0) return fail(issues);
  return {
    ok: true,
    value: {
      root,
      name: name ?? a.name ?? path.basename(root),
      entry,
      css,
      stories: a.stories ?? [ADAPTER_STORIES, ...storyGlobs(root)],
      frame: a.frame,
      stubs: Object.fromEntries(Object.entries(a.stubs).map(([spec, file]) => [spec, path.resolve(root, file)])),
      adapter: adapterPath,
      tiers,
      exclude: a.exclude,
      shared: a.shared,
      aliases: Object.fromEntries(Object.entries(a.aliases).map(([prefix, dir]) => [prefix, path.resolve(root, dir)])),
    },
    warnings,
  };
}

/**
 * Where to run an import for a folder: the folder itself when it is a package, else the nearest folder above it that
 * is, since the adapter lives at the project's root and a components folder sits somewhere inside it.
 */
export function projectRootOf(dir: string): string {
  const start = path.resolve(dir);
  for (let d = start; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, "package.json")) || existsSync(path.join(d, ADAPTER_FILE))) return d;
    if (path.dirname(d) === d) return start;
  }
}

function findCss(root: string, exportsMap: Record<string, unknown> | null, pkg: PackageJson): string | null {
  const fromExports = Object.entries(exportsMap ?? {})
    .filter(([key]) => key.endsWith(".css"))
    .map(([, value]) => firstString(value, ["style", "default", "import"]))
    .filter((v): v is string => v !== null);
  const fromStorybook = storybookCssImports(root);
  const candidates = [...fromStorybook, ...fromExports, ...(typeof pkg.style === "string" ? [pkg.style] : []), ...shadcnCss(root), "src/styles.css", "src/index.css", "styles.css"];
  for (const c of candidates) {
    const p = path.resolve(root, c);
    if (existsSync(p)) return p;
  }
  return null;
}

/** shadcn's `components.json` names the stylesheet its components are themed by. */
function shadcnCss(root: string): string[] {
  const file = path.join(root, "components.json");
  if (!existsSync(file)) return [];
  try {
    const css = (JSON.parse(readFileSync(file, "utf8")) as { tailwind?: { css?: unknown } }).tailwind?.css;
    return typeof css === "string" && css.length > 0 ? [css] : [];
  } catch {
    return [];
  }
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

/** The folder a tier's first glob points into, such as `src/components/ui` for `src/components/ui/*.tsx`, or null. */
export function tierFolder(source: SystemSource, tier: Tier): string | null {
  const glob = tiersOf(source)[tier][0];
  if (glob === undefined) return null;
  const fixed = glob.split("/").filter((_, i, parts) => !parts.slice(0, i + 1).some((p) => /[*?{@]/.test(p)));
  return fixed.length === 0 ? "." : fixed.join("/");
}
