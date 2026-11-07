import { describe, expect, it } from "vitest";
import { stripFit, stripRest } from "../src/renderer/stripFit";

describe("the history strip's fit", () => {
  it("shares the room among entries that fit, up to 380 px each", () => {
    expect(stripFit(760, 3)).toEqual({ width: 232, shown: 3, overflows: false });
    expect(stripFit(760, 1)).toEqual({ width: 380, shown: 1, overflows: false });
  });

  it("fills the room with a whole number of entries once they overflow", () => {
    expect(stripFit(462, 3)).toEqual({ width: 207, shown: 2, overflows: true });
    expect(stripFit(462, 7)).toEqual({ width: 207, shown: 2, overflows: true });
    expect(stripFit(712, 6)).toEqual({ width: 216, shown: 3, overflows: true });
  });

  it("rests at the start while nothing overflows, whatever the scroll", () => {
    expect(stripRest(stripFit(760, 3), 3, 2, 10)).toBe(0);
  });

  it("rests on an entry's edge, moving the least that shows the entry whole", () => {
    const fit = stripFit(462, 4);
    expect(stripRest(fit, 4, 3, 0)).toBe(2 * 223);
    expect(stripRest(fit, 4, 0, 2 * 223)).toBe(0);
    expect(stripRest(fit, 4, 2, 223)).toBe(223);
    expect(stripRest(fit, 4, 1, 230)).toBe(223);
  });
});
