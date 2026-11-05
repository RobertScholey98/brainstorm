import { CircleAlert } from "lucide-react"
import { cn } from "cn"

import { overlaySurface } from "@/components/ui/overlay"

/** A short-lived failure notice, bottom right of the window, on the shared overlay surface. */
function Toast({ message }: { message: string }) {
  return (
    <div
      role="alert"
      data-slot="toast"
      data-open=""
      className={cn(overlaySurface(), "fixed right-4 bottom-4 z-toast flex max-w-sm items-start gap-2 px-3 py-2 text-sm")}
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>{message}</span>
    </div>
  )
}

export { Toast }
