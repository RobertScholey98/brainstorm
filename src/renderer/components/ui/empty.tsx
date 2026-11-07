import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { chip } from "@/components/ui/chip"

/**
 * `start` is for a message on a left-aligned page, such as home's, which starts on the page's edge as its heading does.
 * `danger` is for a failure: its title takes the danger tone over a reason in fg, as a Callout and a toast state one.
 */
function Empty({ className, align = "center", tone, ...props }: React.ComponentProps<"div"> & { align?: "center" | "start"; tone?: "danger" }) {
  return (
    <div
      data-slot="empty"
      data-align={align}
      data-tone={tone}
      className={cn(
        "group/empty flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-pretty data-[align=start]:items-start data-[align=start]:px-0 data-[align=start]:text-left",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2 group-data-[align=start]/empty:items-start", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: `${chip} flex size-8 shrink-0 items-center justify-center rounded-lg text-fg [&_svg:not([class*='size-'])]:size-4`,
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "text-sm font-medium tracking-tight group-data-[tone=danger]/empty:text-danger",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-fg-muted group-data-[tone=danger]/empty:text-fg [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-fg",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2 text-sm text-pretty group-data-[align=start]/empty:items-start",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
