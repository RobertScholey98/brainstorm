import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

import { overlaySurface } from "@/components/ui/overlay"
import { HintAnchor } from "@/components/ui/tooltip"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

const WIDTH = { sm: "w-popover-sm", md: "w-popover-md" } as const

/** Every popover is one of two widths, with 12 px padding and a 12 px gap between its parts. */
function PopoverContent({
  size = "sm",
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  ...props
}: Omit<PopoverPrimitive.Popup.Props, "className"> & { size?: keyof typeof WIDTH } &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      {/* A hint inside a popover opens off its own control, even when the popover's trigger sits in a hint row. */}
      <HintAnchor.Provider value={null}>
        <PopoverPrimitive.Positioner
          align={align}
          alignOffset={alignOffset}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={8}
          className="isolate z-popover"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            className={cn(overlaySurface(), "flex max-h-(--available-height) max-w-(--available-width) flex-col gap-3 overflow-y-auto p-3 text-sm", WIDTH[size])}
            {...props}
          />
        </PopoverPrimitive.Positioner>
      </HintAnchor.Provider>
    </PopoverPrimitive.Portal>
  )
}

const TITLE = "text-sm font-semibold"
const DESCRIPTION = "text-xs text-fg-muted"

function PopoverHeader({ heading, description }: { heading: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div data-slot="popover-header" className="grid gap-0.5">
      <PopoverPrimitive.Title data-slot="popover-title" className={TITLE}>
        {heading}
      </PopoverPrimitive.Title>
      {description !== undefined && (
        <PopoverPrimitive.Description data-slot="popover-description" className={DESCRIPTION}>
          {description}
        </PopoverPrimitive.Description>
      )}
    </div>
  )
}

/**
 * A popover placed by its caller rather than a Popover's positioner, such as the pin composer at the element Rob
 * picked: the same surface, widths, padding and gap. It is a flex column like PopoverContent, so a long row truncates
 * inside it; a grid's track would widen to the row and run its controls past the box's edge.
 */
function OverlayPanel({ size = "sm", ...props }: Omit<React.ComponentProps<"div">, "className"> & { size?: keyof typeof WIDTH }) {
  return <div data-slot="overlay-panel" className={cn(overlaySurface(), "absolute z-popover flex flex-col gap-3 p-3 text-sm", WIDTH[size])} {...props} />
}

/** The popover header on an overlay that isn't a Popover, such as the pin composer, which it titles by `id`. */
function OverlayHeader({ id, heading, description }: { id: string; heading: React.ReactNode; description: React.ReactNode }) {
  return (
    <div data-slot="popover-header" className="grid min-w-0 gap-0.5">
      <h2 id={id} className={TITLE}>
        {heading}
      </h2>
      <p data-slot="popover-description" className={cn(DESCRIPTION, "truncate")}>
        {description}
      </p>
    </div>
  )
}

/**
 * A hint on the left, then the actions: the dismiss before the primary. The hint stands 16 px off them, well over the
 * 6 px inside the group, so its last words never read as one phrase with the Ctrl+Enter key.
 */
function PopoverFooter({ hint, children }: { hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div data-slot="popover-footer" className="-mx-3 -mb-3 flex items-center gap-4 border-t px-3 py-2">
      {hint !== undefined && <span className="min-w-0 truncate text-xs text-fg-muted">{hint}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">{children}</span>
    </div>
  )
}

export {
  OverlayHeader,
  OverlayPanel,
  Popover,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
}
