"use client"

import type { ReactNode } from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"

type Option<T extends string> = { readonly value: T; readonly label: ReactNode }

/**
 * One choice out of a few, always one on: the Inspector's enum controls and the Regenerate scope. The chosen segment
 * is a raised chip with an edge on a sunken track, so it reads as on in both themes without relying on a tint.
 * `itemData` names a data attribute each segment carries its value in, for tests and the capture.
 */
function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  itemData,
  "aria-label": label,
}: {
  value: T
  onValueChange: (value: T) => void
  options: readonly Option<T>[]
  itemData?: string
  "aria-label": string
}) {
  return (
    <ToggleGroupPrimitive
      data-slot="segmented"
      aria-label={label}
      value={[value]}
      onValueChange={(next) => next[0] !== undefined && onValueChange(next[0] as T)}
      className="flex h-7 w-full items-stretch gap-0.5 rounded-md bg-canvas p-0.5 inset-ring inset-ring-border dark:bg-app"
    >
      {options.map((o) => (
        <TogglePrimitive
          key={o.value}
          value={o.value}
          {...(itemData === undefined ? {} : { [`data-${itemData}`]: o.value })}
          className="min-w-0 flex-1 truncate rounded-sm px-2 text-sm text-fg-muted transition-colors outline-none select-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-card data-pressed:font-medium data-pressed:text-fg data-pressed:shadow-xs data-pressed:ring-1 data-pressed:ring-border-strong dark:data-pressed:bg-muted"
        >
          {o.label}
        </TogglePrimitive>
      ))}
    </ToggleGroupPrimitive>
  )
}

export { Segmented }
