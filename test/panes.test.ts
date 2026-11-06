import { describe, expect, it } from "vitest";
import { CANVAS_MIN, fitPanes } from "../src/renderer/hooks/use-pane-width";

const mins = { sidebar: 200, inspector: 240 };

describe("fitPanes", () => {
  it("keeps the widths Rob left when the window has room for them", () => {
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 1440 + 100)).toEqual({ sidebar: 400, inspector: 480 });
  });

  it("narrows the Inspector first, then the sidebar, so the canvas keeps its minimum", () => {
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 1440)).toEqual({ sidebar: 400, inspector: 480 - (400 + 480 + CANVAS_MIN - 1440) });
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 1100)).toEqual({ sidebar: 300, inspector: 240 });
  });

  it("stops at each pane's minimum", () => {
    expect(fitPanes({ sidebar: 400, inspector: 480 }, mins, 800)).toEqual({ sidebar: 200, inspector: 240 });
  });
});
