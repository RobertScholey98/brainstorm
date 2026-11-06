import { AlertTriangle } from "lucide-react";
import { cn } from "cn";
import type { SessionListing } from "../core/types";
import { sessionStatus, type Tone } from "./status";

const DOT: Record<Tone, string> = { accent: "bg-accent", info: "bg-info", warning: "bg-warning", danger: "bg-danger" };
const TEXT: Record<Tone, string> = { accent: "text-accent", info: "text-info", warning: "text-warning", danger: "text-danger" };

/** `compact` is a list row's mark with its label for screen readers only; otherwise the label shows beside it. */
export function SessionStatus({ session, compact = false, className }: { session: SessionListing; compact?: boolean; className?: string }) {
  const status = sessionStatus(session);
  if (status === null) return null;
  return (
    <span
      className={cn("flex shrink-0 items-center gap-1.5", TEXT[status.tone], className)}
      data-session-status={session.lost ? "thread_lost" : session.request}
    >
      {session.lost ? (
        <AlertTriangle aria-hidden className={compact ? "size-3.5!" : "size-3"} />
      ) : (
        <span aria-hidden className="relative grid size-2 place-items-center">
          {status.live && <span className={cn("absolute size-2 animate-ping rounded-full opacity-60", DOT[status.tone])} />}
          <span className={cn("size-1.5 rounded-full", DOT[status.tone])} />
        </span>
      )}
      <span className={compact ? "sr-only" : undefined}>{status.label}</span>
    </span>
  );
}
