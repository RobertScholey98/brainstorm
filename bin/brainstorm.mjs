#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const main = new URL("../dist/cli/main.js", import.meta.url);
if (!existsSync(main)) {
  process.stderr.write(`error unavailable: brainstorm is not built; run npm run build in ${fileURLToPath(new URL("..", import.meta.url))}\n`);
  process.exit(3);
}
await import(main.href);
