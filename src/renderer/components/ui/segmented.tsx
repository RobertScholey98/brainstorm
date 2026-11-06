"use client"

import type { ReactNode } from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cn } from "cn"

type Option<T extends string> = { readonly value: T; readonly label: ReactNode }

/**
 * One choice out of a few, always one on: the Inspector's enum controls and the Regenerate scope. The chosen segment
 * is a raised chip with an edge on a sunken track, so it reads as on in both themes without relying on a tint.
 * `itemData` names a data attribute each segment carries its value in, for tests and the capture. `fit` sizes it to its
 * labels, every segment as wide as the widest, for a two-way view switch in a bar; `fit="content"` lets each segment hug
 * its own label, so a longer set of uneven labels keeps even gaps, and holds one weight, so a press moves nothing. The
 * default fills its row like a form field.
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
      className={cn("h-7 gap-0.5 rounded-md bg-canvas p-0.5 inset-ring inset-ring-border dark:bg-app", fit === "content" ? "flex w-fit shrink-0" : fit ? "grid w-fit shrink-0 auto-cols-fr grid-flow-col" : "flex w-full items-stretch")}
    >
      {options.map((o) => (
        <TogglePrimitive
          key={o.value}
          value={o.value}
          {...(itemData === undefined ? {} : { [`data-${itemData}`]: o.value })}
          className={cn(
            "min-w-0 truncate rounded-sm whitespace-nowrap px-2 text-sm text-fg-muted transition-colors outline-none select-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-card data-pressed:text-fg data-pressed:shadow-xs data-pressed:inset-ring data-pressed:inset-ring-border-strong dark:data-pressed:bg-muted",
            fit === "content" ? "flex-none" : "flex-1 data-pressed:font-medium"
          )}
        >
          {o.label}
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  )
}

export { Segmented }
