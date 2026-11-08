import { CircleAlert, CircleCheck, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { overlaySurface } from "@/components/ui/overlay"

/**
 * A failure notice on the shared overlay surface: a title naming what Rob tried, then why it failed, in the danger
 * Callout's recipe (a danger title over a 12 px fg reason), so one failure reads one way across the window. It sits at the
 * bottom right of the region that holds it, 16 px off the bottom and 16 px off the scrollbar that region's scroller
 * keeps at its right, so it never covers the Inspector or its feedback actions. Its edge takes the danger tone at 40%, as a
 * danger strip's does, so it reads as a failure over a dark frame and not by its icon alone. It stays
 * until Rob closes it or the next call he makes succeeds, so a notice that came while he looked elsewhere is still there.
 * The success tone, for a step whose result shows nowhere else such as a manual sync, swaps the danger hue for success.
 */
function Toast({ heading, message, onClose, tone = "danger" }: { heading: string; message: string; onClose: () => void; tone?: "danger" | "success" }) {
  const Icon = tone === "success" ? CircleCheck : CircleAlert
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      data-slot="toast"
      data-open=""
      className={cn(overlaySurface(), "absolute right-[calc(var(--spacing-4)+var(--scrollbar))] bottom-4 z-toast flex max-w-sm items-start gap-2 py-2 pr-1 pl-3 text-sm", tone === "success" ? "ring-success/40" : "ring-danger/40")}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone === "success" ? "text-success" : "text-danger")} />
      <div className="grid min-w-0 flex-1 gap-0.5 py-0.5">
        <p className={cn("font-medium", tone === "success" ? "text-success" : "text-danger")} data-toast-title>{heading}</p>
        <p className="text-xs/relaxed text-fg">{message}</p>
      </div>
      <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose} data-toast-close>
        <X aria-hidden />
      </Button>
    </div>
  )
}

export { Toast }
