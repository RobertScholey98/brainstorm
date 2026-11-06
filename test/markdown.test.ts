import { describe, expect, test } from "vitest";
import { markdownText, parseMarkdown, withLeadLabel } from "../src/renderer/markdownSubset";

describe("the about.md markdown subset", () => {
  test("reads paragraphs, bold, italic, inline code and - lists", () => {
    const source = [
      "**Hypothesis.** A loud wheel makes the draw *a moment*.",
      "It wraps onto a second line.",
      "",
      "- Turn off `weighting`",
      "- Try _two_ people",
      "  who share a turn",
    ].join("\r\n");
    expect(parseMarkdown(source)).toEqual([
      {
        kind: "paragraph",
        inline: [
          { kind: "strong", children: [{ kind: "text", text: "Hypothesis." }] },
          { kind: "text", text: " A loud wheel makes the draw " },
          { kind: "em", children: [{ kind: "text", text: "a moment" }] },
          { kind: "text", text: ". It wraps onto a second line." },
        ],
      },
      {
        kind: "list",
        items: [
          [
            { kind: "text", text: "Turn off " },
            { kind: "code", text: "weighting" },
          ],
          [
            { kind: "text", text: "Try " },
            { kind: "em", children: [{ kind: "text", text: "two" }] },
            { kind: "text", text: " people who share a turn" },
          ],
        ],
      },
    ]);
  });

  test("leaves HTML, snake_case, unclosed and spaced markers as literal text", () => {
    expect(parseMarkdown("<b>hi</b> spin_seconds 2 * 3 and **open")).toEqual([
      { kind: "paragraph", inline: [{ kind: "text", text: "<b>hi</b> spin_seconds 2 * 3 and **open" }] },
    ]);
  });

  test("markdownText drops the markup for a tooltip", () => {
    expect(markdownText("**Tradeoff.** It takes *room*.\n\n- one\n- `two`")).toBe("Tradeoff. It takes room.\n\n- one\n- two");
  });

  test("a short lead label is bold whether or not the author wrote the asterisks", () => {
    const bold = withLeadLabel(parseMarkdown("**Hypothesis:** a loud wheel wins."));
    const plain = withLeadLabel(parseMarkdown("Hypothesis: a loud wheel wins."));
    expect(plain).toEqual([
      { kind: "paragraph", inline: [{ kind: "strong", children: [{ kind: "text", text: "Hypothesis:" }] }, { kind: "text", text: " a loud wheel wins." }] },
    ]);
    expect(bold[0]?.kind === "paragraph" && bold[0].inline[0]).toEqual({ kind: "strong", children: [{ kind: "text", text: "Hypothesis:" }] });
  });

  test("a sentence with a colon later on is not a label", () => {
    const source = "Loud and fast tests whether energy matters: it might.";
    expect(withLeadLabel(parseMarkdown(source))).toEqual(parseMarkdown(source));
  });
});
