import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// Evaluated inside the check worker's vm context, where block code renders against it.
const REACT_RUNTIME_ENTRY = `
import * as React from "react";
import * as JSX from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server.browser";
globalThis.__bs = { React, JSX, renderToStaticMarkup };
`;

async function checkWorker() {
  const runtime = await build({
    stdin: { contents: REACT_RUNTIME_ENTRY, resolveDir: root, loader: "js" },
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "error",
  });
  await build({
    entryPoints: [`${root}/src/core/check/worker.ts`],
    outfile: `${root}/dist/check/worker.cjs`,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    define: { __REACT_RUNTIME__: JSON.stringify(runtime.outputFiles[0].text) },
    logLevel: "error",
  });
}

/** The CLI and the headless server, run from the repo, so dependencies resolve from node_modules. */
const nodeEntry = (entry, out) => () =>
  build({
    entryPoints: [`${root}/${entry}`],
    outfile: `${root}/${out}`,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "external",
    logLevel: "error",
  });

/** Inlined into every canvas document, live and exported, so it carries its own React. */
const canvasRuntime = () =>
  build({
    entryPoints: [`${root}/src/canvas/runtime.tsx`],
    outfile: `${root}/dist/canvas/runtime.js`,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome130",
    jsx: "automatic",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "error",
  });

/** The app's window: Vite with React and Tailwind, configured here so there's no config file to typecheck. */
async function renderer() {
  const [{ build: viteBuild }, { default: react }, { default: tailwindcss }] = await Promise.all([
    import("vite"),
    import("@vitejs/plugin-react"),
    import("@tailwindcss/vite"),
  ]);
  await viteBuild({
    root: `${root}/src/renderer`,
    base: "/",
    configFile: false,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": `${root}/src/renderer` } },
    build: { outDir: `${root}/dist/renderer`, emptyOutDir: true, modulePreload: { polyfill: false }, chunkSizeWarningLimit: 1024 },
    logLevel: "warn",
  });
}

/** Electron loads main as CommonJS, where import.meta is empty, so the modules that find the package root get a shim. */
const electronMain = () =>
  build({
    entryPoints: [`${root}/src/electron/main.ts`],
    outfile: `${root}/dist/electron/main.cjs`,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    packages: "external",
    define: { "import.meta.url": "__import_meta_url" },
    banner: { js: 'const __import_meta_url = require("node:url").pathToFileURL(__filename).href;' },
    logLevel: "error",
  });

export const targets = {
  "check-worker": checkWorker,
  canvas: canvasRuntime,
  server: nodeEntry("src/server/headless.ts", "dist/server/headless.js"),
  cli: nodeEntry("src/cli/main.ts", "dist/cli/main.js"),
  electron: electronMain,
  renderer,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  for (const name of names.length > 0 ? names : Object.keys(targets)) {
    const target = targets[name];
    if (target === undefined) throw new Error(`unknown build target ${name}; known: ${Object.keys(targets).join(", ")}`);
    await target();
  }
}
