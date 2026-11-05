import { cva, type VariantProps } from "class-variance-authority"

const kbdVariants = cva(
  "inline-flex h-4.5 shrink-0 items-center rounded-sm px-1 font-sans text-xs font-medium tabular-nums",
  {
    variants: {
      tone: {
        default: "bg-muted text-fg-muted inset-ring inset-ring-border",
        inverse: "bg-inverse-fg/15 text-inverse-fg/80",
      },
    },
    defaultVariants: { tone: "default" },
  }
)

/** A key or chord, such as Ctrl+B, shown in a hint. */
function Kbd({ tone, children }: VariantProps<typeof kbdVariants> & { children: string }) {
  return (
    <kbd data-slot="kbd" className={kbdVariants({ tone })}>
      {children}
    </kbd>
  )
}

export { Kbd }
