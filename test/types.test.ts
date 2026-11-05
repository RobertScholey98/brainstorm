import { describe, expect, test } from "vitest";
import { issue, parseBlockId, parseIterationN, parsePropName, parseSessionId, parseThreadId } from "../src/core/types";

describe("id parsers", () => {
  test("a block id is two kebab-case segments", () => {
    expect(parseBlockId("wheel/neon-2")).toBe("wheel/neon-2");
    expect(parseBlockId("Wheel/neon")).toBe(null);
    expect(parseBlockId("wheel")).toBe(null);
    expect(parseBlockId("wheel/neon/extra")).toBe(null);
    expect(parseBlockId("wheel/")).toBe(null);
  });

  test("prop names are camelCase identifiers", () => {
    expect(parsePropName("spinSeconds")).toBe("spinSeconds");
    expect(parsePropName("SpinSeconds")).toBe(null);
    expect(parsePropName("spin-seconds")).toBe(null);
  });

  test("session, thread and iteration ids", () => {
    expect(parseSessionId("s_8f2k3a")).toBe("s_8f2k3a");
    expect(parseSessionId("8f2k3a")).toBe(null);
    expect(parseThreadId("8ee90f34-1111-2222-3333-444455556666")).toBe("8ee90f34-1111-2222-3333-444455556666");
    expect(parseThreadId("mcp:833a9162-66b6-45ad-b0e4-305ca0d76671")).toBe("mcp:833a9162-66b6-45ad-b0e4-305ca0d76671");
    expect(parseThreadId("mcp:833a9162 &calc")).toBe(null);
    expect(parseThreadId("not-a-thread")).toBe(null);
    expect(parseIterationN(3)).toBe(3);
    expect(parseIterationN(0)).toBe(null);
    expect(parseIterationN(1.5)).toBe(null);
  });
});

test("an issue takes its severity from its code", () => {
  expect(issue("duplicate_part", "twice", { file: "slots/a/b/block.tsx" })).toEqual({
    severity: "warning",
    code: "duplicate_part",
    file: "slots/a/b/block.tsx",
    loc: null,
    pointer: null,
    message: "twice",
  });
  expect(issue("compile_error", "bad", { loc: { line: 2, column: 4 } }).severity).toBe("error");
});
