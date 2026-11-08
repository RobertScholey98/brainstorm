import type { ReactNode } from "react";

export default function Badge({ children }: { children?: ReactNode }) {
  return <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{children}</span>;
}
