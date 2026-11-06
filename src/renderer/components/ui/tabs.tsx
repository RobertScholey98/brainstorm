import type { ReactNode } from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

type Tab<T extends string> = { readonly value: T; readonly label: ReactNode }

/**
 * A row of tabs over one view, such as the slots of a brainstorm on the stage. The active tab is underlined in the
 * accent, because it is the selection. Arrow keys move along the row and choose as they go; Home and End jump to the
 * ends. `itemData` names a data attribute each tab carries its value in, for tests and the capture.
 */
function Tabs<T extends string>({
  value,
  onValueChange,
  tabs,
  itemData,
  "aria-label": label,
}: {
  value: T | null
  onValueChange: (value: T) => void
  tabs: readonly Tab<T>[]
  itemData?: string
  "aria-label": string
}) {
  return (
    <TabsPrimitive.Root data-slot="tabs" value={value} onValueChange={(next) => onValueChange(next as T)} className="flex min-w-0 self-stretch">
      <TabsPrimitive.List aria-label={label} activateOnFocus className="flex min-w-0 items-stretch gap-1">
        {tabs.map((t) => (
          <TabsPrimitive.Tab
            key={t.value}
            value={t.value}
            {...(itemData === undefined ? {} : { [`data-${itemData}`]: t.value })}
            className="relative flex max-w-picker min-w-0 shrink items-center rounded-sm px-2 text-sm text-fg-muted outline-none select-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-active:font-medium data-active:text-fg data-active:after:bg-accent"
          >
            <span className="truncate">{t.label}</span>
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export { Tabs }
