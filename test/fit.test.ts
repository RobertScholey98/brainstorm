import { describe, expect, it } from "vitest";
import { fitFrames } from "../src/canvas/fit";

const phone = (slot: string) => ({ slot, width: 390 });
const fit = (...args: Parameters<typeof fitFrames>) => Object.fromEntries([...fitFrames(...args)].map(([k, v]) => [k, Math.round(v * 100)]));

describe("the canvas fit rules", () => {
  it("leaves a stage frame that fits at full size, and zooms one wider than the room down to it", () => {
    expect(fit([phone("wheel"), { slot: "wide", width: 980 }], 806, "wheel")).toEqual({});
    expect(fit([phone("wheel"), { slot: "wide", width: 980 }], 806, "wide")).toEqual({ wide: 82 });
  });

  it("fits a board that is a few px too wide in one row, so no third frame peeks in as a sliver", () => {
    expect(fit([phone("a"), phone("b"), phone("c")], 1086, null)).toEqual({ a: 89, b: 89, c: 89 });
  });

  it("fits two slots beside the Inspector rail at 1100, which were 48 px short at full size", () => {
    expect(fit([phone("wheel"), phone("result")], 754, null)).toEqual({ wheel: 94, result: 94 });
  });

  it("keeps a board that fits at full size", () => {
    expect(fit([phone("wheel"), phone("result")], 806, null)).toEqual({});
  });

  it("leaves room for a scrollbar no zoom scales beside a frame with a declared height", () => {
    expect(fit([{ slot: "wheel", width: 390, gutter: 10 }, phone("result")], 814, null)).toEqual({});
    expect(fit([{ slot: "wheel", width: 390, gutter: 10 }, phone("result")], 754, null)).toEqual({ wheel: 92, result: 92 });
    expect(fit([{ slot: "wide", width: 980, gutter: 10 }], 806, "wide")).toEqual({ wide: 81 });
  });

  it("fits three phone slots side by side at the minimum window beside the Inspector, at 41%", () => {
    expect(fit([phone("wheel"), phone("result"), phone("history")], 524, null)).toEqual({ wheel: 41, result: 41, history: 41 });
  });

  it("never wraps, however small one row makes the board: the stage is where a frame is read", () => {
    expect(fit([phone("a"), phone("b"), phone("c"), phone("d")], 600, null)).toEqual({ a: 34, b: 34, c: 34, d: 34 });
    expect(fit([phone("a"), { slot: "desk", width: 1440 }, phone("c")], 500, null)).toEqual({ a: 20, desk: 20, c: 20 });
  });
});
