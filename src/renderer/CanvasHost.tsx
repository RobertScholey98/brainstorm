import { useEffect, useRef, useState } from "react";
import type {
  BlockId,
  BlockView,
  CanvasFrame,
  CanvasMode,
  CanvasPin,
  CanvasRect,
  CanvasSystem,
  ContentHash,
  FeedbackId,
  FrameToHost,
  HostToFrame,
  KitPayload,
  Pin,
  Props,
  SlotId,
} from "../core/types";
import { kitFor } from "./kit";

export type Placement = { readonly placed: ReadonlySet<FeedbackId>; readonly detached: ReadonlySet<FeedbackId> };

/** A comment to bring forward, and which time this is: a pin clicked twice brings its comment forward twice. */
export type FeedbackCue = { readonly id: FeedbackId; readonly seq: number };

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
  present = false,
  mode,
  pins,
  focused,
  hovered,
  pulse,
  onSelect,
  onBlockError,
  onPicked,
  onPinClicked,
  onPinHovered,
  onPlacement,
  onZooms,
  onPointer,
  system,
}: {
  /** The session's design system, or null for a freeform session. Its kit loads before any block. */
  system: CanvasSystem | null;
  blocks: readonly BlockView[];
  frames: readonly CanvasFrame[];
  props: Readonly<Record<string, Props>>;
  selected: BlockId | null;
  /** The slot on the stage, or null for the board. */
  stage: SlotId | null;
  /** The staged slot fills the frame with no canvas chrome (ADR 007). */
  present?: boolean;
  mode: CanvasMode;
  pins: readonly CanvasPin[];
  /** The pin whose feedback row is open in the Inspector. */
  focused: FeedbackId | null;
  /** The pin whose feedback row is under the pointer, echoed on the canvas. */
  hovered: FeedbackId | null;
  pulse: FeedbackCue | null;
  onSelect: (blockId: BlockId) => void;
  onBlockError: (blockId: BlockId, message: string) => void;
  onPicked: (pin: Pin, at: { x: number; y: number }, rect: CanvasRect) => void;
  onPinClicked: (id: FeedbackId) => void;
  onPinHovered: (id: FeedbackId | null) => void;
  onPlacement: (placement: Placement) => void;
  onZooms: (zooms: Readonly<Record<string, number>>) => void;
  /** In present, the pointer moved over the frame. */
  onPointer?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // The version of each block the frame holds. A past iteration can bring back an older one, so it is sent again.
  const sent = useRef(new Map<BlockId, ContentHash>());
  const [readyCount, setReadyCount] = useState(0);
  const handlers = useRef({ onSelect, onBlockError, onPicked, onPinClicked, onPinHovered, onPlacement, onZooms, onPointer });
  handlers.current = { onSelect, onBlockError, onPicked, onPinClicked, onPinHovered, onPlacement, onZooms, onPointer };

  const post = (message: HostToFrame) => frame.current?.contentWindow?.postMessage(message, "*");

  const [kit, setKit] = useState<{ readonly key: string; readonly payload: KitPayload | null } | null>(null);
  const kitKey = system === null ? null : `${system.id}@${system.n}`;
  useEffect(() => {
    if (system === null || kitKey === null) return;
    let current = true;
    void kitFor(system.id, system.n).then((payload) => current && setKit({ key: kitKey, payload }));
    return () => {
      current = false;
    };
    // Keyed by version alone: the theme and proposed components change without a new kit.
  }, [kitKey]);
  /** Blocks wait for the kit, so none loads against a kit that isn't there and reports a failure it didn't have. */
  const kitReady = system === null || (kit?.key === kitKey && kit.payload !== null);

  useEffect(() => {
    if (readyCount === 0) return;
    if (system === null) {
      post({ kind: "kit", kit: null });
      return;
    }
    if (kit?.key === kitKey && kit.payload !== null) post({ kind: "kit", kit: kit.payload });
  }, [readyCount, kit, kitKey]);

  const proposedKey = JSON.stringify(system?.proposed.map((p) => p.hash) ?? []);
  useEffect(() => {
    if (readyCount > 0 && kitReady) post({ kind: "proposed", modules: system?.proposed ?? [] });
  }, [readyCount, kitReady, proposedKey]);

  const themeKey = JSON.stringify(system?.theme ?? null);
  useEffect(() => {
    if (readyCount > 0 && system !== null) post({ kind: "theme", theme: system.theme });
  }, [readyCount, themeKey]);

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
        case "pin_hovered":
          handlers.current.onPinHovered(message.id);
          return;
        case "pin_placement":
          handlers.current.onPlacement({ placed: new Set(message.placed), detached: new Set(message.detached) });
          return;
        case "zooms":
          handlers.current.onZooms(message.zooms);
          return;
        case "pointer":
          handlers.current.onPointer?.();
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
    if (readyCount === 0 || !kitReady) return;
    const fresh = blocks.filter((b) => sent.current.get(b.id) !== b.hash);
    if (fresh.length === 0) return;
    post({ kind: "modules", modules: fresh.map((b) => ({ blockId: b.id, hash: b.hash, compiled: b.compiled, css: b.css })) });
    for (const b of fresh) sent.current.set(b.id, b.hash);
  }, [readyCount, blocks, kitReady]);

  // Before the state, so a frame that comes up presenting never lays out its chrome first.
  useEffect(() => {
    if (readyCount > 0) post({ kind: "present", on: present });
  }, [readyCount, present]);

  useEffect(() => {
    if (readyCount > 0 && kitReady) post({ kind: "state", frames, props, selected, stage });
  }, [readyCount, frames, props, selected, stage, kitReady]);

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
