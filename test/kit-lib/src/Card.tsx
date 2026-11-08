import type { ReactNode } from "react";

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-border bg-background p-6 shadow-sm">{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold text-foreground">{children}</h3>;
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="mt-2 text-sm text-muted-foreground">{children}</div>;
}
