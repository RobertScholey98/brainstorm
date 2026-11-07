// Writes src/renderer/design.css from src/core/design.ts: npm run design:tokens
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { designStylesheet } from "../../src/core/design.ts";

const out = new URL("../../src/renderer/design.css", import.meta.url);
writeFileSync(out, designStylesheet());
console.log(`wrote ${fileURLToPath(out)}`);
