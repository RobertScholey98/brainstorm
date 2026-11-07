import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "cn"
import { chip } from "@/components/ui/chip"

const SIZE = {
  default: "h-5 px-2 text-xs",
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
