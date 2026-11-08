"use client"

import { createContext, useContext, type ComponentProps, type ReactElement, type ReactNode } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "cn"

import { Kbd } from "@/components/ui/kbd"
import { Truncate } from "@/components/ui/truncate"
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
  anchor,
  covers,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "anchor"
  > & { sideOffset?: number | (() => number); covers?: HintRow["text"] }) {
  // A hint opening left over a line of text either clears it or covers it from its start, so no half-word peeks out.
  const cover = (popup: HTMLElement | null) => {
    if (popup === null || covers === undefined || side !== "left" || typeof anchor !== "function" || typeof sideOffset !== "function") return
    const [text, row] = [covers(), anchor()]
    if (text === null || row == null) return
    const right = row.getBoundingClientRect().left - sideOffset()
    if (right - popup.offsetWidth >= text.end) return
    popup.style.minWidth = `${right - text.start}px`
    popup.style.justifyContent = "flex-end"
  }
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        anchor={anchor}
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
        className="isolate z-tooltip"
      >
        <TooltipPrimitive.Popup
          ref={cover}
          data-slot="tooltip-content"
          className={cn(
            overlaySurface({ tone: "inverse" }),
            // One 24 px line against the 28 px controls, so a hint beside a row of buttons never reads as one more of
            // them. It never wraps: a long label cuts at the window's edge instead.
            "inline-flex h-6 w-fit max-w-[calc(100vw-16px)] items-center gap-2 px-2 text-xs whitespace-nowrap",
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
 * A row of controls whose hints open off the whole row, not off their own control, so a hint never covers the
 * control beside the one it labels. The window header provides it, spanning its request status too, so a hint never
 * hides the status either; a popover resets it. `text` is the line a hint opens over, the header's breadcrumb and
 * badge, from its first ink to its last.
 */
type HintRow = {
  anchor: () => Element | { getBoundingClientRect: () => DOMRect } | null
  text: () => { start: number; end: number } | null
}
const HintAnchor = createContext<HintRow | null>(null)
/**
 * Off a row, a hint stands further out than the row's 8 px gap between buttons, so it never reads as one of them,
 * but no further than the text it covers ends, so none of that text shows between the hint and the row.
 */
const ROW_OFFSET = 12
const rowOffset = (row: HintRow) => () => {
  const [text, at] = [row.text(), row.anchor()]
  if (text === null || at === null) return ROW_OFFSET
  return Math.max(0, Math.min(ROW_OFFSET, at.getBoundingClientRect().left - text.end))
}

/**
 * A styled hint on one control, with its keyboard shortcut when it has one. The renderer uses this instead of a native
 * `title`, which the OS draws outside the theme; `npm run lint:design` fails a `title` hint.
 *
 * Every hint names its side, so it opens off the controls it serves and off the Inspector header: a header hint opens
 * to the side, never down over the card. `npm run lint:design` checks both. `disabled` keeps it shut, for a hint that
 * would only repeat text already in full on screen. `name` leads with the control's name, for a hint that opens off a
 * row, away from the control it serves.
 */
function Hint({
  name,
  label,
  shortcut,
  side,
  disabled,
  children,
}: {
  name?: string
  label: ReactNode
  shortcut?: string
  side: NonNullable<TooltipPrimitive.Positioner.Props["side"]>
  disabled?: boolean
  children: ReactElement
}) {
  const row = useContext(HintAnchor)
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} anchor={row?.anchor} sideOffset={row === null ? undefined : rowOffset(row)} covers={row?.text}>
        {name !== undefined && (
          <>
            <span className="font-medium" data-hint-name>
              {name}
            </span>
            <span aria-hidden>·</span>
          </>
        )}
        {typeof label === "string" ? <Truncate>{label}</Truncate> : <span>{label}</span>}
        {shortcut !== undefined && <Kbd tone="inverse">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The hint on a control that is off, saying why. A disabled button takes no pointer or focus, so the hint opens off a
 * focusable wrapper round it. It is a component of its own, not a `Hint` with a wrapped child, because Base UI keeps a
 * live tooltip's hover on the trigger it mounted with: a control that turns off in place must mount a fresh tooltip,
 * or its hint opens on focus but never on hover. `npm run lint:design` fails the wrapper written by hand.
 */
function BlockedHint({
  name,
  label,
  side,
  className,
  children,
  ...data
}: {
  name?: string
  label: ReactNode
  side: NonNullable<TooltipPrimitive.Positioner.Props["side"]>
  className?: string
  children: ReactElement
} & { [attr: `data-${string}`]: unknown }) {
  return (
    <Hint name={name} label={label} side={side}>
      <span tabIndex={0} className={className} {...data}>
        {children}
      </span>
    </Hint>
  )
}

/**
 * A tooltip's look on a label no trigger owns, placed by its caller: present's opening line on how to leave. It reads as
 * a label, as a tooltip does, so it never looks like a panel to act in.
 */
function TooltipLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span data-slot="tooltip-label" data-open="" className={cn(overlaySurface({ tone: "inverse" }), "flex items-center gap-2 px-3 py-1.5 text-sm", className)}>
      {children}
    </span>
  )
}

/** A button inside a TooltipLabel, in the label's own ink, set off from its words by a rule. */
function TooltipAction({ className, ...props }: Omit<ComponentProps<"button">, "type">) {
  return (
    <button
      type="button"
      data-slot="tooltip-action"
      className={cn(
        "-my-1 -mr-2 ml-1 flex items-center gap-1.5 rounded-sm border-l border-inverse-fg/20 px-2 py-1 font-medium outline-none hover:bg-inverse-fg/15 focus-visible:ring-2 focus-visible:ring-ring dark:border-fg/15 dark:hover:bg-fg/10",
        className,
      )}
      {...props}
    />
  )
}

export { BlockedHint, Hint, HintAnchor, Tooltip, TooltipAction, TooltipLabel, TooltipTrigger, TooltipContent, TooltipProvider }
export type { HintRow }
