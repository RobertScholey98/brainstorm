import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { issue, type Issue } from "../types";
import { PRIMITIVES_SOURCE, primitivesCss } from "./primitives";
import { matchFiles, type SystemSource } from "./source";

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
  const [bundle, css] = await Promise.all([bundleKit(source, storyPaths), compileCss(source)]);
  if (!bundle.ok || !css.ok) return { ok: false, issues: [...(bundle.ok ? [] : bundle.issues), ...(css.ok ? [] : css.issues)] };
  return {
    ok: true,
    value: {
      bundle: bundle.value,
      css: css.value.css,
      storyFiles: Object.fromEntries(storyPaths.map((p) => [p, readFileSync(path.join(source.root, p), "utf8").replace(/\r\n/g, "\n")])),
      warnings: [...warnings, ...css.value.warnings],
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

async function bundleKit(source: SystemSource, storyPaths: readonly string[]): Promise<{ ok: true; value: string } | { ok: false; issues: Issue[] }> {
  const entry = [
    `import * as lib from ${JSON.stringify(toPosix(source.entry))};`,
    `import * as prims from "brainstorm:primitives";`,
    `const kit = {};`,
    `const generated = [];`,
    `for (const k of Object.keys(prims)) if (!(k in lib)) { kit[k] = prims[k]; generated.push(k); }`,
    `for (const k of Object.keys(lib)) if (k !== "default") kit[k] = lib[k];`,
    `export { kit, generated };`,
    `export const frame = ${JSON.stringify(source.frame)};`,
    `export const stories = {`,
    ...storyPaths.map((p) => `  ${JSON.stringify(p)}: () => require(${JSON.stringify(toPosix(path.join(source.root, p)))}),`),
    `};`,
  ].join("\n");

  const stubs = source.stubs;
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
    },
  };

  try {
    const result = await esbuildBuild({
      stdin: { contents: entry, resolveDir: source.root, sourcefile: "brainstorm-kit-entry.ts", loader: "ts" },
      bundle: true,
      format: "cjs",
      platform: "browser",
      target: "chrome120",
      write: false,
      minify: true,
      legalComments: "none",
      jsx: "automatic",
      external: [...KIT_EXTERNALS],
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".woff": "dataurl", ".css": "empty" },
      plugins: [plugin],
      logLevel: "silent",
    });
    const text = result.outputFiles?.[0]?.text;
    if (text === undefined) return { ok: false, issues: [issue("system_bundle_failed", "esbuild produced no output", { file: source.entry })] };
    return { ok: true, value: text };
  } catch (e) {
    const errors = (e as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors ?? [];
    const issues =
      errors.length === 0
        ? [issue("system_bundle_failed", (e as Error).message, { file: source.entry })]
        : errors.slice(0, 20).map((err) =>
            issue("system_bundle_failed", err.text, {
              file: err.location?.file ?? source.entry,
              loc: err.location ? { line: err.location.line, column: err.location.column + 1 } : null,
            }),
          );
    return { ok: false, issues };
  }
}

// --- CSS -------------------------------------------------------------------------------------------------------------

type CssResult = { ok: true; value: { css: string; warnings: Issue[] } } | { ok: false; issues: Issue[] };

async function compileCss(source: SystemSource): Promise<CssResult> {
  if (source.css === null) return { ok: true, value: { css: primitivesCss(), warnings: [] } };
  const warnings: Issue[] = [];
  const entryCss = source.css;
  try {
    const { compile } = await import("tailwindcss");
    const input = inlineUrls(readFileSync(entryCss, "utf8"), path.dirname(entryCss), warnings);
    const compiler = await compile(input, {
      base: path.dirname(entryCss),
      async loadStylesheet(id: string, base: string) {
        const file = resolveStylesheet(id, base);
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
    for (const s of [...roots, ...compiler.sources.filter((s) => !s.negated)]) scanCandidates(s.base, s.pattern, candidates);
    const css = compiler.build([...candidates]);
    return { ok: true, value: { css: `${css}\n${primitivesCss()}`, warnings } };
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
function scanCandidates(base: string, pattern: string, into: Set<string>): void {
  const start = path.resolve(base, pattern.replace(/(^|\/)\*\*.*$/, "").replace(/\/[^/]*\*.*$/, "") || ".");
  if (!existsSync(start)) return;
  const visit = (p: string) => {
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const name of readdirSync(p)) if (!SKIP.has(name)) visit(path.join(p, name));
      return;
    }
    if (!SCANNED.test(p) || s.size > 2_000_000) return;
    for (const m of readFileSync(p, "utf8").matchAll(/[^\s"'`{}()<>;,\\]+/g)) {
      const token = m[0].replace(/^[=:]+|[.:]+$/g, "");
      if (token.length > 0 && token.length < 200) into.add(token);
    }
  };
  visit(start);
}
