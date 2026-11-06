import type { ComponentProps } from "react"
import { cn } from "cn"

/**
 * A side pane's scrolling body. It keeps a stable 10 px scrollbar gutter, so its right padding is 16 px less the gutter
 * and content, and any rule drawn across it, sits 16 px off both edges. The top 8 px fade out, so a control scrolled
 * half under the pane's header leaves no hard sliver; at rest that band is the content's own top padding.
 */
function ScrollPane({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-pane"
      className={cn("scroll-gutter scroll-fade-top min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1.5 pl-4", className)}
      {...props}
    />
  )
}

export { ScrollPane }
