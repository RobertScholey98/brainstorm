import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

import { overlaySurface } from "@/components/ui/overlay"

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
          className={cn(overlaySurface(), "flex max-w-(--available-width) flex-col gap-3 p-3 text-sm", WIDTH[size])}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ heading, description }: { heading: React.ReactNode; description?: React.ReactNode }) {
  return (
    <div data-slot="popover-header" className="grid gap-0.5">
      <PopoverPrimitive.Title data-slot="popover-title" className="text-sm font-semibold">
        {heading}
      </PopoverPrimitive.Title>
      {description !== undefined && (
        <PopoverPrimitive.Description data-slot="popover-description" className="text-xs text-fg-muted">
          {description}
        </PopoverPrimitive.Description>
      )}
    </div>
  )
}

/** A hint on the left, then the actions: the dismiss before the primary. */
function PopoverFooter({ hint, children }: { hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div data-slot="popover-footer" className="-mx-3 -mb-3 flex items-center gap-2 border-t px-3 py-2">
      {hint !== undefined && <span className="min-w-0 truncate text-xs text-fg-muted">{hint}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">{children}</span>
    </div>
  )
}

export {
  Popover,
  PopoverContent,
  PopoverFooter,
  PopoverHeader,
  PopoverTrigger,
}
