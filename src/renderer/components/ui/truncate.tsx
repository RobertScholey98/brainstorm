import { useLayoutEffect, useRef, type ComponentProps } from "react"
import { cn } from "cn"

import { cutText } from "@/components/ui/cut-text"
import { inkAndRoom, SLACK } from "@/components/ui/ink"

let ruler: CanvasRenderingContext2D | null = null

function measureCut(el: HTMLElement, text: string, tail: string): string | null {
  const style = getComputedStyle(el)
  const { ink, room } = inkAndRoom(el, style)
  if (ink <= room + SLACK) return null
  ruler ??= document.createElement("canvas").getContext("2d")
  if (ruler === null) return null
  ruler.font = style.font
  ruler.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing
  return cutText(text, (shown) => ruler!.measureText(shown + tail).width <= room) + tail
}

/**
 * One line of text that ends in an ellipsis when it runs out of room, cut after a word or letter rather than after a
 * space or a comma. `text-overflow` ends at the last glyph that fits, whatever it is, so the cut is measured here, and
 * only while the text overflows. The full text stays in the element for copy, search and the accessible name; the cut
 * paints over it from `data-cut` (styles.css). A `tail` follows the text and never cuts, so "from Rota hando… · iteration 3"
 * stays one phrase, with no gap where the cut stopped short of its box.
 */
function Truncate({ children, tail = "", className, ref: outer, ...props }: Omit<ComponentProps<"span">, "children"> & { children: string; tail?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  // A Hint hands its trigger a ref; the cut still needs its own.
  const setRef = (el: HTMLSpanElement | null) => {
    ref.current = el
    if (typeof outer === "function") outer(el)
    else if (outer) outer.current = el
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const apply = () => {
      const cut = measureCut(el, children, tail)
      if (cut === null) delete el.dataset.cut
      else el.dataset.cut = cut
    }
    apply()
    void document.fonts.ready.then(apply)
    const sizes = new ResizeObserver(apply)
    sizes.observe(el)
    return () => sizes.disconnect()
  }, [children, tail])
  return (
    <span ref={setRef} data-slot="truncate" className={cn("block min-w-0 truncate", className)} {...props}>
      {children}
      {tail}
    </span>
  )
}

export { Truncate }
