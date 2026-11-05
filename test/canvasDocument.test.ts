import { describe, expect, test } from "vitest";
import { buildCanvasDocument } from "../src/canvas/document";
import type { BlockId, ContentHash, HostToFrame, SlotId } from "../src/core/types";

const bootOf = (html: string): unknown => {
  const match = /<script type="application\/json" id="brainstorm-boot">(.*?)<\/script>/s.exec(html);
  return match === null ? null : JSON.parse(match[1] ?? "");
};

describe("buildCanvasDocument", () => {
  test("export mode inlines the payload so the runtime can replay it without a host", () => {
    const payload: HostToFrame[] = [
      {
        kind: "modules",
        modules: [
          {
            blockId: "wheel/neon" as BlockId,
            hash: "a".repeat(64) as ContentHash,
            compiled: 'exports.default = () => "</script><script>alert(1)</script>";',
            css: ".x::after { content: '</style>' }",
          },
        ],
      },
      {
        kind: "state",
        frames: [{ slot: "wheel" as SlotId, title: "The wheel", frame: { width: 390, height: null }, blockId: "wheel/neon" as BlockId }],
        props: { "wheel/neon": { accent: "#ff2bd6" } },
        selected: null,
      },
    ];
    const html = buildCanvasDocument(payload, "export");
    expect(bootOf(html)).toEqual({ mode: "export", messages: payload });
    expect(html.match(/<\/script>/g)?.length).toBe(2);
  });

  test("live mode carries no payload; the host sends it", () => {
    expect(bootOf(buildCanvasDocument(null, "live"))).toEqual({ mode: "live", messages: [] });
  });
});
