import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Names the UI retired so each concept has one, with the name that replaced each. */
const RETIRED: readonly { readonly pattern: RegExp; readonly say: string }[] = [
  { pattern: /adjustment/i, say: "setting" },
  { pattern: /just now/i, say: "now" },
  { pattern: />\s*Overview\s*</, say: "All brainstorms, the heading the page and Back already use" },
  { pattern: /\b(?:min|days?|hours?|h) ago\b|\byesterday\b/i, say: "an age from time.ts, which every surface writes one way: 5m, 3h, 2d" },
  { pattern: /toLocale(?:Date)?String/, say: "age from time.ts, whose months are all three letters" },
  { pattern: /No iterations yet|agent's first commit/, say: "WAITING from Preview.tsx, the one name for a brainstorm with no iteration" },
];

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe("UI vocabulary", () => {
  it("names each concept one way across the renderer", () => {
    const found = sources("src/renderer").flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return RETIRED.filter(({ pattern }) => pattern.test(text)).map(({ pattern, say }) => `${file}: ${pattern}, say ${say}`);
    });
    expect(found).toEqual([]);
  });
});
