import * as React from "react"
import { cva } from "class-variance-authority"

const STEP = 16

const handleVariants = cva(
  "group/handle absolute inset-y-0 z-raised flex w-2 cursor-col-resize justify-center outline-hidden after:w-px after:bg-ring after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:w-0.5 focus-visible:after:opacity-100 data-dragging:after:opacity-100",
  {
    variants: {
      edge: {
        left: "left-0 justify-start",
        right: "right-0 translate-x-1/2",
      },
    },
  }
)

/**
 * A drag handle on one edge of a pane, centred on the pane's border. `edge` is the side it sits on; dragging away
 * from the pane grows it. Arrow keys step 16 px, and a double click goes back to `reset`.
 */
function ResizeHandle({
  edge,
  value,
  min,
  max,
  reset,
  onValueChange,
  "aria-label": label,
}: {
  edge: "left" | "right"
  value: number
  min: number
  max: number
  reset: number
  onValueChange: (value: number) => void
  "aria-label": string
}) {
  const [dragging, setDragging] = React.useState(false)
  const start = React.useRef({ x: 0, value })
  const grow = edge === "right" ? 1 : -1
  const set = (v: number) => onValueChange(Math.round(Math.max(min, Math.min(max, v))))

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-slot="resize-handle"
      data-dragging={dragging || undefined}
      className={handleVariants({ edge })}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, value }
        document.body.dataset.resizing = ""
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!dragging) return
        set(start.current.value + grow * (e.clientX - start.current.x))
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId)
        delete document.body.dataset.resizing
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        delete document.body.dataset.resizing
        setDragging(false)
      }}
      onDoubleClick={() => set(reset)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? STEP : e.key === "ArrowLeft" ? -STEP : null
        if (step !== null) {
          e.preventDefault()
          set(value + grow * step)
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault()
          set(e.key === "Home" ? min : max)
        }
      }}
    />
  )
}

export { ResizeHandle }
