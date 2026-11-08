import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncate } from "@/components/ui/truncate";

/**
 * The strip along the canvas's top edge while the preview window is held (ADR 007), in the warning tone, as the past's
 * bar is in the info tone: the preview window shows something the main window no longer does, which Rob must not lose
 * sight of on a call. Both windows show it, in the same words. It lies in the
 * canvas's 32 px top inset (CANVAS_TOP), 8 px short of the frame captions, so pressing Hold moves nothing and hides nothing.
 */
export function HeldBar({ on, onRelease }: { on: string | null; onRelease: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 z-sticky bg-card">
      <div role="status" className="flex h-6 items-center gap-2 border-b-2 border-warning bg-warning-subtle pl-3 text-xs" data-tint data-held-bar>
        <Pause aria-hidden className="size-3 shrink-0 fill-current text-warning" />
        {/* It names what the audience still sees, the slot and variant set apart as names. */}
        {on !== null ? (
          <span className="flex w-0 flex-1 items-center">
            <span className="shrink-0 whitespace-pre">
              <span className="font-semibold">Preview held</span> on{" "}
            </span>
            <Truncate className="min-w-0 font-semibold">{on}</Truncate>
          </span>
        ) : (
          <>
            <span className="shrink-0 font-semibold">Preview held</span>
            <Truncate className="w-0 flex-1">The preview window keeps what it showed.</Truncate>
          </>
        )}
        <Button variant="strip" size="strip" onClick={onRelease} data-held-release>
          <Play aria-hidden className="fill-current" />
          Resume live
        </Button>
      </div>
    </div>
  );
}
