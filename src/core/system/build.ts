import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { issue, type Issue } from "../types";
import { PRIMITIVES_SOURCE, primitivesCss } from "./primitives";
import type { Tier } from "./model";
import { globToRegExp, matchFiles, sourceFile, tiersOf, type SystemSource } from "./source";

/**
 * Builds a design system from its source: one CommonJS bundle of the kit and its stories, and its stylesheet. Both run
 * on pure JavaScript and WebAssembly (esbuild-wasm and Tailwind's own `compile`), so an installed app needs no native
 * binary for the OS and CPU it runs on.
 */
export type BuiltSystem = {
  readonly bundle: string;
  readonly css: string;
  /** Each story file's source, keyed by its path relative to the library's root, for the agent to read. */
  readonly storyFiles: Readonly<Record<string, string>>;
  /** Every file the build read, absolute: what esbuild bundled, the stylesheets, and the files scanned for classes. */
  readonly inputs: readonly string[];
  readonly warnings: readonly Issue[];
};

export type BuildResult = { readonly ok: true; readonly value: BuiltSystem } | { readonly ok: false; readonly issues: readonly Issue[] };

/** What the canvas supplies to the kit; the bundle requires them at run time. */
export const KIT_EXTERNALS = ["react", "react-dom", "react/jsx-runtime", "react-dom/client"] as const;

const STORYBOOK_STUB = `
const noop = () => {};
const chain = () => new Proxy(function () {}, { get: () => chain(), apply: () => chain() });
const fn = (impl) => { const f = (...args) => (impl ? impl(...args) : undefined); f.mockName = () => f; f.mockReturnValue = () => f; f.mockImplementation = () => f; return f; };
module.exports = { expect: chain, fn, spyOn: () => fn(), userEvent: chain(), within: () => chain(), waitFor: async () => {}, screen: chain(), action: () => noop, definePreview: (p) => p };
`;

const ASSET_TYPES: Readonly<Record<string, string>> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const toPosix = (p: string) => p.split(path.sep).join("/");

export async function buildSystem(source: SystemSource): Promise<BuildResult> {
  const storyPaths = matchFiles(source.root, source.stories);
  const warnings: Issue[] = [];
  if (storyPaths.length === 0) {
    warnings.push(issue("no_story", `no stories match ${source.stories.join(", ")}; the catalog will list exports with no examples`, { file: source.root }));
  }
  const kitFiles = tierFiles(source);
  if (source.entry === null && kitFiles.length === 0) {
    return { ok: false, issues: [issue("invalid_adapter", "the tier globs match no component files", { file: sourceFile(source) })] };
  }
  const [bundle, css] = await Promise.all([bundleKit(source, storyPaths, kitFiles), compileCss(source)]);
  if (!bundle.ok || !css.ok) return { ok: false, issues: [...(bundle.ok ? [] : bundle.issues), ...(css.ok ? [] : css.issues)] };
  const own = [source.adapter, path.join(source.root, "package.json")].filter((f): f is string => typeof f === "string" && existsSync(f));
  return {
    ok: true,
    value: {
      bundle: bundle.value.text,
      css: css.value.css,
      storyFiles: Object.fromEntries(storyPaths.map((p) => [p, readFileSync(path.join(source.root, p), "utf8").replace(/\r\n/g, "\n")])),
      inputs: [...new Set([...bundle.value.inputs, ...css.value.inputs, ...own])].sort(),
      warnings: [...warnings, ...css.value.warnings, ...bundle.value.boundary],
    },
  };
}

type Esbuild = typeof import("esbuild-wasm");
type BuildOptions = Parameters<Esbuild["build"]>[0];
let esbuildModule: Promise<Esbuild> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/**
 * esbuild-wasm on Windows fails a build that starts while another is in flight ("the working directory is not an
 * absolute path"), so every build waits for the one before it.
 */
function esbuildBuild(options: BuildOptions): ReturnType<Esbuild["build"]> {
  const run = queue.then(async () => (await (esbuildModule ??= import("esbuild-wasm"))).build(options));
  queue = run.catch(() => undefined);
  return run as ReturnType<Esbuild["build"]>;
}

/** A tier glob's files: the kit's components, minus `exclude`, stories and tests. Relative to the root, POSIX. */
export type KitFile = { readonly file: string; readonly tier: Tier };

const NOT_A_COMPONENT = /\.(stories|test|spec)\.[jt]sx?$|\.d\.ts$/;

export function tierFiles(source: SystemSource): KitFile[] {
  const tiers = tiersOf(source);
  const exclude = (source.exclude ?? []).map(globToRegExp);
  const seen = new Set<string>();
  const out: KitFile[] = [];
  for (const tier of ["primitive", "composite", "layout"] as const) {
    for (const file of matchFiles(source.root, tiers[tier])) {
      if (seen.has(file) || NOT_A_COMPONENT.test(file) || !/\.[jt]sx?$/.test(file) || exclude.some((r) => r.test(file))) continue;
      seen.add(file);
      out.push({ file, tier });
    }
  }
  return out;
}

/** `page-header.tsx` → `PageHeader`: the name a file's default export joins the kit under. */
const defaultName = (file: string) =>
  (file.split("/").at(-1) ?? file)
    .replace(/\.[jt]sx?$/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join("");

/**
 * The module the bundle starts from. It gathers the kit from the library's entry, or from the tier files when an
 * adapter lists them (ADR 008), adds the primitives the kit lacks, and labels each export with the tier of the file
 * that exports it. Labels go by identity, so a library entry that re-exports a tier file's component gets its tier.
 */
function entryModule(source: SystemSource, storyPaths: readonly string[], kitFiles: readonly KitFile[]): string {
  const abs = (rel: string) => JSON.stringify(toPosix(path.join(source.root, rel)));
  return [
    source.entry === null ? "" : `import * as entry from ${JSON.stringify(toPosix(source.entry))};`,
    `import * as prims from "brainstorm:primitives";`,
    ...kitFiles.map((f, i) => `import * as m${i} from ${abs(f.file)};`),
    `const tierModules = [${kitFiles.map((f, i) => `[m${i}, ${JSON.stringify(f.tier)}, ${JSON.stringify(f.file)}, ${JSON.stringify(defaultName(f.file))}]`).join(", ")}];`,
    `const duplicates = [];`,
    source.entry !== null
      ? `const lib = entry;`
      : [
          `const lib = {};`,
          `for (const [m, , file, fallback] of tierModules) {`,
          `  for (const k of Object.keys(m)) {`,
          `    if (k === "default") continue;`,
          `    if (k in lib) { if (lib[k] !== m[k]) duplicates.push(k + " (" + file + ")"); continue; }`,
          `    lib[k] = m[k];`,
          `  }`,
          `  const d = m.default;`,
          `  if ((typeof d === "function" || (typeof d === "object" && d !== null)) && !Object.values(lib).includes(d) && !(fallback in lib)) lib[fallback] = d;`,
          `}`,
        ].join("\n"),
    `const kit = {};`,
    `const generated = [];`,
    `for (const k of Object.keys(prims)) if (!(k in lib)) { kit[k] = prims[k]; generated.push(k); }`,
    `for (const k of Object.keys(lib)) if (k !== "default") kit[k] = lib[k];`,
    `const tiers = {};`,
    `for (const k of Object.keys(kit)) for (const [m, tier] of tierModules) if (Object.values(m).includes(kit[k])) { tiers[k] = tier; break; }`,
    `export { kit, generated, tiers, duplicates };`,
    `export const frame = ${JSON.stringify(source.frame)};`,
    `export const stories = {`,
    ...storyPaths.map((p) => `  ${JSON.stringify(p)}: () => require(${abs(p)}),`),
    `};`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

type Bundled = { readonly text: string; readonly inputs: readonly string[]; readonly boundary: readonly Issue[] };

async function bundleKit(source: SystemSource, storyPaths: readonly string[], kitFiles: readonly KitFile[]): Promise<{ ok: true; value: Bundled } | { ok: false; issues: Issue[] }> {
  const entry = entryModule(source, storyPaths, kitFiles);
  const stubs = source.stubs;
  const aliases = Object.entries(source.aliases ?? {}).sort((a, b) => b[0].length - a[0].length);
  const plugin = {
    name: "brainstorm",
    setup(build: import("esbuild-wasm").PluginBuild) {
      build.onResolve({ filter: /^brainstorm:primitives$/ }, () => ({ path: "primitives", namespace: "brainstorm" }));
      build.onLoad({ filter: /^primitives$/, namespace: "brainstorm" }, () => ({ contents: PRIMITIVES_SOURCE, loader: "jsx" as const }));
      build.onResolve({ filter: /^(storybook|storybook\/.*|@storybook\/.*)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: STORYBOOK_STUB, loader: "js" as const }));
      for (const [spec, file] of Object.entries(stubs)) {
        const filter = new RegExp(`^${spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`);
        build.onResolve({ filter }, () => ({ path: file }));
      }
      // The app's tsconfig `paths`, as the adapter gives them: `@/lib/utils` is `<root>/src/renderer/lib/utils`.
      for (const [prefix, dir] of aliases) {
        const filter = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
        build.onResolve({ filter }, async (a) => {
          if (a.pluginData === "aliased") return undefined;
          const target = path.join(dir, a.path.slice(prefix.length));
          const found = await build.resolve(toPosix(target), { kind: a.kind, resolveDir: a.resolveDir, importer: a.importer, pluginData: "aliased" });
          return found.errors.length > 0 ? { errors: found.errors } : { path: found.path, namespace: found.namespace };
        });
      }
    },
  };

  try {
    const result = await esbuildBuild({
      stdin: { contents: entry, resolveDir: source.root, sourcefile: "brainstorm-kit-entry.ts", loader: "ts" },
      absWorkingDir: source.root,
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: "chrome120",
      write: false,
      minify: true,
      metafile: true,
      legalComments: "none",
      jsx: "automatic",
      external: [...KIT_EXTERNALS],
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".woff": "dataurl", ".css": "empty" },
      plugins: [plugin],
      logLevel: "silent",
    });
    const text = result.outputFiles?.[0]?.text;
    if (text === undefined) return { ok: false, issues: [issue("system_bundle_failed", "esbuild produced no output", { file: sourceFile(source) })] };
    const graph = inputGraph(source.root, result.metafile?.inputs ?? {});
    return { ok: true, value: { text, inputs: [...graph.keys()], boundary: source.adapter == null ? [] : boundaryIssues(source, kitFiles, storyPaths, graph) } };
  } catch (e) {
    const errors = (e as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors ?? [];
    const issues =
      errors.length === 0
        ? [issue("system_bundle_failed", (e as Error).message, { file: sourceFile(source) })]
        : errors.slice(0, 20).map((err) =>
            issue("system_bundle_failed", err.text, {
              file: err.location?.file ?? sourceFile(source),
              loc: err.location ? { line: err.location.line, column: err.location.column + 1 } : null,
            }),
          );
    return { ok: false, issues };
  }
}

/** The metafile's real files, absolute, each with the real files it imports. Virtual modules are left out. */
function inputGraph(root: string, inputs: Record<string, { imports: readonly { path: string; external?: boolean }[] }>): Map<string, string[]> {
  // `<stdin>`, `<define:…>` and plugin namespaces such as `stub:storybook` are no files; externals are the canvas's.
  const real = (p: string) => !p.startsWith("<") && !/^[a-z-]+:/.test(p);
  const graph = new Map<string, string[]>();
  for (const [key, input] of Object.entries(inputs)) {
    if (!real(key)) continue;
    graph.set(
      path.resolve(root, key),
      input.imports.filter((i) => i.external !== true && real(i.path)).map((i) => path.resolve(root, i.path)),
    );
  }
  return graph;
}

/**
 * Imports that cross out of the system (ADR 008): from a kit file, a shared file or the entry's folder, to a project
 * file that is none of those, a story or a stub. Each is reported once, with the first file that imports it.
 */
function boundaryIssues(source: SystemSource, kitFiles: readonly KitFile[], storyPaths: readonly string[], graph: ReadonlyMap<string, readonly string[]>): Issue[] {
  const rel = (abs: string) => toPosix(path.relative(source.root, abs));
  const kit = new Set(kitFiles.map((f) => f.file));
  const shared = (source.shared ?? []).map(globToRegExp);
  const stories = new Set(storyPaths);
  const stubs = new Set(Object.values(source.stubs).map((f) => path.resolve(f)));
  const entryDir = source.entry === null ? null : path.dirname(source.entry);
  const inside = (abs: string) => {
    const r = rel(abs);
    return kit.has(r) || shared.some((g) => g.test(r)) || (entryDir !== null && !path.relative(entryDir, abs).startsWith(".."));
  };
  const external = (abs: string) => /[\\/]node_modules[\\/]/.test(abs);
  const issues: Issue[] = [];
  const reported = new Set<string>();
  for (const [from, imports] of graph) {
    if (external(from) || !inside(from)) continue;
    for (const to of imports) {
      if (reported.has(to) || external(to) || inside(to) || stories.has(rel(to)) || stubs.has(path.resolve(to))) continue;
      reported.add(to);
      issues.push(
        issue(
          "outside_boundary",
          `${rel(from)} imports ${rel(to)}, which isn't in the system; exclude ${rel(from)}, stub what it reads, or list ${rel(to)} in "shared" if it is a helper the kit needs`,
          { file: from },
        ),
      );
    }
  }
  return issues;
}

// --- CSS -------------------------------------------------------------------------------------------------------------

type CssResult = { ok: true; value: { css: string; inputs: string[]; warnings: Issue[] } } | { ok: false; issues: Issue[] };

async function compileCss(source: SystemSource): Promise<CssResult> {
  if (source.css === null) return { ok: true, value: { css: primitivesCss(), inputs: [], warnings: [] } };
  const warnings: Issue[] = [];
  const entryCss = source.css;
  const inputs = [entryCss];
  try {
    const { compile } = await import("tailwindcss");
    const input = inlineUrls(readFileSync(entryCss, "utf8"), path.dirname(entryCss), warnings);
    const compiler = await compile(input, {
      base: path.dirname(entryCss),
      async loadStylesheet(id: string, base: string) {
        const file = resolveStylesheet(id, base);
        inputs.push(file);
        return { path: file, base: path.dirname(file), content: inlineUrls(readFileSync(file, "utf8"), path.dirname(file), warnings) };
      },
      async loadModule(id: string, base: string) {
        const file = resolveModuleFile(id, base);
        // Tailwind validates what the module exports; Brainstorm only loads it.
        return { path: file, base: path.dirname(file), module: (await loadPluginModule(file)) as never };
      },
    });
    const candidates = new Set<string>();
    const roots =
      compiler.root === "none"
        ? []
        : compiler.root === null
          ? [{ base: path.dirname(entryCss), pattern: "**/*" }]
          : [compiler.root];
    for (const s of [...roots, ...compiler.sources.filter((s) => !s.negated)]) scanCandidates(s.base, s.pattern, candidates, inputs);
    const css = compiler.build([...candidates]);
    return { ok: true, value: { css: `${css}\n${primitivesCss()}`, inputs, warnings } };
  } catch (e) {
    return { ok: false, issues: [issue("system_css_failed", (e as Error).message, { file: entryCss })] };
  }
}

function findPackage(name: string, from: string): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

function splitSpecifier(id: string): { name: string; sub: string } {
  const parts = id.split("/");
  const n = id.startsWith("@") ? 2 : 1;
  return { name: parts.slice(0, n).join("/"), sub: parts.slice(n).join("/") };
}

function pickExport(value: unknown, conditions: readonly string[]): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  for (const c of conditions) {
    const found = pickExport((value as Record<string, unknown>)[c], conditions);
    if (found !== null) return found;
  }
  return null;
}

/** Resolves `@import "tailwindcss"` or `"./theme.css"` the way Tailwind's own tooling does, preferring `style` exports. */
function resolveStylesheet(id: string, base: string): string {
  if (id.startsWith(".") || path.isAbsolute(id)) {
    const p = path.resolve(base, id);
    return existsSync(p) ? p : `${p}.css`;
  }
  const { name, sub } = splitSpecifier(id);
  const dir = findPackage(name, base);
  if (dir === null) throw new Error(`can't find the stylesheet package "${name}" from ${base}; install the library's dependencies first`);
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { exports?: unknown; style?: unknown };
  const key = sub === "" ? "." : `./${sub}`;
  const exportsMap = typeof pkg.exports === "object" && pkg.exports !== null ? (pkg.exports as Record<string, unknown>) : null;
  const target =
    pickExport(exportsMap?.[key] ?? (sub === "" && exportsMap !== null && !("." in exportsMap) ? pkg.exports : undefined), ["style", "import", "default"]) ??
    (sub !== "" ? `./${sub}` : typeof pkg.style === "string" ? pkg.style : "./index.css");
  const file = path.join(dir, target);
  return existsSync(file) ? file : `${file}.css`;
}

function resolveModuleFile(id: string, base: string): string {
  if (id.startsWith(".") || path.isAbsolute(id)) {
    const p = path.resolve(base, id);
    for (const candidate of [p, `${p}.ts`, `${p}.js`, `${p}.mjs`, `${p}.cjs`]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    return p;
  }
  return createRequire(path.join(base, "noop.js")).resolve(id);
}

/**
 * A Tailwind plugin or config, which may be TypeScript and may import workspace packages that are TypeScript too: all of
 * it is bundled with esbuild except Tailwind itself, then run with the library's own `require`.
 */
async function loadPluginModule(file: string): Promise<unknown> {
  const result = await esbuildBuild({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    external: ["tailwindcss", "tailwindcss/*"],
    logLevel: "silent",
  });
  const module = { exports: {} as Record<string, unknown> };
  const run = new Function("require", "module", "exports", "__filename", "__dirname", result.outputFiles?.[0]?.text ?? "");
  run(createRequire(file), module, module.exports, file, path.dirname(file));
  return module.exports.default ?? module.exports;
}

/**
 * The canvas allows fonts and images only as `data:` URLs, so a stylesheet's local `url()`s are inlined. A remote one
 * is left for the policy to block, with a warning.
 */
function inlineUrls(css: string, dir: string, warnings: Issue[]): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _q: string, ref: string) => {
    if (ref.startsWith("data:") || ref.startsWith("#")) return whole;
    if (/^(https?:)?\/\//.test(ref)) {
      warnings.push(issue("remote_url", `${ref} is remote; the canvas has no network, so it won't load`, { file: dir }));
      return whole;
    }
    const file = path.resolve(dir, ref.split(/[?#]/)[0] ?? ref);
    const type = ASSET_TYPES[path.extname(file).toLowerCase()];
    if (type === undefined || !existsSync(file)) return whole;
    return `url("data:${type};base64,${readFileSync(file).toString("base64")}")`;
  });
}

const SCANNED = /\.(tsx?|jsx?|mjs|cjs|html|mdx|vue|svelte|astro)$/;
const SKIP = new Set(["node_modules", ".git", "dist", "build", "storybook-static", ".turbo"]);

/** Collects every word that could be a class. Tailwind ignores the ones that aren't, as its own scanner does. */
function scanCandidates(base: string, pattern: string, into: Set<string>, files: string[]): void {
  const start = path.resolve(base, pattern.replace(/(^|\/)\*\*.*$/, "").replace(/\/[^/]*\*.*$/, "") || ".");
  if (!existsSync(start)) return;
  const visit = (p: string) => {
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const name of readdirSync(p)) if (!SKIP.has(name)) visit(path.join(p, name));
      return;
    }
    if (!SCANNED.test(p) || s.size > 2_000_000) return;
    files.push(p);
    const text = readFileSync(p, "utf8");
    // Classes such as `py-(--card-spacing)` and `[--gap:--spacing(4)]` hold parentheses and commas, so words split
    // only at quotes and whitespace count, and so do their pieces between parentheses for words like `cn(base`.
    // Inside square brackets nothing but whitespace splits, since `has-[>svg]:px-3` and
    // `*:[svg:not([class*='size-'])]:size-4` hold `>` and quotes there.
    for (const separators of [`'{}<>;\\`, `'{}()<>;,\\`]) {
      for (const word of bracketWords(text, separators)) {
        const token = word.replace(/^[=:]+|[.:]+$/g, "");
        if (token.length > 0 && token.length < 200) into.add(token);
      }
    }
  };
  visit(start);
}

/** Splits text into words at whitespace, `"` and backticks, and at `separators` outside square brackets. */
function* bracketWords(text: string, separators: string): Generator<string> {
  let word = "";
  let depth = 0;
  for (const c of text) {
    const breaks = /[\s"`]/.test(c) || (depth === 0 && separators.includes(c));
    if (breaks) {
      if (word !== "") yield word;
      word = "";
      depth = 0;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && depth > 0) depth--;
    word += c;
  }
  if (word !== "") yield word;
}
