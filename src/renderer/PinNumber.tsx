import type { ComponentProps } from "react";
import { cn } from "cn";
import type { FeedbackId, FeedbackStatus } from "../core/types";

/** Pins are the accent's; status shows by form, as on the canvas: filled, outlined, then neutral. */
const PIN_FORM: Record<FeedbackStatus["state"], string> = {
  open: "bg-accent text-accent-fg",
  addressed: "bg-card text-accent inset-ring-2 inset-ring-accent",
  confirmed: "bg-muted text-fg-muted",
};

/** A pin's number in its pin's disc, so a list that names a pin shows the mark Rob sees on the canvas. */
export function PinNumber({ n, state, className, ...props }: { n: FeedbackId; state: FeedbackStatus["state"] } & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      className={cn("grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full rounded-bl-sm px-1 text-2xs font-semibold tabular-nums", PIN_FORM[state], className)}
      data-pin-number={state}
      {...props}
    >
      {n}
    </span>
  );
}
