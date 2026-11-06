import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-fg/10 dark:bg-fg/20", className)}
      {...props}
    />
  )
}

export { Skeleton }
