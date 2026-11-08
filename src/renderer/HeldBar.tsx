import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncate } from "@/components/ui/truncate";

/**
 * The strip along the canvas's top edge while the preview window is held (ADR 007), in the warning tone, as the past's
 * bar is in the info tone: the preview window shows something the main window no longer does, which Rob must not lose
 * sight of on a call. Both windows show it, the working look's preview window naming itself. It lies in the
 * canvas's 24 px top inset, short of the frame captions, so pressing Hold moves nothing and hides nothing.
 */
export function HeldBar({ on, here, onRelease }: { on: string | null; here: "main" | "preview"; onRelease: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 z-sticky bg-card">
      <div role="status" className="flex h-5 items-center gap-2 border-b border-warning bg-warning/25 pl-3 text-xs dark:bg-warning-subtle" data-held-bar>
        <Pause aria-hidden className="size-3 shrink-0 fill-current text-warning" />
        <span className="shrink-0 font-semibold">Preview held</span>
        {/* The main window names what its audience still sees, the slot and variant set apart as names; the preview
            window, which shows that itself, says what waits for Resume live. */}
        {here === "preview" ? (
          <Truncate className="w-0 flex-1">Changes from the main window show when you resume.</Truncate>
        ) : on === null ? (
          <Truncate className="w-0 flex-1">The preview window keeps what it showed.</Truncate>
        ) : (
          <span className="flex w-0 flex-1 items-center">
            <span className="shrink-0 whitespace-pre">The preview window still shows </span>
            <Truncate className="min-w-0 font-semibold">{on}</Truncate>
          </span>
        )}
        <Button variant="strip" size="strip" onClick={onRelease} data-held-release>
          <Play aria-hidden className="fill-current" />
          Resume live
        </Button>
      </div>
    </div>
  );
}
