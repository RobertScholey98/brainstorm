import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20 dark:aria-invalid:border-danger/50 dark:aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The border takes the fill, so an accent button paints the same 28 px box as the outline one beside it. An
        // open trigger is one whose popover or menu shows: a Hint's tooltip marks its trigger `data-popup-open` too.
        accent: "border-accent bg-accent text-accent-fg hover:border-accent-hover hover:bg-accent-hover aria-expanded:border-accent-hover aria-expanded:bg-accent-hover",
        outline:
          "border-border-strong bg-card hover:bg-hover hover:text-fg aria-expanded:border-accent aria-expanded:bg-selected aria-expanded:text-fg aria-pressed:border-accent aria-pressed:bg-selected aria-pressed:text-fg",
        ghost:
          "hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg aria-pressed:bg-selected aria-pressed:text-fg",
        destructive:
          "border-border-strong bg-card text-danger hover:bg-danger-subtle",
      },
      size: {
        default: "h-7 gap-1.5 px-2 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
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
