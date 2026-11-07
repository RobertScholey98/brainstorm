import { describe, expect, it } from "vitest";
import { stripFit, stripRest } from "../src/renderer/stripFit";

/** Entries whose lines need `needs` px, each with no first line wider than the 180 px floor. */
const loose = (...needs: number[]) => needs.map((need) => ({ need, floor: 0 }));

describe("the history strip's fit", () => {
  it("shares the room evenly among entries that all need more than it holds", () => {
    expect(stripFit(760, loose(400, 400, 400))).toEqual({ widths: [232, 232, 232], shown: 3, step: null });
  });

  it("lets an entry that needs less keep only that, so the rest read longer lines", () => {
    expect(stripFit(760, loose(200, 300, 300))).toEqual({ widths: [200, 248, 248], shown: 3, step: null });
  });

  it("with room past every need, gives each entry only what it needs and leaves the rest of the strip empty", () => {
    expect(stripFit(760, loose(300, 200, 190))).toEqual({ widths: [300, 200, 190], shown: 3, step: null });
    expect(stripFit(760, loose(250))).toEqual({ widths: [250], shown: 1, step: null });
  });

  it("holds every entry between 180 and 380 px whatever its lines need", () => {
    expect(stripFit(1200, loose(120, 500))).toEqual({ widths: [180, 380], shown: 2, step: null });
    expect(stripFit(760, loose(120, 500, 500))).toEqual({ widths: [180, 258, 258], shown: 3, step: null });
  });

  it("never shares an entry below its first line, so its number, latest and age read whole", () => {
    expect(stripFit(500, [{ need: 400, floor: 230 }, { need: 400, floor: 200 }])).toEqual({ widths: [230, 222], shown: 2, step: null });
  });

  it("fills the room with a whole number of entries at one width once they overflow", () => {
    expect(stripFit(462, loose(300, 300, 300))).toEqual({ widths: [207, 207, 207], shown: 2, step: 207 });
    expect(stripFit(712, loose(1, 2, 3, 4, 5, 6))).toEqual({ widths: [216, 216, 216, 216, 216, 216], shown: 3, step: 216 });
  });

  it("overflows as soon as the first lines don't fit, at a width that holds the widest of them", () => {
    expect(stripFit(500, [{ need: 300, floor: 230 }, { need: 300, floor: 230 }])).toEqual({ widths: [468, 468], shown: 1, step: 468 });
    expect(stripFit(760, [{ need: 300, floor: 220 }, { need: 300, floor: 220 }, { need: 300, floor: 220 }, { need: 300, floor: 220 }])).toEqual({
      widths: [232, 232, 232, 232],
      shown: 3,
      step: 232,
    });
  });

  it("rests at the start while nothing overflows, whatever the scroll", () => {
    expect(stripRest(stripFit(760, loose(300, 300, 300)), 3, 2, 10)).toBe(0);
  });

  it("rests on an entry's edge, moving the least that shows the entry whole", () => {
    const fit = stripFit(462, loose(300, 300, 300, 300));
    expect(stripRest(fit, 4, 3, 0)).toBe(2 * 223);
    expect(stripRest(fit, 4, 0, 2 * 223)).toBe(0);
    expect(stripRest(fit, 4, 2, 223)).toBe(223);
    expect(stripRest(fit, 4, 1, 230)).toBe(223);
  });
});
