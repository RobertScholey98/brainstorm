import { describe, expect, it } from "vitest";
import type { BlockId, BlockView, FeedbackId, PropName } from "../src/core/types";
import { failedTitle } from "../src/renderer/notice";
import { accent } from "./fixtures";

const block = { id: "wheel/neon" as BlockId, props: { data: [], appearance: [accent] } } as unknown as BlockView;

describe("failedTitle", () => {
  it("names a setting by the label its control shows, and a comment by its number", () => {
    expect(failedTitle({ kind: "set_override", blockId: block.id, prop: "accent" as PropName, value: "#00f0ff" }, [block])).toBe("Couldn't save Accent");
    expect(failedTitle({ kind: "clear_override", blockId: block.id, prop: "accent" as PropName }, [block])).toBe("Couldn't reset Accent");
    expect(failedTitle({ kind: "confirm_feedback", id: 2 as FeedbackId })).toBe("Couldn't confirm comment 2");
  });

  it("falls back to a plain name for a setting it can't find", () => {
    expect(failedTitle({ kind: "set_override", blockId: block.id, prop: "glow" as PropName, value: 4 }, [block])).toBe("Couldn't save the setting");
  });

  it("names the steps outside a brainstorm's actions", () => {
    expect(["export", "list", "load", "settle", "unsettle", "discard", "fork", "history"].map((a) => failedTitle(a as "export"))).toEqual([
      "Couldn't export the brainstorm",
      "Couldn't refresh the brainstorms",
      "Couldn't load the brainstorm",
      "Couldn't settle the brainstorm",
      "Couldn't bring the brainstorm back",
      "Couldn't discard the fork",
      "Couldn't fork the brainstorm",
      "Couldn't open that iteration",
    ]);
    expect(failedTitle({ kind: "vary", target: { blockId: block.id, part: null }, count: 3, direction: null })).toBe("Couldn't send the vary request");
  });
});
