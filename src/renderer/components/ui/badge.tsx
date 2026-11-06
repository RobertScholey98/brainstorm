import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "cn"
import { chip } from "@/components/ui/chip"

/** A short label beside a title, such as the iteration. It takes the one chip recipe. */
function Badge({ className, render, ...props }: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(
          chip,
          "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full px-2 text-xs font-medium whitespace-nowrap tabular-nums [&>svg]:pointer-events-none [&>svg]:size-3!",
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
