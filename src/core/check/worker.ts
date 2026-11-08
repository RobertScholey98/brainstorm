import { parentPort } from "node:worker_threads";
import vm from "node:vm";
import { transform } from "sucrase";

/** The React IIFE that defines globalThis.__bs and globalThis.__story, inlined by scripts/build.mjs. */
declare const __REACT_RUNTIME__: string;

/** A design system's bundle, which a block in its session imports as `kit`. `hash` keys the worker's cached sandbox. */
export type KitRef = { readonly hash: string; readonly bundle: string };

export type CheckJob = {
  readonly kind: "check";
  readonly source: string;
  readonly renders: readonly string[];
  /** Module specifiers the source may import. */
  readonly allowed: readonly string[];
  readonly kit: KitRef | null;
  /** Proposed components' sources, by import specifier (`proposed/ChoreList`), for blocks that import them. */
  readonly proposed: Readonly<Record<string, string>>;
};

/** Loads a kit, lists its exports and server-renders every story. */
export type InspectJob = { readonly kind: "inspect"; readonly kit: KitRef };

export type WorkerJob = CheckJob | InspectJob;

export type RenderOutcome = { readonly ok: true; readonly html: string } | { readonly ok: false; readonly error: ThrownError };

export type ThrownError = { readonly name: string; readonly message: string };

export type CheckOutcome =
  | { readonly kind: "compile_error"; readonly message: string; readonly line: number; readonly column: number }
  | { readonly kind: "disallowed_imports"; readonly imports: readonly string[] }
  | { readonly kind: "load_error"; readonly error: ThrownError }
  | { readonly kind: "no_default_export"; readonly found: string }
  | { readonly kind: "rendered"; readonly compiled: string; readonly renders: readonly RenderOutcome[] };

export type KitExport = { readonly name: string; readonly type: "component" | "function" | "value" };

export type StoryProbe = {
  readonly id: string;
  readonly file: string;
  readonly exportName: string;
  readonly title: string;
  readonly name: string;
  /** The kit export the story's meta names as its component, or null. */
  readonly component: string | null;
  /** JSON of the story's args, with functions and elements described. */
  readonly args: string;
  readonly html: string | null;
  readonly error: string | null;
  /** Storybook `tags` from the story and its meta. */
  readonly tags: readonly string[];
  /** JSON of the story's `argTypes`, reduced to controls the workbench draws. */
  readonly argTypes: string;
};

export type InspectOutcome =
  | { readonly kind: "load_error"; readonly error: ThrownError }
  | {
      readonly kind: "inspected";
      readonly exports: readonly KitExport[];
      readonly generated: readonly string[];
      readonly frame: string | null;
      readonly stories: readonly StoryProbe[];
      readonly failed: readonly { readonly file: string; readonly message: string }[];
      /** Export name to the tier of the file that exports it (ADR 008); exports from no tier file are absent. */
      readonly tiers: Readonly<Record<string, string>>;
      /** Names two tier files export as different things, as `Name (file)`. */
      readonly duplicates: readonly string[];
    };

export type WorkerOutcome = CheckOutcome | InspectOutcome;

// Everything a block can reach is created inside the vm, so no outer-realm function leaks in. Only strings cross.
// react-dom/server.browser needs TextEncoder and MessageChannel at import time; a synchronous render never uses them.
// Timers do nothing: a render never waits for one, and a library that schedules one at load mustn't keep it alive.
const PRELUDE = `
globalThis.MessageChannel = class { constructor() { this.port1 = {}; this.port2 = { postMessage() {} }; } };
globalThis.TextEncoder = class {
  encode(s = "") { const b = unescape(encodeURIComponent(s)); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
};
globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
globalThis.setInterval = function () { return 0; };
globalThis.clearInterval = function () {};
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.cancelAnimationFrame = function () {};
globalThis.queueMicrotask = function (f) { Promise.resolve().then(f); };
`;
const LOADER = `
globalThis.__extra = {};
globalThis.__require = function (name) {
  if (name === "react") return __bs.React;
  if (name === "react/jsx-runtime") return __bs.JSX;
  if (name === "react-dom") return __bs.ReactDOM;
  if (name === "kit" && globalThis.__kitModule) return __kitModule.kit;
  if (Object.prototype.hasOwnProperty.call(__extra, name)) return __extra[name]();
  throw new Error('cannot import "' + name + '"');
};
globalThis.__define = function (name, factory) {
  let exports = null;
  __extra[name] = function () {
    if (exports !== null) return exports;
    const module = { exports: {} };
    exports = module.exports;
    factory(__require, module, module.exports);
    exports = module.exports;
    return exports;
  };
};
globalThis.__load = function (factory) {
  const module = { exports: {} };
  factory(__require, module, module.exports);
  globalThis.__component = module.exports.default;
  return __component === undefined ? "no default export" : typeof __component;
};
globalThis.__render = function (propsJson) {
  return __bs.renderToStaticMarkup(__bs.React.createElement(__component, JSON.parse(propsJson)));
};
`;
const runtime = new vm.Script(PRELUDE + __REACT_RUNTIME__ + LOADER, { filename: "react-runtime.js" });

const thrown = (e: unknown): ThrownError =>
  typeof e === "object" && e !== null && "message" in e
    ? { name: String((e as { name?: unknown }).name ?? "Error"), message: String(e.message) }
    : { name: "Error", message: String(e) };

const compile = (source: string) =>
  transform(source, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;

/** One sandbox per kit, kept while jobs keep naming it, since evaluating a kit's bundle is the slow part. */
let kitContext: { hash: string; context: vm.Context } | null = null;

function contextFor(kit: KitRef | null): vm.Context {
  if (kit !== null && kitContext?.hash === kit.hash) {
    vm.runInContext("globalThis.__extra = {}; globalThis.__component = undefined;", kitContext.context);
    return kitContext.context;
  }
  const context = vm.createContext({});
  runtime.runInContext(context);
  if (kit === null) return context;
  const factory = vm.runInContext(`(function (require, module, exports) {${kit.bundle}\n})`, context, { filename: "kit.js" });
  const install = vm.runInContext(
    "(function (factory) { const module = { exports: {} }; factory(__require, module, module.exports); globalThis.__kitModule = module.exports; })",
    context,
  ) as (f: unknown) => void;
  install(factory);
  kitContext = { hash: kit.hash, context };
  return context;
}

export function check(job: CheckJob): CheckOutcome {
  let compiled: string;
  try {
    compiled = compile(job.source);
  } catch (e) {
    const loc = (e as { loc?: { line: number; column: number } }).loc;
    const message = thrown(e).message.replace(/ \(\d+:\d+\)$/, "");
    return { kind: "compile_error", message, line: loc?.line ?? 1, column: (loc?.column ?? 0) + 1 };
  }

  const requested = [...compiled.matchAll(/\brequire\((["'])(.*?)\1\)/g)].map((m) => m[2] ?? "");
  const disallowed = [...new Set(requested.filter((name) => !job.allowed.includes(name)))];
  if (disallowed.length > 0) return { kind: "disallowed_imports", imports: disallowed };

  let context: vm.Context;
  try {
    context = contextFor(job.kit);
    for (const [name, source] of Object.entries(job.proposed)) {
      const factory = vm.runInContext(`(function (require, module, exports) {${compile(source)}\n})`, context, { filename: `${name}.tsx` });
      (vm.runInContext("__define", context) as (n: string, f: unknown) => void)(name, factory);
    }
  } catch (e) {
    return { kind: "load_error", error: thrown(e) };
  }
  const load = context.__load as (factory: unknown) => unknown;
  const render = context.__render as (propsJson: string) => unknown;

  try {
    const factory = vm.runInContext(`(function (require, module, exports) {${compiled}\n})`, context, { filename: "block.tsx" });
    const found = String(load(factory));
    if (found !== "function" && found !== "object") return { kind: "no_default_export", found };
  } catch (e) {
    return { kind: "load_error", error: thrown(e) };
  }

  const renders = job.renders.map((propsJson): RenderOutcome => {
    try {
      return { ok: true, html: String(render(propsJson)) };
    } catch (e) {
      return { ok: false, error: thrown(e) };
    }
  });
  return { kind: "rendered", compiled, renders };
}

const INSPECT = `(function () {
  const k = __kitModule;
  const names = Object.keys(k.kit);
  const kind = (v) => (typeof v === "object" && v !== null && v.$$typeof ? "component" : typeof v === "function" ? "function" : "value");
  const exportsList = names.map((name) => ({ name, type: kind(k.kit[name]) === "function" && /^[A-Z]/.test(name) ? "component" : kind(k.kit[name]) }));
  const listed = __story.listStories(k.stories || {});
  const stories = listed.stories.map((s) => {
    let component = null;
    for (const n of names) if (k.kit[n] === s.meta.component) { component = n; break; }
    let html = null, error = null;
    try { html = __bs.renderToStaticMarkup(__story.storyElement(__bs.React, s)); } catch (e) { error = String((e && e.message) || e); }
    let args = "{}";
    try { args = JSON.stringify(__story.describeArgs(__story.storyArgs(s))); } catch (e) {}
    let argTypes = "{}";
    try { argTypes = JSON.stringify(__story.storyArgTypes(s)); } catch (e) {}
    const tags = __story.storyTags(s);
    return { id: s.id, file: s.file, exportName: s.exportName, title: s.title, name: s.name, component, args, html, error, tags, argTypes };
  });
  return JSON.stringify({ exports: exportsList, generated: k.generated || [], frame: k.frame || null, stories, failed: listed.failed, tiers: k.tiers || {}, duplicates: k.duplicates || [] });
})()`;

export function inspect(job: InspectJob): InspectOutcome {
  try {
    const context = contextFor(job.kit);
    const parsed = JSON.parse(String(vm.runInContext(INSPECT, context))) as Omit<Extract<InspectOutcome, { kind: "inspected" }>, "kind">;
    return { kind: "inspected", ...parsed };
  } catch (e) {
    return { kind: "load_error", error: thrown(e) };
  }
}

parentPort?.on("message", (job: WorkerJob) => parentPort?.postMessage(job.kind === "inspect" ? inspect(job) : check(job)));
