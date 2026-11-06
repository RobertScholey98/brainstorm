import { describe, expect, it } from "vitest";
import { readWidth } from "../src/renderer/hooks/use-pane-width";

const limits = { fallback: 280, min: 240, max: 480 };
const store = (v: string | null) => ({ getItem: () => v });

describe("readWidth", () => {
  it("reads a stored width and holds it within the limits", () => {
    expect([readWidth("inspector", limits, store("320")), readWidth("inspector", limits, store("100")), readWidth("inspector", limits, store("900"))]).toEqual([320, 240, 480]);
  });

  it("reads nothing when no usable width is stored or storage throws", () => {
    const throws = { getItem: () => { throw new Error("blocked"); } };
    expect([readWidth("inspector", limits, store(null)), readWidth("inspector", limits, store("wide")), readWidth("inspector", limits, throws), readWidth("inspector", limits, undefined)]).toEqual([null, null, null, null]);
  });
});
