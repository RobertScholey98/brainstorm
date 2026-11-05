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

export const targets = {
  "check-worker": checkWorker,
  server: nodeEntry("src/server/headless.ts", "dist/server/headless.js"),
  cli: nodeEntry("src/cli/main.ts", "dist/cli/main.js"),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  for (const name of names.length > 0 ? names : Object.keys(targets)) {
    const target = targets[name];
    if (target === undefined) throw new Error(`unknown build target ${name}; known: ${Object.keys(targets).join(", ")}`);
    await target();
  }
}
