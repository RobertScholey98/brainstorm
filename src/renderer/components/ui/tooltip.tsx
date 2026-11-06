"use client"

import type { ReactElement, ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "cn"

import { Kbd } from "@/components/ui/kbd"
import { overlaySurface } from "@/components/ui/overlay"

function TooltipProvider({
  delay = 500,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="isolate z-tooltip"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            overlaySurface({ tone: "inverse" }),
            "inline-flex w-fit max-w-xs items-center gap-2 px-2 py-1 text-xs",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/**
 * A styled hint on one control, with its keyboard shortcut when it has one. The renderer uses this instead of a native
 * `title`, which the OS draws outside the theme; `npm run lint:design` fails a `title` hint.
 *
 * Every hint names its side, so it opens off the controls it serves and off the Inspector header: a header hint opens
 * to the side, never down over the card. `npm run lint:design` checks both. `disabled` keeps it shut, for a hint that
 * would only repeat text already in full on screen.
 */
function Hint({
  label,
  shortcut,
  side,
  disabled,
  children,
}: {
  label: ReactNode
  shortcut?: string
  side: NonNullable<TooltipPrimitive.Positioner.Props["side"]>
  disabled?: boolean
  children: ReactElement
}) {
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
        <span>{label}</span>
        {shortcut !== undefined && <Kbd tone="inverse">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

export { Hint, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
