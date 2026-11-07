"use client"

import type { ReactNode } from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cn } from "cn"
import { Hint } from "@/components/ui/tooltip"

/** `hint` says what a segment's label alone can't, such as how one choice relates to another. */
type Option<T extends string> = { readonly value: T; readonly label: ReactNode; readonly hint?: string }

/**
 * One choice out of a few, always one on: the Inspector's enum controls and the Regenerate scope. The chosen segment
 * is a raised chip with an edge on a sunken track, so it reads as on in both themes without relying on a tint. The
 * track takes the 28 px box and border-strong edge of the fields and buttons beside it, so on home's canvas, where a
 * canvas fill would vanish, it still reads as one control; in dark the chip rises above the surface round the track.
 * `itemData` names a data attribute each segment carries its value in, for tests and the capture. `fit` sizes it to its
 * labels, every segment as wide as the widest, for a two-way view switch in a bar; `fit="content"` lets each segment hug
 * its own label, so a longer set of uneven labels keeps even gaps, and holds one weight, so a press moves nothing. The
 * default fills its row like a form field. Inside a disabled row the chip goes and the chosen label keeps its weight, so
 * a control that takes no input doesn't show a choice as made.
 */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  itemData,
  fit = false,
  "aria-label": label,
}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly Option<T>[]
  itemData?: string
  fit?: boolean | "content"
  "aria-label": string
}) {
  return (
    <ToggleGroupPrimitive
      data-slot="segmented"
      aria-label={label}
      value={[value]}
      onValueChange={(next) => next[0] !== undefined && onValueChange(next[0] as T)}
      className={cn("h-7 gap-0.5 rounded-md bg-muted p-0.5 inset-ring inset-ring-border-strong dark:bg-app", fit === "content" ? "flex w-fit shrink-0" : fit ? "grid w-fit shrink-0 auto-cols-fr grid-flow-col" : "flex w-full items-stretch")}
    >
      {options.map((o) => {
        const segment = (
          <TogglePrimitive
            key={o.value}
            value={o.value}
            {...(itemData === undefined ? {} : { [`data-${itemData}`]: o.value })}
            className={cn(
              "min-w-0 truncate rounded-sm whitespace-nowrap px-2 text-sm text-fg-muted transition-colors outline-none select-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-card data-pressed:text-fg data-pressed:shadow-xs data-pressed:inset-ring data-pressed:inset-ring-border-strong dark:data-pressed:bg-border-strong in-aria-disabled:data-pressed:bg-transparent in-aria-disabled:data-pressed:shadow-none in-aria-disabled:data-pressed:inset-ring-0 dark:in-aria-disabled:data-pressed:bg-transparent",
              fit === "content" ? "flex-none" : "flex-1 data-pressed:font-medium"
            )}
          >
            {o.label}
          </TogglePrimitive>
        )
        return o.hint === undefined ? (
          segment
        ) : (
          <Hint key={o.value} label={o.hint} side="bottom">
            {segment}
          </Hint>
        )
      })}
    </ToggleGroupPrimitive>
  )
}

export { Segmented }
