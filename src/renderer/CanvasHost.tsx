import { useEffect, useRef, useState } from "react";
import type { BlockId, BlockView, CanvasFrame, FrameToHost, HostToFrame, Props } from "../core/types";

/**
 * The host side of the frame protocol. The frame's origin is `null`, so messages are matched by `event.source`, and
 * every `ready` resends the modules and state, which recovers a reloaded frame.
 */
export function CanvasHost({
  blocks,
  frames,
  props,
  selected,
  onSelect,
  onBlockError,
}: {
  blocks: readonly BlockView[];
  frames: readonly CanvasFrame[];
  props: Readonly<Record<string, Props>>;
  selected: BlockId | null;
  onSelect: (blockId: BlockId) => void;
  onBlockError: (blockId: BlockId, message: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef(new Set<string>());
  const [readyCount, setReadyCount] = useState(0);
  const handlers = useRef({ onSelect, onBlockError });
  handlers.current = { onSelect, onBlockError };

  const post = (message: HostToFrame) => frame.current?.contentWindow?.postMessage(message, "*");

  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (frame.current === null || e.source !== frame.current.contentWindow) return;
      const message = e.data as FrameToHost;
      switch (message.kind) {
        case "ready":
          sent.current.clear();
          setReadyCount((n) => n + 1);
          return;
        case "select_block":
          handlers.current.onSelect(message.blockId);
          return;
        case "block_error":
          handlers.current.onBlockError(message.blockId, message.message);
          return;
        case "csp_violation":
          console.warn(`The canvas blocked ${message.blockedUri || "a resource"} (${message.directive}).`);
          return;
        default:
          return;
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    if (readyCount === 0) return;
    const fresh = blocks.filter((b) => !sent.current.has(`${b.id}@${b.hash}`));
    if (fresh.length === 0) return;
    post({ kind: "modules", modules: fresh.map((b) => ({ blockId: b.id, hash: b.hash, compiled: b.compiled, css: b.css })) });
    for (const b of fresh) sent.current.add(`${b.id}@${b.hash}`);
  }, [readyCount, blocks]);

  useEffect(() => {
    if (readyCount > 0) post({ kind: "state", frames, props, selected });
  }, [readyCount, frames, props, selected]);

  return <iframe ref={frame} title="Canvas" src="/canvas" sandbox="allow-scripts" className="block size-full border-0" />;
}
