import { readFileSync } from "node:fs";
import { builtFile } from "../core/packageRoot";
import { blockIdOf, type HostToFrame, type IterationView } from "../core/types";

/** Served as a header on /canvas and repeated as a meta tag, so an exported file carries the same policy off disk. */
export const CANVAS_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'";

/**
 * `live` talks to the host over postMessage. `export` has no host: the runtime replays the payload's messages in
 * order, exactly as if the host had sent them.
 */
export type CanvasDocumentMode = "live" | "export";

export type CanvasPayload = readonly HostToFrame[];

/**
 * What a host would send for this iteration, for an export: every variant's module (so the in-page switcher can show
 * any of them), each slot's variants, and the frames on Rob's choices with every block's effective props.
 */
export function exportPayload(iteration: IterationView): CanvasPayload {
  const variants = (slot: IterationView["slots"][number]) =>
    slot.variants.flatMap((v) => iteration.blocks.filter((b) => b.id === blockIdOf(slot.id, v)).map((b) => ({ blockId: b.id, title: b.title })));
  return [
    { kind: "modules", modules: iteration.blocks.map((b) => ({ blockId: b.id, hash: b.hash, compiled: b.compiled, css: b.css })) },
    { kind: "variants", slots: Object.fromEntries(iteration.slots.map((s) => [s.id, variants(s)])) },
    {
      kind: "state",
      frames: iteration.slots.map((s) => ({ slot: s.id, title: s.title, frame: s.frame, blockId: blockIdOf(s.id, s.active) })),
      props: Object.fromEntries(iteration.blocks.map((b) => [b.id, b.effectiveProps])),
      selected: null,
    },
  ];
}

let runtime: string | null = null;

/** The HTML for /canvas (`live`, payload null) and for an export file (`export`, payload inlined). */
export function buildCanvasDocument(payload: CanvasPayload | null, mode: CanvasDocumentMode): string {
  runtime ??= readFileSync(builtFile("canvas/runtime.js"), "utf8");
  const boot = JSON.stringify({ mode, messages: payload ?? [] }).replaceAll("<", "\\u003c");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CANVAS_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Brainstorm canvas</title>",
    "</head>",
    "<body>",
    '<div id="canvas"></div>',
    `<script type="application/json" id="brainstorm-boot">${boot}</script>`,
    `<script>${runtime.replace(/<\/script/gi, "<\\/script")}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
}
