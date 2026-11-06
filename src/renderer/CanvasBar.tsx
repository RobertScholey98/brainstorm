import { ChevronLeft, ChevronRight, LayoutGrid, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Hint } from "@/components/ui/tooltip";
import type { CanvasLayout } from "../core/prefs";
import type { SlotId, SlotView } from "../core/types";

/**
 * Over the canvas: the slots as tabs, with arrows to step through them, the "All slots" toggle between the stage and the
 * board, and the Inspector's toggle at the end nearest it. The tab is the selected slot in both views; on the board,
 * choosing one scrolls its frame in.
 */
export function CanvasBar({
  slots,
  current,
  view,
  rail,
  onSlot,
  onView,
  onRail,
}: {
  slots: readonly SlotView[];
  current: SlotId | null;
  view: CanvasLayout["view"];
  /** The Inspector is collapsed to its rail. */
  rail: boolean;
  onSlot: (slot: SlotId) => void;
  onView: (view: CanvasLayout["view"]) => void;
  onRail: (rail: boolean) => void;
}) {
  const at = slots.findIndex((s) => s.id === current);
  const step = (by: number) => {
    const next = slots[at + by];
    if (next !== undefined) onSlot(next.id);
  };
  const board = view === "board";
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2" data-canvas-bar>
      <Hint label="Previous slot">
        <Button variant="ghost" size="icon-xs" aria-label="Previous slot" disabled={at <= 0} onClick={() => step(-1)} data-slot-step="previous">
          <ChevronLeft aria-hidden />
        </Button>
      </Hint>
      <Hint label="Next slot">
        <Button variant="ghost" size="icon-xs" aria-label="Next slot" disabled={at < 0 || at >= slots.length - 1} onClick={() => step(1)} data-slot-step="next">
          <ChevronRight aria-hidden />
        </Button>
      </Hint>
      <Tabs value={current} onValueChange={onSlot} tabs={slots.map((s) => ({ value: s.id, label: s.title }))} itemData="slot-tab" aria-label="Slots" />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Hint label={board ? "Show one slot at a time" : "Show every slot side by side"}>
          <Button variant="ghost" size="xs" aria-pressed={board} onClick={() => onView(board ? "stage" : "board")} data-board-toggle>
            <LayoutGrid data-icon="inline-start" aria-hidden />
            All slots
          </Button>
        </Hint>
        <Hint label={rail ? "Show the Inspector" : "Collapse the Inspector to a rail"}>
          <Button variant="ghost" size="icon-xs" aria-label={rail ? "Show the Inspector" : "Collapse the Inspector"} onClick={() => onRail(!rail)} data-inspector-toggle>
            {rail ? <PanelRightOpen aria-hidden /> : <PanelRightClose aria-hidden />}
          </Button>
        </Hint>
      </div>
    </div>
  );
}
