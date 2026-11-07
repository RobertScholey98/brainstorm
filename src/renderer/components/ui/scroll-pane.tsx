import { useLayoutEffect, useRef, type ComponentProps, type RefObject } from "react"
import { cn } from "cn"

import { fadeCuts, type Unit } from "@/components/ui/fade-cut"

const INSET = {
  4: "px-[calc(var(--spacing-4)-var(--scrollbar))]",
  6: "px-[calc(var(--spacing-6)-var(--scrollbar))]",
} as const

/** What a fade keeps whole: a control's ring and shadow reach 2 px past its box. */
const CONTROLS = "button, input, textarea, select, kbd, svg, img, [role=slider], [role=switch], [role=checkbox], [role=combobox]"
const UNIT_MAX = 48

function measure(pane: HTMLElement): Unit[] {
  const origin = pane.getBoundingClientRect().top - pane.scrollTop
  const units: Unit[] = []
  const add = (r: DOMRect, grow: number) => {
    if (r.height >= 4 && r.height <= UNIT_MAX && r.width > 0) units.push([r.top - grow - origin, r.bottom + grow - origin])
  }
  const walk = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
    if (n.textContent?.trim() === "") continue
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) add(r, 0)
  }
  for (const el of pane.querySelectorAll(CONTROLS)) add(el.getBoundingClientRect(), 2)
  return units
}

/**
 * Sets the pane's fades from where its lines and controls sit. Their places are measured when its content or size
 * changes, so a scroll only moves the cut.
 */
function useFades(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const pane = ref.current
    if (pane === null) return
    let units: Unit[] = []
    let stale = true
    let frame = 0
    const paint = () => {
      frame = 0
      if (stale) [units, stale] = [measure(pane), false]
      const fades = fadeCuts(units, pane.scrollTop, pane.clientHeight, pane.scrollHeight)
      pane.style.setProperty("--fade-top", `${fades.top}px`)
      pane.style.setProperty("--fade-top-ramp", `${fades.topRamp}px`)
      pane.style.setProperty("--fade-bottom", `${fades.bottom}px`)
      pane.style.setProperty("--fade-bottom-ramp", `${fades.bottomRamp}px`)
    }
    const later = (relayout: boolean) => {
      stale ||= relayout
      frame ||= requestAnimationFrame(paint)
    }
    const scrolled = () => later(false)
    const resized = () => later(true)
    const sizes = new ResizeObserver(resized)
    sizes.observe(pane)
    for (const child of pane.children) sizes.observe(child)
    // Not `style`: the fades are written there.
    const changes = new MutationObserver(resized)
    changes.observe(pane, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "data-state", "open"] })
    pane.addEventListener("scroll", scrolled, { passive: true })
    void document.fonts.ready.then(resized)
    paint()
    return () => {
      cancelAnimationFrame(frame)
      sizes.disconnect()
      changes.disconnect()
      pane.removeEventListener("scroll", scrolled)
    }
  }, [ref])
}

/**
 * A pane's scrolling body. It keeps the scrollbar's gutter on both sides and pads each side by its inset less the
 * gutter, so content, and any rule drawn across it, sits `inset` off both edges whether or not it scrolls. Its edges
 * fade while there is more to scroll that way, each line and control hidden whole or shown, and its content can style
 * itself for a showing scrollbar (`scrolling:`).
 */
function ScrollPane({ inset = 4, className, ref: outer, ...props }: ComponentProps<"div"> & { inset?: keyof typeof INSET }) {
  const ref = useRef<HTMLDivElement>(null)
  useFades(ref)
  const setRef = (el: HTMLDivElement | null) => {
    ref.current = el
    if (typeof outer === "function") outer(el)
    else if (outer) outer.current = el
  }
  return (
    <div
      ref={setRef}
      data-slot="scroll-pane"
      className={cn("scroll-gutter scroll-fades min-h-0 [container-type:scroll-state] flex-1 overflow-x-hidden overflow-y-auto", INSET[inset], className)}
      {...props}
    />
  )
}

export { ScrollPane }
