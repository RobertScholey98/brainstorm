import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20 dark:aria-invalid:border-danger/50 dark:aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The border takes the fill, so an accent button paints the same 28 px box as the outline one beside it. An
        // open trigger is one whose popover or menu shows: a Hint's tooltip marks its trigger `data-popup-open` too.
        accent: "border-accent bg-accent text-accent-fg hover:border-accent-hover hover:bg-accent-hover aria-expanded:border-accent-hover aria-expanded:bg-accent-hover",
        // On a tinted surface, marked `data-tint`, the card fill would punch a hole in the tint, so the edge alone draws it.
        outline:
          "border-border-strong bg-card in-data-tint:not-hover:bg-transparent hover:bg-hover hover:text-fg aria-expanded:border-accent aria-expanded:bg-selected aria-expanded:text-fg aria-pressed:border-accent aria-pressed:bg-selected aria-pressed:text-fg",
        // An outline toggle whose pressed state is a warning, as Hold preview's is: pressed, it leaves a shared window behind.
        // A trigger marked `data-warn` takes the same tone, as the Preview menu does while its window isn't for sharing.
        caution:
          "border-border-strong bg-card in-data-tint:not-hover:bg-transparent hover:bg-hover hover:text-fg data-warn:border-warning data-warn:bg-warning-subtle aria-expanded:border-accent aria-expanded:bg-selected aria-expanded:text-fg aria-pressed:border-warning aria-pressed:bg-warning-subtle aria-pressed:text-fg",
        // The action closing a status strip: the strip's whole height at its end, set off by a rule, not a box.
        strip: "rounded-none border-0 border-l border-warning/50 bg-warning/20 font-semibold text-warning hover:bg-warning/35 focus-visible:ring-inset",
        ghost:
          "hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg aria-pressed:bg-selected aria-pressed:text-fg",
        destructive:
          "border-border-strong bg-card text-danger in-data-tint:not-hover:bg-transparent in-data-tint:not-hover:text-danger-ink hover:bg-danger-subtle",
      },
      size: {
        // An icon a fitted row has collapsed gives its padding back, so the label keeps the plain button's air.
        default: "h-7 gap-1.5 px-2 text-sm has-[[data-icon=inline-end]:not([data-collapsed])]:pr-1.5 has-[[data-icon=inline-start]:not([data-collapsed])]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        // As tall as the strip it ends, as the held strip's Resume live is.
        strip: "h-full gap-1 px-3 text-xs [&_svg:not([class*='size-'])]:size-3",
        // A 24 px action that names itself, as a list row's hover action does.
        xs: "h-6 gap-1 px-1.5 text-xs font-normal [&_svg:not([class*='size-'])]:size-3.5",
        // A glyph over its count, for a narrow rail with no room to set a corner count clear of the glyph.
        "icon-count": "h-8 w-7 flex-col gap-0.5 text-2xs [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "outline",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
