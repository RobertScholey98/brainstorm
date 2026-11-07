import { afterAll, describe, expect, test } from "vitest";
import { createChecker } from "../src/core/check";
import type { BlockId, ContentHash, FileMap, Override, PropName } from "../src/core/types";
import { parseWorkingCopy } from "../src/core/workingCopy";
import { wheelProps } from "./fixtures";

const checker = createChecker({ size: 2 });
afterAll(() => checker.close());

const wheelTsx = `import { useState } from "react";
type Person = { name: string };
export default function Wheel({ people, accent, showOdds }: { people: Person[]; accent: string; showOdds: boolean }) {
  const [spinning, setSpinning] = useState(false);
  return (
    <div className="wheel" style={{ "--accent": accent } as React.CSSProperties}>
      {people.map((p) => <span key={p.name} data-part={\`slice-\${p.name}\`}>{p.name}</span>)}
      {showOdds && <small data-part="odds">50/50</small>}
      <button data-part="spin-button" onClick={() => setSpinning(true)}>{spinning ? "…" : "Spin"}</button>
    </div>
  );
}
`;

/** Parses real working-copy files so every draft is exactly what a commit would check. */
function drafts(blocks: Record<string, string>) {
  const files: Record<string, string> = {
    "brainstorm.json": JSON.stringify({ format: 1, session: "s_8f2k3a", base: null, slots: [{ id: "wheel", title: "Wheel" }] }),
  };
  for (const [variant, tsx] of Object.entries(blocks)) {
    files[`slots/wheel/${variant}/block.tsx`] = tsx;
    files[`slots/wheel/${variant}/block.json`] = JSON.stringify({ title: "Wheel", props: wheelProps });
  }
  const parsed = parseWorkingCopy(files as FileMap);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value.blocks;
}

async function checkOne(tsx: string, overrides: Override[] = []) {
  const [block] = drafts({ neon: tsx });
  if (block === undefined) throw new Error("no block");
  const results = await checker.checkBlocks([block], new Map([[block.id, overrides]]));
  return results.get(block.hash);
}

const error = (code: string, message: string, loc: { line: number; column: number } | null = null) => ({
  severity: "error",
  code,
  file: "slots/wheel/neon/block.tsx",
  loc,
  pointer: null,
  message,
});

const override = (prop: string, value: string | number | boolean): Override => ({
  blockId: "wheel/neon" as BlockId,
  prop: prop as PropName,
  value,
  setAt: "2026-11-05T10:00:00Z",
});

describe("checkBlocks", () => {
  test("a good block compiles and lists its data-parts from the default render", async () => {
    const result = await checkOne(wheelTsx);
    expect(result?.kind).toBe("ok");
    if (result?.kind !== "ok") return;
    expect(result.parts).toEqual(["slice-Kai", "slice-Roz", "odds", "spin-button"]);
    expect(result.warnings).toEqual([]);
    expect(result.compiled).toContain("require('react')");
    expect(result.compiled).not.toContain("type Person");
  });

  test("a block that throws during render is an error naming the component and message", async () => {
    const tsx = `export default function Wheel({ people }) {\n  throw new Error("no people today");\n}\n`;
    expect(await checkOne(tsx)).toEqual({
      kind: "failed",
      issues: [error("render_error", "Wheel threw with default props: no people today")],
    });
  });

  test("an endless render times out, the worker is replaced, and the next check still runs", { timeout: 15_000 }, async () => {
    const started = Date.now();
    const tsx = `export default function Spinner() {\n  while (true) {}\n}\n`;
    expect(await checkOne(tsx)).toEqual({
      kind: "failed",
      issues: [error("render_timeout", "Spinner did not finish loading and rendering within 3 s; look for a loop that never ends")],
    });
    expect(Date.now() - started).toBeLessThan(6000);
    expect((await checkOne(wheelTsx))?.kind).toBe("ok");
  });

  test("an import outside react is rejected at its line and column", async () => {
    const tsx = `import { useState } from "react";\nimport confetti from "canvas-confetti";\nexport default function Wheel() {\n  confetti();\n  return <div data-part="x" />;\n}\n`;
    expect(await checkOne(tsx)).toEqual({
      kind: "failed",
      issues: [
        error("disallowed_import", 'imports "canvas-confetti"; blocks may import only react and react/jsx-runtime', {
          line: 2,
          column: 22,
        }),
      ],
    });
  });

  test("a syntax error reports sucrase's message at a 1-based line and column", async () => {
    const tsx = `export default function Wheel() {\n  return (\n    <div>{1 +}</div>\n  );\n}\n`;
    expect(await checkOne(tsx)).toEqual({
      kind: "failed",
      issues: [error("compile_error", 'Unexpected token, expected ","', { line: 3, column: 14 })],
    });
  });

  test("reading document during render is an error, while touching it in an effect is fine", async () => {
    const reads = `export default function Wheel() {\n  return <h1 data-part="title">{document.title}</h1>;\n}\n`;
    expect(await checkOne(reads)).toEqual({
      kind: "failed",
      issues: [
        error(
          "browser_global",
          "Wheel reads `document` with default props; there is no document during render, so move it into an effect",
        ),
      ],
    });
    const inEffect = `import { useEffect } from "react";\nexport default function Wheel() {\n  useEffect(() => { document.title = "Wheel"; }, []);\n  return <h1 data-part="title">{typeof window === "undefined" ? "server" : "browser"}</h1>;\n}\n`;
    const result = await checkOne(inEffect);
    expect(result?.kind === "ok" ? result.parts : result).toEqual(["title"]);
  });

  test("renders again with Rob's applicable overrides and reports a throw there", async () => {
    const tsx = `export default function Wheel({ accent, density }) {\n  if (accent === "#000000") throw new Error("black is unreadable");\n  return <div data-part="w">{density}</div>;\n}\n`;
    expect(await checkOne(tsx, [override("accent", "#000000"), override("density", "huge")])).toEqual({
      kind: "failed",
      issues: [error("render_error", "Wheel threw with Rob's overrides on wheel/neon (accent): black is unreadable")],
    });
  });

  test("a module that throws while loading, or has no default export, is an error", async () => {
    expect(await checkOne(`const x = window.innerWidth;\nexport default function Wheel() { return null; }\n`)).toEqual({
      kind: "failed",
      issues: [
        error(
          "browser_global",
          "Wheel reads `window` while loading the module; there is no window during render, so move it into an effect",
        ),
      ],
    });
    expect(await checkOne(`export const Wheel = () => <div />;\n`)).toEqual({
      kind: "failed",
      issues: [error("no_default_export", "block.tsx must default-export a function component; found no default export")],
    });
  });

  test("a duplicate data-part is a warning, not an error", async () => {
    const tsx = `export default function Wheel() {\n  return <ul><li data-part="row">a</li><li data-part="row">b</li></ul>;\n}\n`;
    expect(await checkOne(tsx)).toEqual({
      kind: "ok",
      compiled: expect.any(String),
      parts: ["row"],
      warnings: [
        {
          severity: "warning",
          code: "duplicate_part",
          file: "slots/wheel/neon/block.tsx",
          loc: null,
          pointer: null,
          message: 'data-part "row" appears more than once in one render; pins need each part to be unique',
        },
      ],
    });
  });

  test("blocks with identical content are checked once and share a result", async () => {
    const blocks = drafts({ a: wheelTsx, b: wheelTsx, c: `export default () => <p data-part="c" />;\n` });
    const results = await checker.checkBlocks(blocks, new Map());
    const [a, b, c] = blocks.map((block) => block.hash);
    expect(a).toBe(b);
    expect([...results.keys()]).toEqual([a, c] as ContentHash[]);
    expect([...results.values()].map((r) => (r.kind === "ok" ? r.parts : r.issues))).toEqual([
      ["slice-Kai", "slice-Roz", "odds", "spin-button"],
      ["c"],
    ]);
  });

  test("block code cannot reach the worker's process through anything it is handed", async () => {
    const tsx = `import { useState } from "react";
export default function Probe() {
  const reach = (f) => f.constructor.constructor("return typeof process")();
  return <p data-part={[reach(require), reach(useState), reach(console.log), reach(TextEncoder)].join("-")} />;
}
`;
    const result = await checkOne(tsx);
    expect(result?.kind === "ok" ? result.parts : result).toEqual(["undefined-undefined-undefined-undefined"]);
  });
});
