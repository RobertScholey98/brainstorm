import { useEffect, useRef, useState } from "react";
import type { BlockId, BlockView, CanvasFrame, CanvasMode, CanvasPin, CanvasRect, FeedbackId, FrameToHost, HostToFrame, Pin, Props, SlotId } from "../core/types";

export type Placement = { readonly placed: ReadonlySet<FeedbackId>; readonly detached: ReadonlySet<FeedbackId> };

/**
 * The host side of the frame protocol. The frame's origin is `null`, so messages are matched by `event.source`, and
 * every `ready` resends the modules and state, which recovers a reloaded frame.
 */
export function CanvasHost({
  blocks,
  frames,
  props,
  selected,
  stage,
  mode,
  pins,
  focused,
  hovered,
  pulse,
  onSelect,
  onBlockError,
  onPicked,
  onPinClicked,
  onPlacement,
  onZooms,
}: {
  blocks: readonly BlockView[];
  frames: readonly CanvasFrame[];
  props: Readonly<Record<string, Props>>;
  selected: BlockId | null;
  /** The slot on the stage, or null for the board. */
  stage: SlotId | null;
  mode: CanvasMode;
  pins: readonly CanvasPin[];
  /** The pin whose feedback row is open in the Inspector. */
  focused: FeedbackId | null;
  /** The pin whose feedback row is under the pointer, echoed on the canvas. */
  hovered: FeedbackId | null;
  /** A new `seq` pulses the pin again, even the same one. */
  pulse: { readonly id: FeedbackId; readonly seq: number } | null;
  onSelect: (blockId: BlockId) => void;
  onBlockError: (blockId: BlockId, message: string) => void;
  onPicked: (pin: Pin, at: { x: number; y: number }, rect: CanvasRect) => void;
  onPinClicked: (id: FeedbackId) => void;
  onPlacement: (placement: Placement) => void;
  onZooms: (zooms: Readonly<Record<string, number>>) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sent = useRef(new Set<string>());
  const [readyCount, setReadyCount] = useState(0);
  const handlers = useRef({ onSelect, onBlockError, onPicked, onPinClicked, onPlacement, onZooms });
  handlers.current = { onSelect, onBlockError, onPicked, onPinClicked, onPlacement, onZooms };

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
        case "picked":
          handlers.current.onPicked(message.pin, message.at, message.rect);
          return;
        case "pin_clicked":
          handlers.current.onPinClicked(message.id);
          return;
        case "pin_placement":
          handlers.current.onPlacement({ placed: new Set(message.placed), detached: new Set(message.detached) });
          return;
        case "zooms":
          handlers.current.onZooms(message.zooms);
          return;
        case "key":
          // Shortcuts work while the canvas has focus: replay the key on the host as if it were pressed here.
          (document.activeElement ?? document.body).dispatchEvent(
            new KeyboardEvent("keydown", { key: message.key, ctrlKey: message.ctrl, metaKey: message.meta, shiftKey: message.shift, altKey: message.alt, bubbles: true, cancelable: true }),
          );
          return;
        case "csp_violation":
          console.warn(`The canvas blocked ${message.blockedUri || "a resource"} (${message.directive}).`);
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
    if (readyCount > 0) post({ kind: "state", frames, props, selected, stage });
  }, [readyCount, frames, props, selected, stage]);

  useEffect(() => {
    if (readyCount > 0) post({ kind: "mode", mode });
  }, [readyCount, mode]);

  useEffect(() => {
    if (readyCount > 0) post({ kind: "pins", pins, focused, hovered });
  }, [readyCount, pins, focused, hovered]);

  useEffect(() => {
    if (readyCount > 0 && pulse !== null) post({ kind: "pulse", id: pulse.id });
  }, [readyCount, pulse]);

  return <iframe ref={frame} title="Canvas" src="/canvas" sandbox="allow-scripts" className="block size-full border-0" />;
}
