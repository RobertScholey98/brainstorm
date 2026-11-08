import type { ReactElement } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { chip } from "@/components/ui/chip"

const kbdVariants = cva(
  "inline-flex h-4.5 shrink-0 items-center rounded-sm px-1 font-sans text-xs font-medium tabular-nums data-disabled:opacity-50",
  {
    variants: {
      tone: {
        default: chip,
        inverse: "bg-inverse-fg/15 text-inverse-fg/80 dark:bg-fg/10 dark:text-fg/80",
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

/**
 * A send button with its key before it: 4 px off the button it presses and 12 px after the Cancel beside it, in a row
 * of 6 px gaps, so the key reads as the send's and never as Cancel's.
 */
function SubmitKey({ shortcut = "Ctrl+Enter", disabled, children }: { shortcut?: string; disabled?: boolean; children: ReactElement }) {
  return (
    <span className="ml-1.5 flex items-center gap-1" data-submit-key>
      <Kbd disabled={disabled}>{shortcut}</Kbd>
      {children}
    </span>
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

export { Code, Kbd, SubmitKey }
