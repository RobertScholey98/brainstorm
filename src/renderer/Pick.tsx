import { Import } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitKey } from "@/components/ui/kbd";
import { FieldLabel } from "@/components/ui/label";
import { OverlayHeader, OverlayPanel, PopoverFooter } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { BlockedHint, Hint } from "@/components/ui/tooltip";
import type { BlockView, CanvasRect, Pin, SlotId, SlotView } from "../core/types";
import { POPOVER_WIDTH } from "./placement";
import { useComposerPlace } from "./useComposerPlace";
import { varyTarget } from "./Vary";

/**
 * The Inspector's Pick row, under Vary (ADR 009): a pick of its own on the same machinery, which brings the clicked
 * element into a slot's Main. Like 👍 and 🗑 it marks, so it runs no agent until Confirm.
 */
export function PickSection({
  picking,
  open,
  asked = false,
  blocked,
  onPickToggle,
}: {
  picking: boolean;
  open: boolean;
  asked?: boolean;
  blocked: string | null;
  onPickToggle: () => void;
}) {
  const button = (
    <Button variant="outline" className="ml-auto" aria-pressed={picking} aria-expanded={open} data-edge={asked || undefined} disabled={blocked !== null} onClick={onPickToggle} data-graft-toggle>
      <Import data-icon="inline-start" aria-hidden />
      Pick into Main
    </Button>
  );
  return (
    <section className="border-t" aria-label="Pick" data-graft-panel>
      <header className="flex items-center gap-2 py-3">
        <h2 className="text-base font-semibold">Pick</h2>
        {blocked === null ? (
          <Hint label="Bring an element from any variant into a slot's Main, applied when you confirm" side="left">
            {button}
          </Hint>
        ) : (
          <BlockedHint label={blocked} side="left" className="ml-auto" data-graft-blocked>
            {button}
          </BlockedHint>
        )}
      </header>
    </section>
  );
}

/** The pick popover, opened where Rob clicked: which slot's Main the element goes into, and an optional word on where. */
export function PickComposer({
  pin,
  at,
  rect,
  block,
  slots,
  bounds,
  onAdd,
  onCancel,
}: {
  pin: Pin;
  at: { x: number; y: number };
  rect: CanvasRect;
  block: BlockView | null;
  slots: readonly SlotView[];
  bounds: { width: number; height: number };
  onAdd: (into: SlotId, instruction: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { ref, left, top } = useComposerPlace(at, rect, bounds, POPOVER_WIDTH.md);
  // Most picks go into the slot they came from; another slot is allowed, and less common.
  const [into, setInto] = useState<SlotId>(block?.slot ?? slots[0]!.id);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => field.current?.focus(), []);
  const what = varyTarget(pin, block);
  const items = slots.map((s) => ({ value: s.id as string, label: s.title }));

  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onAdd(into, instruction.trim() === "" ? null : instruction.trim());
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || e.target === field.current)) void add();
  };
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute z-popover rounded-md ring-2 ring-accent"
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        data-graft-outline
      />
      <OverlayPanel ref={ref} size="md" role="dialog" aria-labelledby="pick-title" data-graft-composer data-open="" style={{ left, top }} onKeyDown={onKey}>
        <OverlayHeader id="pick-title" heading={`Pick ${what}`} description={`from ${block?.title ?? pin.blockId}`} />
        {slots.length > 1 && (
          <div className="grid gap-1.5">
            <FieldLabel id="pick-into-label">Into Main of</FieldLabel>
            <Select items={items} value={into as string} onValueChange={(v) => v !== null && setInto(v as SlotId)}>
              <SelectTrigger aria-labelledby="pick-into-label" className="w-full" data-graft-into={into}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {slots.map((s) => (
                    <SelectItem key={s.id} value={s.id} data-graft-slot={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
        <label className="grid gap-1.5">
          <FieldLabel aside="optional">Where it goes</FieldLabel>
          <Input ref={field} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="under the title, in place of the old one…" data-graft-instruction />
        </label>
        <PopoverFooter hint={<span data-graft-hint>{instruction.trim() === "" ? "Without a word, the agent places it where it fits best" : "Applied when you confirm"}</span>}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <SubmitKey disabled={busy}>
            <Button variant="accent" disabled={busy} onClick={() => void add()} data-graft-add>
              {busy && <Spinner data-icon="inline-start" />}
              Add to Main
            </Button>
          </SubmitKey>
        </PopoverFooter>
      </OverlayPanel>
    </>
  );
}
