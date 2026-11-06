import { cva, type VariantProps } from "class-variance-authority"
import { chip } from "@/components/ui/chip"

const kbdVariants = cva(
  "inline-flex h-4.5 shrink-0 items-center rounded-sm px-1 font-sans text-xs font-medium tabular-nums data-disabled:opacity-50",
  {
    variants: {
      tone: {
        default: chip,
        inverse: "bg-inverse-fg/15 text-inverse-fg/80 dark:bg-fg/10 dark:text-fg-muted",
      },
    },
    defaultVariants: { tone: "default" },
  }
)

/** A key or chord, such as Ctrl+B, shown in a hint. `disabled` dims it with the button whose shortcut it names. */
function Kbd({ tone, disabled, children }: VariantProps<typeof kbdVariants> & { disabled?: boolean; children: string }) {
  return (
    <kbd data-slot="kbd" data-disabled={disabled || undefined} className={kbdVariants({ tone })}>
      {children}
    </kbd>
  )
}

/** A code span in running text, such as a command to type. */
function Code({ children }: { children: string }) {
  return (
    <code data-slot="code" className={`${chip} rounded-sm px-1 font-mono text-xs text-fg`}>
      {children}
    </code>
  )
}

export { Code, Kbd }
