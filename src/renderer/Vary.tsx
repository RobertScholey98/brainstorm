import { Minus, Plus, Shuffle } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitKey } from "@/components/ui/kbd";
import { FieldLabel } from "@/components/ui/label";
import { OverlayHeader, OverlayPanel, PopoverFooter } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import { partLabel, VARY_MAX } from "../core/fork";
import type { BlockView, CanvasRect, Pin, SlotView } from "../core/types";
import { HeldLabel } from "./HeldLabel";
import { POPOVER_WIDTH } from "./placement";
import { useComposerPlace } from "./useComposerPlace";

const DEFAULT_COUNT = 3;

/**
 * The Inspector's Vary row, above Feedback and its Pin comment: a pick mode of its own on the same machinery. `blocked`
 * says why it can't start: before the first iteration, in the past, or while a request is open.
 */
export function VarySection({ picking, blocked, onPickToggle }: { picking: boolean; blocked: string | null; onPickToggle: () => void }) {
  const button = (
    <Button variant="outline" className="ml-auto" aria-pressed={picking} disabled={blocked !== null} onClick={onPickToggle} data-vary-toggle>
      <Shuffle data-icon="inline-start" aria-hidden />
      <HeldLabel active={picking} idle="Vary element" busy="Picking…" />
    </Button>
  );
  return (
    <section className="border-t" aria-label="Vary" data-vary-panel>
      <header className="flex items-center gap-2 py-3">
        <h2 className="text-base font-semibold">Vary</h2>
        {/* What a vary does lives in the button's hint, so the pane carries no help text that never goes away. */}
        {blocked === null ? (
          <Hint label="New variants of the picked element's slot, differing only there" side="left">
            {button}
          </Hint>
        ) : (
          <BlockedHint label={blocked} side="left" className="ml-auto" data-vary-blocked>
            {button}
          </BlockedHint>
        )}
      </header>
    </section>
  );
}

/** What a vary changes, as its popover names it: the element's part read as words, or the whole block. */
export const varyTarget = (pin: Pin, block: BlockView | null): string => (pin.part === null ? (block?.title ?? pin.blockId) : partLabel(pin.part));

/** The vary popover, opened where Rob picked, as the pin composer is: how many variants, and an optional direction. */
export function VaryComposer({
  pin,
  at,
  rect,
  block,
  slot,
  bounds,
  onSend,
  onCancel,
}: {
  pin: Pin;
  at: { x: number; y: number };
  rect: CanvasRect;
  block: BlockView | null;
  slot: SlotView | null;
  bounds: { width: number; height: number };
  onSend: (count: number, direction: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { ref, left, top } = useComposerPlace(at, rect, bounds, POPOVER_WIDTH.md);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => field.current?.focus(), []);
  const what = varyTarget(pin, block);
  const slotTitle = slot?.title ?? block?.slot ?? "";

  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSend(count, direction.trim() === "" ? null : direction.trim());
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.target === field.current)) void send();
  };
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute z-popover rounded-md ring-2 ring-accent"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        data-vary-outline
      />
      <OverlayPanel ref={ref} size="md" role="dialog" aria-labelledby="vary-title" data-vary-composer data-open="" style={{ left, top }} onKeyDown={onKey}>
        <OverlayHeader id="vary-title" heading={`Vary ${what}`} description={`${block?.title ?? pin.blockId} · ${slotTitle}. Everything else stays.`} />
        <div className="grid gap-1.5">
          <FieldLabel id="vary-count-label">How many</FieldLabel>
          <div className="flex items-center gap-1" role="group" aria-labelledby="vary-count-label">
            <Button variant="outline" size="icon" aria-label="Fewer" disabled={count <= 1} onClick={() => setCount((c) => c - 1)} data-vary-fewer>
              <Minus aria-hidden />
            </Button>
            <output className="w-8 text-center tabular-nums" aria-live="polite" data-vary-count={count}>
              {count}
            </output>
            <Button variant="outline" size="icon" aria-label="More" disabled={count >= VARY_MAX} onClick={() => setCount((c) => c + 1)} data-vary-more>
              <Plus aria-hidden />
            </Button>
          </div>
        </div>
        <label className="grid gap-1.5">
          <FieldLabel aside="optional">Direction</FieldLabel>
          <Input ref={field} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="bolder, calmer, more playful…" data-vary-direction />
        </label>
        <PopoverFooter hint={<span data-vary-hint>{`Variants land in ${slotTitle}`}</span>}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <SubmitKey disabled={busy}>
            <Button variant="accent" disabled={busy} onClick={() => void send()} data-vary-send>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? "Sending…" : "Send"}
            </Button>
          </SubmitKey>
        </PopoverFooter>
      </OverlayPanel>
    </>
  );
}
