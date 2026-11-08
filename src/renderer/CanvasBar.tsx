import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import { Truncate } from "@/components/ui/truncate";
import { cn } from "cn";
import { Hint } from "@/components/ui/tooltip";
import type { CanvasLayout } from "../core/prefs";
import type { SlotId, SlotView } from "../core/types";
import { useBarFit } from "./headerAction";

const VIEWS: readonly { value: CanvasLayout["view"]; label: string }[] = [
  { value: "stage", label: "One slot" },
  { value: "board", label: "All slots" },
];

/**
 * Over the canvas: the slots as tabs, with arrows to step through them, then what the canvas is doing at the right. The
 * tab is the selected slot in both views, the one accent mark here; the view switch is neutral, since it is a choice of
 * layout, not a selection. With one slot both views are the same, so neither the arrows nor the switch show. Pick mode
 * says so here, in the bar, so its hint never covers a frame.
 */
export function CanvasBar({
  slots,
  current,
  view,
  zoom,
  picking,
  onSlot,
  onView,
  onCancelPick,
  pickHint,
  trailing,
}: {
  slots: readonly SlotView[];
  current: SlotId | null;
  view: CanvasLayout["view"];
  /** The selected frame's scale below 1, from the fit rules, or null at full size. */
  zoom: number | null;
  /** What a pick is for, while the canvas is in pick mode. */
  picking: "comment" | "vary" | null;
  onSlot: (slot: SlotId) => void;
  onView: (view: CanvasLayout["view"]) => void;
  onCancelPick: () => void;
  /** What the pick hint says, when it isn't this window's canvas that takes the pick. */
  pickHint?: string;
  /** How the canvas is shown beyond this window, at the bar's right end: present, and the preview window. */
  trailing?: ReactNode;
}) {
  const at = slots.findIndex((s) => s.id === current);
  const step = (by: number) => {
    const next = slots[at + by];
    if (next !== undefined) onSlot(next.id);
  };
  const several = slots.length > 1;
  const pct = zoom === null ? 100 : Math.round(zoom * 100);
  const bar = useRef<HTMLDivElement>(null);
  useBarFit(bar);
  return (
    <div ref={bar} className="flex h-10 shrink-0 items-center gap-1 border-b bg-card px-2" data-canvas-bar>
      {several && (
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
      {/* It takes only the room the tabs leave, so in a narrow window the pick hint's text gives way, never a tab. */}
      <div className="flex flex-1 items-center justify-end gap-2 pl-2">
        {/* The hint's room is kept while no pick is on, unseen, so the controls after it never move when one starts. */}
        <span
          className={cn("flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-muted", picking === null && "invisible")}
          {...(picking === null ? { "aria-hidden": true, inert: true } : { role: "status", "data-pick-hint": "" })}
        >
          <Truncate className="w-0 flex-1 text-right" data-bar-hint>
            {pickHint ?? (picking === "vary" ? "Click an element to vary" : "Click an element to pin a comment")}
          </Truncate>
          <Kbd>Esc</Kbd>
          <Button variant="ghost" onClick={onCancelPick}>
            Cancel
          </Button>
          {/* Pick mode's own controls, then the view's, as the header divides a request's actions from Regenerate. */}
          {several && <Separator orientation="vertical" {...(picking === null ? {} : { "data-pick-divider": "" })} />}
        </span>
        {pct < 100 && (
          <Hint label="Scaled to fit the canvas. Hide the sidebar (Ctrl+B) or collapse the Inspector to give it more room." side="bottom">
            <Badge tabIndex={0} data-canvas-zoom={pct}>
              {pct}%
            </Badge>
          </Hint>
        )}
        {several && <Segmented fit value={view} onValueChange={onView} options={VIEWS} itemData="view-option" aria-label="View" />}
        {/* Every control keeps its place through a pick; their labels give way to the hint first (BAR_COLLAPSE). */}
        {trailing !== undefined && (
          <>
            {several && <Separator orientation="vertical" data-trailing-divider />}
            {trailing}
          </>
        )}
      </div>
    </div>
  );
}
