import { describe, expect, it } from "vitest";
import { pageAt, pageOf, pageRest, stripFit } from "../src/renderer/stripFit";

/** Entries whose lines need `needs` px, each with no first line wider than the 180 px floor. */
const loose = (...needs: number[]) => needs.map((need) => ({ need, floor: 0 }));

describe("the history strip's fit", () => {
  it("shares the room evenly among entries that all need more than it holds", () => {
    expect(stripFit(760, loose(400, 400, 400))).toEqual({ widths: [232, 232, 232], pages: null });
  });

  it("lets an entry that needs less keep only that, so the rest read longer lines", () => {
    expect(stripFit(760, loose(200, 300, 300))).toEqual({ widths: [200, 248, 248], pages: null });
  });

  it("with room past every need, gives each entry only what it needs and leaves the rest of the strip empty", () => {
    expect(stripFit(760, loose(300, 200, 190))).toEqual({ widths: [300, 200, 190], pages: null });
    expect(stripFit(760, loose(250))).toEqual({ widths: [250], pages: null });
  });

  it("holds every entry between 180 and 380 px whatever its lines need", () => {
    expect(stripFit(1200, loose(120, 500))).toEqual({ widths: [180, 380], pages: null });
    expect(stripFit(760, loose(120, 500, 500))).toEqual({ widths: [180, 258, 258], pages: null });
  });

  it("never shares an entry below its first line, so its number, latest and age read whole", () => {
    expect(stripFit(500, [{ need: 400, floor: 230 }, { need: 400, floor: 200 }])).toEqual({ widths: [230, 222], pages: null });
  });

  it("once they overflow, pages the entries from the newest back, each sharing the strip by need", () => {
    expect(stripFit(770, loose(200, 220, 225, 280))).toEqual({ widths: [200, 220, 225, 261], pages: [0, 1] });
    expect(stripFit(770, loose(200, 220, 200, 250))).toEqual({ widths: [200, 228, 228, 250], pages: [0, 1] });
  });

  it("grows a later page that needs less than the strip from its narrowest entry, so it ends where the strip does", () => {
    expect(stripFit(462, loose(300, 300, 300, 180, 220))).toEqual({ widths: [300, 207, 207, 194, 220], pages: [0, 1, 3] });
  });

  it("keeps the oldest page at its need, and gives a lone entry the whole strip only when it can't fit beside another", () => {
    expect(stripFit(462, loose(300, 300, 300))).toEqual({ widths: [300, 207, 207], pages: [0, 1] });
    expect(stripFit(500, [{ need: 300, floor: 230 }, { need: 300, floor: 230 }])).toEqual({ widths: [300, 468], pages: [0, 1] });
  });

  it("rests at the start while nothing overflows", () => {
    const fit = stripFit(760, loose(300, 300, 300));
    expect([pageOf(fit, 2), pageRest(fit, pageOf(fit, 2))]).toEqual([0, 0]);
  });

  it("rests on the start of the page that holds an entry, so it shows that page whole", () => {
    const fit = stripFit(770, loose(200, 220, 225, 280));
    expect(fit.pages?.map((_, p) => pageRest(fit, p))).toEqual([0, 216]);
    expect([pageOf(fit, 0), pageOf(fit, 1), pageOf(fit, 3)]).toEqual([0, 1, 1]);
    expect([pageAt(fit, 0), pageAt(fit, 100), pageAt(fit, 120), pageAt(fit, 216)]).toEqual([0, 0, 1, 1]);
  });
});
