import { describe, expect, it } from "vitest";
import { fitFrames } from "../src/canvas/fit";

const phone = (slot: string) => ({ slot, width: 390 });
const fit = (...args: Parameters<typeof fitFrames>) => {
  const { zooms, wrap } = fitFrames(...args);
  return { zooms: Object.fromEntries([...zooms].map(([k, v]) => [k, Math.round(v * 100)])), wrap };
};

describe("the canvas fit rules", () => {
  it("leaves a stage frame that fits at full size, and zooms one wider than the room down to it", () => {
    expect(fit([phone("wheel"), { slot: "wide", width: 980 }], 806, "wheel")).toEqual({ zooms: {}, wrap: false });
    expect(fit([phone("wheel"), { slot: "wide", width: 980 }], 806, "wide")).toEqual({ zooms: { wide: 82 }, wrap: false });
  });

  it("fits a board that is a few px too wide in one row, so no third frame peeks in as a sliver", () => {
    expect(fit([phone("a"), phone("b"), phone("c")], 1086, null)).toEqual({ zooms: { a: 89, b: 89, c: 89 }, wrap: false });
  });

  it("fits two slots beside the Inspector rail at 1100, which were 48 px short at full size", () => {
    expect(fit([phone("wheel"), phone("result")], 754, null)).toEqual({ zooms: { wheel: 94, result: 94 }, wrap: false });
  });

  it("keeps a board that fits at full size", () => {
    expect(fit([phone("wheel"), phone("result")], 806, null)).toEqual({ zooms: {}, wrap: false });
  });

  it("leaves room for a scrollbar no zoom scales beside a frame with a declared height", () => {
    expect(fit([{ slot: "wheel", width: 390, gutter: 10 }, phone("result")], 814, null)).toEqual({ zooms: {}, wrap: false });
    expect(fit([{ slot: "wheel", width: 390, gutter: 10 }, phone("result")], 754, null)).toEqual({ zooms: { wheel: 92, result: 92 }, wrap: false });
    expect(fit([{ slot: "wide", width: 980, gutter: 10 }], 806, "wide")).toEqual({ zooms: { wide: 81 }, wrap: false });
  });

  it("wraps at full size once one row would need less than half size, zooming only a frame wider than the room", () => {
    expect(fit([phone("a"), phone("b"), phone("c"), phone("d")], 600, null)).toEqual({ zooms: {}, wrap: true });
    expect(fit([phone("a"), { slot: "desk", width: 1440 }, phone("c")], 500, null)).toEqual({ zooms: { desk: 35 }, wrap: true });
  });
});
