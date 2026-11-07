import { useState, type ComponentProps, type ReactNode } from "react"
import { cn } from "cn"

const INSET = {
  4: "px-[calc(var(--spacing-4)-var(--scrollbar))]",
  6: "px-[calc(var(--spacing-6)-var(--scrollbar))]",
} as const

/**
 * A pane's scrolling body. It keeps the scrollbar's gutter on both sides and pads each side by its inset less the
 * gutter, so content, and any rule drawn across it, sits `inset` off both edges whether or not it scrolls. Its content
 * can style itself for a showing scrollbar (`scrolling:`).
 *
 * A `head` stands above the body on the pane's own surface, and content scrolls out of sight at its bottom edge. Its
 * hairline shows only while the body is scrolled from the top, as Claude and T3 Code rule off a scrolled pane. Nothing
 * fades: a gradient over arbitrary content always leaves part of a glyph or a control showing.
 */
function ScrollPane({
  head,
  inset = 4,
  className,
  onScroll,
  ...props
}: ComponentProps<"div"> & { inset?: keyof typeof INSET; head?: ReactNode }) {
  const [scrolled, setScrolled] = useState(false)
  const body = (
    <div
      data-slot="scroll-pane"
      onScroll={(e) => {
        setScrolled(e.currentTarget.scrollTop > 0)
        onScroll?.(e)
      }}
      className={cn("scroll-gutter min-h-0 [container-type:scroll-state] flex-1 overflow-x-hidden overflow-y-auto", INSET[inset], className)}
      {...props}
    />
  )
  if (head === undefined) return body
  return (
    <>
      <div data-slot="pane-head" data-scrolled={scrolled || undefined} className="relative shrink-0 bg-card after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-transparent data-scrolled:after:border-border">
        {head}
      </div>
      {body}
    </>
  )
}

export { ScrollPane }
