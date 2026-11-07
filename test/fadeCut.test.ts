import { describe, expect, it } from "vitest";
import { fadeCuts } from "../src/renderer/components/ui/fade-cut";

describe("a scroller's fades", () => {
  it("at rest the top shows no fade and the bottom hides 16 px, then ramps over 24, while more lies below", () => {
    expect(fadeCuts([[12, 32], [40, 60]], 0, 200, 400)).toEqual({ top: 0, topRamp: 0, bottom: 16, bottomRamp: 24 });
  });

  it("scrolled to the end the bottom shows no fade", () => {
    expect(fadeCuts([[12, 32]], 200, 200, 400)).toEqual({ top: 16, topRamp: 24, bottom: 0, bottomRamp: 0 });
  });

  it("a line the top fade would cut hides whole, and the ramp starts under it", () => {
    expect(fadeCuts([[12, 32], [44, 64], [70, 90]], 40, 200, 400)).toEqual({ top: 24, topRamp: 24, bottom: 16, bottomRamp: 24 });
  });

  it("comes in over the first 32 px of scroll, and still hides a line it reaches whole", () => {
    expect(fadeCuts([[12, 32]], 8, 200, 400)).toMatchObject({ top: 4, topRamp: 6 });
    expect(fadeCuts([[12, 32]], 10, 200, 400)).toMatchObject({ top: 22, topRamp: 7.5 });
  });

  it("a line the bottom fade would cut hides whole", () => {
    expect(fadeCuts([[170, 190]], 0, 200, 400)).toMatchObject({ bottom: 30, bottomRamp: 24 });
  });

  it("a control overlapping the line it hides goes with it", () => {
    expect(fadeCuts([[40, 60], [58, 78]], 32, 200, 400)).toMatchObject({ top: 46 });
  });
});
