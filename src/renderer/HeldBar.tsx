import { CirclePause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncate } from "@/components/ui/truncate";

/**
 * The strip along the canvas's top edge while the preview window is held (ADR 007), in the warning tone, as the past's
 * bar is in the info tone: the preview window shows something the main window no longer does, which Rob must not lose
 * sight of on a call. Both windows show it, the working look's preview window naming itself. It fills the canvas's
 * 24 px top inset, above the frame captions, so pressing Hold moves nothing and hides nothing.
 */
export function HeldBar({ on, here, onRelease }: { on: string | null; here: "main" | "preview"; onRelease: () => void }) {
  const subject = here === "main" ? "The preview window" : "This window";
  return (
    <div className="absolute inset-x-0 top-0 z-sticky bg-card">
      <div role="status" className="flex h-6 items-center gap-2 border-b border-warning/60 bg-warning/20 pr-0.5 pl-3 text-xs dark:bg-warning-subtle" data-held-bar>
        <CirclePause aria-hidden className="size-3.5 shrink-0 text-warning" />
        <span className="shrink-0 font-medium">Preview held</span>
        <Truncate className="w-0 flex-1">{on === null ? `${subject} keeps what it showed.` : `${subject} still shows ${on}.`}</Truncate>
        <Button variant="outline" size="2xs" onClick={onRelease} data-held-release>
          Resume live
        </Button>
      </div>
    </div>
  );
}
