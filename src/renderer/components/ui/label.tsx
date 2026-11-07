import * as React from "react"
import { cn } from "cn"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

const FIELD_LABEL = "flex items-center gap-1.5 text-xs font-medium text-fg-muted"

/**
 * The label over a field or a group in an overlay, one recipe in every popover: muted, a step under the overlay's
 * title, so a title and its labels never read as equals. `aside` sits at the row's end, such as "optional".
 */
function FieldLabel({
  as: Tag = "span",
  aside,
  children,
  ...props
}: { as?: "span" | "h3" | "legend"; aside?: React.ReactNode; children: React.ReactNode } & { id?: string } & {
  [attr: `data-${string}`]: unknown
}) {
  return (
    <Tag data-slot="field-label" className={cn(FIELD_LABEL, Tag === "legend" && "pb-0.5")} {...props}>
      {children}
      {aside !== undefined && <span className="ml-auto font-normal">{aside}</span>}
    </Tag>
  )
}

export { FieldLabel, Label }
