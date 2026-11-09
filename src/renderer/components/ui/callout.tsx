import type { ComponentProps, ReactNode } from "react"
import { AlertTriangle, CircleAlert, Info, type LucideIcon } from "lucide-react"
import { cva } from "class-variance-authority"
import { cn } from "cn"

type Tone = "danger" | "warning" | "info"

const ICON: Record<Tone, LucideIcon> = { danger: CircleAlert, warning: AlertTriangle, info: Info }

const calloutVariants = cva("grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-xs/relaxed text-fg", {
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
 * Every status box in the app: the Inspector's block error and inapplicable settings, and the request message under
 * the top bar. `inset` sits inside a panel; `strip` runs edge to edge under a bar. Actions only
 * go in `actions`, which sit under the message, so a narrow panel keeps the message at full width. A callout that lists
 * several things, each with its own action, uses one `CalloutItem` per thing. lint:design fails a button written into
 * the message itself (`callout-actions`). Its fill is a tint, so an outline button in it draws its edge alone, as on a
 * selected row. `wide` is for a narrow panel such as the sidebar, where a text column beside the icon would squeeze the
 * actions: the icon opens the message's first line, so the message and the actions start on one edge. `inline` is for
 * a full-width page, where actions under the message would cost a row: they sit at the message's right instead.
 */
function Callout({
  tone,
  layout = "inset",
  heading,
  actions,
  wide = false,
  inline = false,
  children,
  ...props
}: Omit<ComponentProps<"div">, "className" | "title"> & {
  tone: Tone
  layout?: "inset" | "strip"
  heading?: ReactNode
  actions?: ReactNode
  wide?: boolean
  inline?: boolean
}) {
  const Icon = ICON[tone]
  return (
    <div
      data-slot="callout"
      data-tone={tone}
      data-tint
      className={cn(calloutVariants({ tone, layout }), wide && "grid-cols-1", inline && "grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4")}
      {...props}
    >
      {!wide && <Icon aria-hidden data-callout-tone className="mt-0.5 size-3.5 shrink-0" />}
      <div className={wide ? "min-w-0 text-pretty [&>:nth-child(n+3)]:mt-1" : "grid min-w-0 flex-1 gap-1 text-pretty"}>
        {wide && <Icon aria-hidden data-callout-tone className="float-left mt-0.5 mr-1.5 size-3.5" />}
        {heading !== undefined && (
          <p data-callout-tone className="text-sm font-medium">
            {heading}
          </p>
        )}
        {children}
      </div>
      {actions !== undefined && (
        <div className={inline ? "col-start-3 row-start-1 self-start [&>div]:pt-0" : wide ? undefined : "col-start-2"}>
          <CalloutActions>{actions}</CalloutActions>
        </div>
      )}
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
