import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground",
  outline: "border border-border bg-background text-foreground",
} as const;

export function Button({ children, variant = "primary" }: { children?: ReactNode; variant?: keyof typeof VARIANTS }) {
  return <button className={cn("inline-flex rounded-md px-3 py-2 text-sm font-medium", VARIANTS[variant])}>{children}</button>;
}
