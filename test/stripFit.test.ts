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

  it("gives an entry its measured need to the 1/64 px layout lands on, so a line that fits is never laid out short of it", () => {
    expect(stripFit(1000, [{ need: 233.8125, floor: 100 }, { need: 197.59375, floor: 100 }]).widths).toEqual([233.8125, 197.59375]);
    expect(stripFit(439, [{ need: 233.8125, floor: 100 }, { need: 222.25, floor: 120, link: true }]).widths[0]).toBe(233.8125);
  });
  it("holds every entry between 180 and 380 px whatever its lines need", () => {
    expect(stripFit(1200, loose(120, 500))).toEqual({ widths: [180, 380], pages: null });
    expect(stripFit(760, loose(120, 500, 500))).toEqual({ widths: [180, 258, 258], pages: null });
  });

  it("never shares an entry below its first line, so its number, latest and age read whole", () => {
    expect(stripFit(500, [{ need: 400, floor: 230 }, { need: 400, floor: 200 }])).toEqual({ widths: [230, 222], pages: null });
  });

  it("lets the shown iteration take what its lines need first, and the others share what is left", () => {
    expect(stripFit(760, [{ need: 400, floor: 0 }, { need: 400, floor: 0 }, { need: 300, floor: 0 }], 2)).toEqual({ widths: [198, 198, 300], pages: null });
  });

  it("gives a fork's tile its own floor, not an entry's, and its room last", () => {
    expect(stripFit(760, [{ need: 300, floor: 0 }, { need: 260, floor: 120, link: true }, { need: 300, floor: 0 }], 2)).toEqual({ widths: [276, 120, 300], pages: null });
  });

  it("once they overflow, pages the entries from the newest back, each page holding only entries that read whole", () => {
    expect(stripFit(770, loose(200, 220, 225, 280))).toEqual({ widths: [200, 220, 361, 361], pages: [0, 2] });
    expect(stripFit(770, loose(200, 220, 200, 250))).toEqual({ widths: [200, 228, 228, 250], pages: [0, 1] });
  });

  it("packs a fork's tile at its floor, so a forked and varied brainstorm at 1440 shows two whole entries a page, the tile no wider than its words", () => {
    const tree = [{ need: 210, floor: 150 }, { need: 240, floor: 150 }, { need: 280, floor: 150 }, { need: 250, floor: 130, link: true }, { need: 300, floor: 210 }];
    expect(stripFit(733, tree, 4)).toEqual({ widths: [210, 342.5, 342.5, 250, 435], pages: [0, 1, 3] });
  });

  it("never leaves a fork's tile on a page alone, where it would take an entry's width: it joins the iteration it hangs off", () => {
    const tree = [{ need: 210, floor: 150 }, { need: 240, floor: 150 }, { need: 280, floor: 150 }, { need: 250, floor: 130, link: true }, { need: 300, floor: 210 }];
    expect(stripFit(440, tree, 4)).toEqual({ widths: [210, 408, 262, 130, 408], pages: [0, 1, 2, 4] });
  });

  it("grows a later page that needs less than the strip from its narrowest entry, so it ends where the strip does", () => {
    expect(stripFit(462, loose(300, 300, 300, 180, 220))).toEqual({ widths: [300, 430, 430, 194, 220], pages: [0, 1, 2, 3] });
  });

  it("keeps the oldest page at its need, and gives a lone entry the whole strip only when it can't fit beside another", () => {
    expect(stripFit(462, loose(300, 300, 300))).toEqual({ widths: [300, 430, 430], pages: [0, 1, 2] });
    expect(stripFit(500, [{ need: 300, floor: 230 }, { need: 300, floor: 230 }])).toEqual({ widths: [300, 468], pages: [0, 1] });
  });

  it("rests at the start while nothing overflows", () => {
    const fit = stripFit(760, loose(300, 300, 300));
    expect([pageOf(fit, 2), pageRest(fit, pageOf(fit, 2))]).toEqual([0, 0]);
  });

  it("rests on the start of the page that holds an entry, so it shows that page whole", () => {
    const fit = stripFit(770, loose(200, 220, 225, 280));
    expect(fit.pages?.map((_, p) => pageRest(fit, p))).toEqual([0, 452]);
    expect([pageOf(fit, 0), pageOf(fit, 1), pageOf(fit, 2), pageOf(fit, 3)]).toEqual([0, 0, 1, 1]);
    expect([pageAt(fit, 0), pageAt(fit, 220), pageAt(fit, 232), pageAt(fit, 452)]).toEqual([0, 0, 1, 1]);
  });
});
