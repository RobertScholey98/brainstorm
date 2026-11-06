import type { ComponentProps, ReactNode } from "react"
import { AlertTriangle, CircleAlert, Info, type LucideIcon } from "lucide-react"
import { cva } from "class-variance-authority"

type Tone = "danger" | "warning" | "info"

const ICON: Record<Tone, LucideIcon> = { danger: CircleAlert, warning: AlertTriangle, info: Info }

const calloutVariants = cva("flex items-start gap-2 text-xs/relaxed text-fg", {
  variants: {
    tone: {
      danger: "bg-danger-subtle [&_[data-callout-tone]]:text-danger",
      warning: "bg-warning-subtle [&_[data-callout-tone]]:text-warning",
      info: "bg-info-subtle [&_[data-callout-tone]]:text-info",
    },
    layout: {
      inset: "rounded-lg p-3 inset-ring",
      strip: "border-b px-4 py-2",
    },
  },
  compoundVariants: [
    { layout: "inset", tone: "danger", className: "inset-ring-danger/25" },
    { layout: "inset", tone: "warning", className: "inset-ring-warning/25" },
    { layout: "inset", tone: "info", className: "inset-ring-info/25" },
    { layout: "strip", tone: "danger", className: "border-danger/40" },
    { layout: "strip", tone: "warning", className: "border-warning/40" },
    { layout: "strip", tone: "info", className: "border-info/40" },
  ],
})

/**
 * Every status box in the app: the Inspector's block error and inapplicable adjustments, the takeover phrase, and the
 * request message under the top bar. `inset` sits inside a panel; `strip` runs edge to edge under a bar. Actions only
 * go in `actions`, which sit under the message, so a narrow panel keeps the message at full width. A callout that lists
 * several things, each with its own action, uses one `CalloutItem` per thing. lint:design fails a button written into
 * the message itself (`callout-actions`).
 */
function Callout({
  tone,
  layout = "inset",
  heading,
  actions,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className" | "title"> & {
  tone: Tone
  layout?: "inset" | "strip"
  heading?: ReactNode
  actions?: ReactNode
}) {
  const Icon = ICON[tone]
  return (
    <div data-slot="callout" data-tone={tone} className={calloutVariants({ tone, layout })} {...props}>
      <Icon aria-hidden data-callout-tone className="mt-0.5 size-3.5 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-1 text-pretty">
        {heading !== undefined && (
          <p data-callout-tone className="text-sm font-medium">
            {heading}
          </p>
        )}
        {children}
        {actions !== undefined && <CalloutActions>{actions}</CalloutActions>}
      </div>
    </div>
  )
}

function CalloutActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>
}

/** One entry in a callout that lists several, with its own actions under its text. */
function CalloutItem({ actions, children, ...props }: Omit<ComponentProps<"li">, "className"> & { actions?: ReactNode }) {
  return (
    <li data-slot="callout-item" className="grid min-w-0 gap-0.5" {...props}>
      <div className="min-w-0">{children}</div>
      {actions !== undefined && <CalloutActions>{actions}</CalloutActions>}
    </li>
  )
}

export { Callout, CalloutItem }
