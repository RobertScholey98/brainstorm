import { ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Hint } from "@/components/ui/tooltip";
import type { CanvasLayout } from "../core/prefs";
import type { SlotId, SlotView } from "../core/types";

/**
 * Over the canvas: the slots as tabs, with arrows to step through them, and the "All slots" toggle between the stage and
 * the board. The tab is the selected slot in both views; on the board, choosing one scrolls its frame in.
 */
export function CanvasBar({
  slots,
  current,
  view,
  onSlot,
  onView,
}: {
  slots: readonly SlotView[];
  current: SlotId | null;
  view: CanvasLayout["view"];
  onSlot: (slot: SlotId) => void;
  onView: (view: CanvasLayout["view"]) => void;
}) {
  const at = slots.findIndex((s) => s.id === current);
  const step = (by: number) => {
    const next = slots[at + by];
    if (next !== undefined) onSlot(next.id);
  };
  const board = view === "board";
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2" data-canvas-bar>
      {slots.length > 1 && (
        <>
          <Hint label="Previous slot" side="bottom">
            <Button variant="ghost" size="icon-xs" aria-label="Previous slot" disabled={at <= 0} onClick={() => step(-1)} data-slot-step="previous">
              <ChevronLeft aria-hidden />
            </Button>
          </Hint>
          <Hint label="Next slot" side="bottom">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next slot"
              disabled={at < 0 || at >= slots.length - 1}
              onClick={() => step(1)}
              data-slot-step="next"
            >
              <ChevronRight aria-hidden />
            </Button>
          </Hint>
        </>
      )}
      <Tabs value={current} onValueChange={onSlot} tabs={slots.map((s) => ({ value: s.id, label: s.title }))} itemData="slot-tab" aria-label="Slots" />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Hint label={board ? "Show one slot at a time" : "Show every slot side by side"} side="bottom">
          <Button variant="ghost" aria-pressed={board} onClick={() => onView(board ? "stage" : "board")} data-board-toggle>
            <LayoutGrid data-icon="inline-start" aria-hidden />
            All slots
          </Button>
        </Hint>
      </div>
    </div>
  );
}
