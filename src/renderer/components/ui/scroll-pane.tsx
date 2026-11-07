import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { cn } from "cn"

const INSET = {
  4: "px-[calc(var(--spacing-4)-var(--scrollbar))]",
  6: "px-[calc(var(--spacing-6)-var(--scrollbar))]",
} as const

type Edges = { readonly scrolled: boolean; readonly more: boolean }

/**
 * A pane's scrolling body. It keeps the scrollbar's gutter on both sides and pads each side by its inset less the
 * gutter, so content, and any rule drawn across it, sits `inset` off both edges whether or not it scrolls. Its content
 * can style itself for a showing scrollbar (`scrolling:`).
 *
 * A `head` stands above the body, and content scrolls out of sight at its bottom edge. It paints no fill of its own, so
 * head and body are one surface, whichever surface the pane sits on. Its hairline shows only while the body is
 * scrolled from the top, as Claude and T3 Code rule off a scrolled pane. The foot is the same rule at the other end: it
 * shows while more waits below, 8 px off the pane's edge, so a control cut there reads as passing under a seam. Nothing
 * fades: a gradient over arbitrary content always leaves part of a glyph or a control showing.
 */
function ScrollPane({
  head,
  inset = 4,
  className,
  onScroll,
  ref: outer,
  ...props
}: ComponentProps<"div"> & { inset?: keyof typeof INSET; head?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState<Edges>({ scrolled: false, more: false })
  const read = (el: HTMLElement) => {
    const next = { scrolled: el.scrollTop > 0, more: el.scrollTop + el.clientHeight < el.scrollHeight - 1 }
    setEdges((prev) => (prev.scrolled === next.scrolled && prev.more === next.more ? prev : next))
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    read(el)
    const sizes = new ResizeObserver(() => read(el))
    const watch = () => {
      sizes.disconnect()
      sizes.observe(el)
      for (const child of el.children) sizes.observe(child)
    }
    watch()
    const content = new MutationObserver(() => {
      watch()
      read(el)
    })
    content.observe(el, { childList: true })
    return () => {
      sizes.disconnect()
      content.disconnect()
    }
  }, [])
  const body = (
    <div
      ref={(el) => {
        ref.current = el
        if (typeof outer === "function") outer(el)
        else if (outer) outer.current = el
      }}
      data-slot="scroll-pane"
      data-more={edges.more || undefined}
      onScroll={(e) => {
        read(e.currentTarget)
        onScroll?.(e)
      }}
      className={cn(
        "scroll-gutter mb-2 min-h-0 [container-type:scroll-state] flex-1 overflow-x-hidden overflow-y-auto border-b border-transparent data-more:border-border",
        INSET[inset],
        className
      )}
      {...props}
    />
  )
  if (head === undefined) return body
  return (
    <>
      <div data-slot="pane-head" data-scrolled={edges.scrolled || undefined} className="relative shrink-0 after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-transparent data-scrolled:after:border-border">
        {head}
      </div>
      {body}
    </>
  )
}

export { ScrollPane }
