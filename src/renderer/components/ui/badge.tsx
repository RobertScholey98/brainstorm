import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "cn"
import { chip } from "@/components/ui/chip"

const SIZE = {
  default: "h-5 px-2 text-xs",
  // A count on a control's corner, such as the Inspector rail's feedback button. A 40 px rail has no room to set it
  // clear of the glyph, so a 2 px cut in the card's colour keeps the two from reading as one shape.
  corner: "h-4 min-w-4 px-1 text-2xs ring-2 ring-card",
} as const

/** A short label beside a title, such as the iteration. It takes the one chip recipe. */
function Badge({ className, render, size = "default", ...props }: useRender.ComponentProps<"span"> & { size?: keyof typeof SIZE }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          chip,
          "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full font-medium whitespace-nowrap tabular-nums [&>svg]:pointer-events-none [&>svg]:size-3!",
          SIZE[size],
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "badge" },
  })
}

export { Badge }
