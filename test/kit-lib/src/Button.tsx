import type { ReactNode } from "react";

export type ButtonProps = { children: ReactNode; variant?: "primary" | "outline"; onClick?: () => void };

export function Button({ children, variant = "primary", onClick }: ButtonProps) {
  const look = variant === "primary" ? "bg-primary text-primary-foreground" : "border border-border text-foreground";
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium has-[>svg]:px-3 *:[svg:not([class*='size-'])]:size-4 ${look}`}>
      {children}
    </button>
  );
}
