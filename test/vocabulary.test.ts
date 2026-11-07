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
  { pattern: /Restart Brainstorm, then try again/, say: "If it happens again, restart Brainstorm: the copy sits over a Try again button" },
  { pattern: /matches the search/, say: "the search's own words: Nothing here has “zebra” in its title or brief" },
  { pattern: /heading={`Fork iteration/, say: "the Fork button's own label, so button and popover share one name in both states" },
  { pattern: /. Everything else stays./, say: "<context> · <clause>, the one grammar a popover description takes" },
  { pattern: /Fork of/, say: "from … · iteration N, the one wording for a fork's lineage on the card, the row, the stub and the parent's tile" },
  { pattern: /Try again, and if it still fails/, say: "If it happens again, restart Brainstorm: the same copy shows in a toast, which has no Try again button" },
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
