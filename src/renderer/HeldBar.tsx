import { CirclePause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncate } from "@/components/ui/truncate";

/**
 * The bar under the canvas bar while the preview window is held (ADR 007), in the warning tone, as the past's bar is in
 * the info tone: the preview window shows something the main window no longer does, which Rob must not lose sight of on
 * a call. Both windows show it, the working look's preview window naming itself.
 */
export function HeldBar({ on, here, onRelease }: { on: string | null; here: "main" | "preview"; onRelease: () => void }) {
  const subject = here === "main" ? "The preview window" : "This window";
  return (
    <div role="status" className="flex h-10 shrink-0 items-center gap-2 border-b border-warning/60 bg-warning-subtle pr-2 pl-4 text-sm" data-tint data-held-bar>
      <CirclePause aria-hidden className="size-4 shrink-0 text-warning" />
      <span className="shrink-0 font-medium">Preview held</span>
      <Truncate className="w-0 flex-1 text-fg-muted">{on === null ? `${subject} keeps what it showed.` : `${subject} keeps showing ${on}.`}</Truncate>
      <Button variant="outline" onClick={onRelease} data-held-release>
        Resume live
      </Button>
    </div>
  );
}
