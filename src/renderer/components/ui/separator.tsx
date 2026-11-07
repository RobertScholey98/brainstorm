import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "cn"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        // A vertical rule divides control groups in a bar on the app surface, where a border tone all but vanishes. It is
        // 16 px on the controls' centre line; a stretched rule would start at the top of the bar's flex line.
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:h-4 data-vertical:w-px data-vertical:self-center data-vertical:bg-separator",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
