import type { ComponentProps } from "react"
import { cn } from "cn"

const INSET = {
  4: "px-[calc(var(--spacing-4)-var(--scrollbar))]",
  6: "px-[calc(var(--spacing-6)-var(--scrollbar))]",
} as const

/**
 * A pane's scrolling body. It keeps the scrollbar's gutter on both sides and pads each side by its inset less the
 * gutter, so content, and any rule drawn across it, sits `inset` off both edges whether or not it scrolls.
 */
function ScrollPane({ inset = 4, className, ...props }: ComponentProps<"div"> & { inset?: keyof typeof INSET }) {
  return (
    <div
      data-slot="scroll-pane"
      className={cn("scroll-gutter scroll-fade-top min-h-0 flex-1 overflow-x-hidden overflow-y-auto", INSET[inset], className)}
      {...props}
    />
  )
}

export { ScrollPane }
