import type { ReactNode } from "react"
import { cn } from "cn"

/**
 * How many a head or a row holds: a muted numeral at its label's size, after the label or at the row's end. It is the
 * one shape a count takes, from "Feedback 3" to the sidebar's "3 variants", so a count never reads as a chip, a
 * button or a status. A Badge is a label, such as the iteration, never a count; `npm run lint:design` fails a count in
 * one.
 */
function Count({ children, className, ...data }: { children: ReactNode; className?: string } & { [attr: `data-${string}`]: unknown }) {
  return (
    <span data-slot="count" className={cn("shrink-0 font-normal text-fg-muted tabular-nums", className)} {...data}>
      {children}
    </span>
  )
}

export { Count }
