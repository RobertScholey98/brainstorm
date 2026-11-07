import { describe, expect, test } from "vitest";
import { markdownText } from "../src/renderer/markdownSubset";

describe("a brief's markdown, read as plain text", () => {
  test("drops bold, italic and inline code, and joins wrapped lines", () => {
    const source = ["# Spin for chores", "", "**Give** one chore an owner, *fairly*.", "It wraps onto a second line.", "", "- Turn off `weighting`", "- Try _two_ people", "  who share a turn"].join("\r\n");
    expect(markdownText(source)).toBe(
      "# Spin for chores\n\nGive one chore an owner, fairly. It wraps onto a second line.\n\n- Turn off weighting\n- Try two people who share a turn",
    );
  });

  test("leaves HTML, snake_case, unclosed and spaced markers as literal text", () => {
    expect(markdownText("<b>hi</b> spin_seconds 2 * 3 and **open")).toBe("<b>hi</b> spin_seconds 2 * 3 and **open");
  });
});
