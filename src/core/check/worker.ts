import { parentPort } from "node:worker_threads";
import vm from "node:vm";
import { transform } from "sucrase";
import { ALLOWED_IMPORTS } from "./rules";

/** The React IIFE that defines globalThis.__bs, inlined by scripts/build.mjs. */
declare const __REACT_RUNTIME__: string;

export type CheckJob = { readonly source: string; readonly renders: readonly string[] };

export type RenderOutcome = { readonly ok: true; readonly html: string } | { readonly ok: false; readonly error: ThrownError };

export type ThrownError = { readonly name: string; readonly message: string };

export type CheckOutcome =
  | { readonly kind: "compile_error"; readonly message: string; readonly line: number; readonly column: number }
  | { readonly kind: "disallowed_imports"; readonly imports: readonly string[] }
  | { readonly kind: "load_error"; readonly error: ThrownError }
  | { readonly kind: "no_default_export"; readonly found: string }
  | { readonly kind: "rendered"; readonly compiled: string; readonly renders: readonly RenderOutcome[] };

// Everything a block can reach is created inside the vm, so no outer-realm function leaks in. Only strings cross.
// react-dom/server.browser needs TextEncoder and MessageChannel at import time; a synchronous render never uses them.
const PRELUDE = `
globalThis.MessageChannel = class { constructor() { this.port1 = {}; this.port2 = { postMessage() {} }; } };
globalThis.TextEncoder = class {
  encode(s = "") { const b = unescape(encodeURIComponent(s)); const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }
};
globalThis.console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
`;
const LOADER = `
globalThis.__load = function (factory) {
  const modules = { react: __bs.React, "react/jsx-runtime": __bs.JSX };
  const module = { exports: {} };
  factory(function (name) { return modules[name]; }, module, module.exports);
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

export function check(job: CheckJob): CheckOutcome {
  let compiled: string;
  try {
    compiled = transform(job.source, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  } catch (e) {
    const loc = (e as { loc?: { line: number; column: number } }).loc;
    const message = thrown(e).message.replace(/ \(\d+:\d+\)$/, "");
    return { kind: "compile_error", message, line: loc?.line ?? 1, column: (loc?.column ?? 0) + 1 };
  }

  const requested = [...compiled.matchAll(/\brequire\((["'])(.*?)\1\)/g)].map((m) => m[2] ?? "");
  const disallowed = [...new Set(requested.filter((name) => !ALLOWED_IMPORTS.includes(name)))];
  if (disallowed.length > 0) return { kind: "disallowed_imports", imports: disallowed };

  const context = vm.createContext({});
  runtime.runInContext(context);
  const load = context.__load as (factory: unknown) => unknown;
  const render = context.__render as (propsJson: string) => unknown;

  try {
    const factory = vm.runInContext(`(function (require, module, exports) {${compiled}\n})`, context, { filename: "block.tsx" });
    const found = String(load(factory));
    if (found !== "function") return { kind: "no_default_export", found };
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

parentPort?.on("message", (job: CheckJob) => parentPort?.postMessage(check(job)));
