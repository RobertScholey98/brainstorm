import { describe, expect, it } from "vitest";
import { CANVAS_MIN, fitPanes } from "../src/renderer/hooks/use-pane-width";

const mins = { sidebar: 200, inspector: 240 };

describe("fitPanes", () => {
  it("keeps the widths Rob left when the window has room for them", () => {
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 1440 + 100)).toEqual({ sidebar: 400, inspector: 480 });
  });

  it("narrows both panes in proportion to their room above their minimums, so the canvas keeps its minimum", () => {
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 1400)).toEqual({ sidebar: 381, inspector: 458 });
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 1100)).toEqual({ sidebar: 245, inspector: 294 });
  });

  it("keeps the Inspector clear of its floor at 1100 when the sidebar comes from a wide window", () => {
    const { sidebar, inspector } = fitPanes({ sidebar: 288, inspector: 280 }, { sidebar: 240, inspector: 240 }, 1100);
    expect([sidebar, inspector, sidebar + inspector + CANVAS_MIN <= 1100]).toEqual([272, 267, true]);
  });

  it("stops at each pane's minimum", () => {
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 800)).toEqual({ sidebar: 200, inspector: 240 });
  });
});
