import { CircleAlert, X } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { overlaySurface } from "@/components/ui/overlay"

/**
 * A failure notice, bottom right of the window, on the shared overlay surface. It stays until Rob closes it or the
 * next call he makes succeeds, so a notice that came while he looked elsewhere is still there.
 */
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="alert"
      data-slot="toast"
      data-open=""
      className={cn(overlaySurface(), "fixed right-4 bottom-4 z-toast flex max-w-sm items-start gap-2 py-2 pr-1 pl-3 text-sm")}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <span className="min-w-0 flex-1 py-0.5">{message}</span>
      <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose} data-toast-close>
        <X aria-hidden />
      </Button>
    </div>
  )
}

export { Toast }
