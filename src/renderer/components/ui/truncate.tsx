import { useLayoutEffect, useRef, type ComponentProps } from "react"
import { cn } from "cn"

import { cutText } from "@/components/ui/cut-text"

let ruler: CanvasRenderingContext2D | null = null

function measureCut(el: HTMLElement, text: string): string | null {
  if (el.scrollWidth <= el.clientWidth) return null
  const style = getComputedStyle(el)
  ruler ??= document.createElement("canvas").getContext("2d")
  if (ruler === null) return null
  ruler.font = style.font
  ruler.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing
  const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  return cutText(text, (shown) => ruler!.measureText(shown).width <= room)
}

/**
 * One line of text that ends in an ellipsis when it runs out of room, cut after a word or letter rather than after a
 * space or a comma. `text-overflow` ends at the last glyph that fits, whatever it is, so the cut is measured here, and
 * only while the text overflows. The full text stays in the element for copy, search and the accessible name; the cut
 * paints over it from `data-cut` (styles.css).
 */
function Truncate({ children, className, ...props }: Omit<ComponentProps<"span">, "children"> & { children: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const apply = () => {
      const cut = measureCut(el, children)
      if (cut === null) delete el.dataset.cut
      else el.dataset.cut = cut
    }
    apply()
    void document.fonts.ready.then(apply)
    const sizes = new ResizeObserver(apply)
    sizes.observe(el)
    return () => sizes.disconnect()
  }, [children])
  return (
    <span ref={ref} data-slot="truncate" className={cn("block min-w-0 truncate", className)} {...props}>
      {children}
    </span>
  )
}

export { Truncate }
