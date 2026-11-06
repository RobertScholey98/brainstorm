import { AlertTriangle } from "lucide-react";
import { cn } from "cn";
import type { OpenPhase, SessionListing } from "../core/types";
import { sessionPhase, STATUS, type Tone } from "./status";

const DOT: Record<Tone, string> = { accent: "bg-accent", info: "bg-info", warning: "bg-warning", danger: "bg-danger" };
const TEXT: Record<Tone, string> = { accent: "text-accent", info: "text-info", warning: "text-warning", danger: "text-danger" };

/**
 * What a brainstorm waits on, the one mark every list uses. `compact` is a list row's mark with its label for screen
 * readers only; otherwise the label shows beside it, then `after`, such as how long the agent has been working.
 */
export function PhaseStatus({ phase, compact = false, after, className }: { phase: OpenPhase; compact?: boolean; after?: string; className?: string }) {
  const status = STATUS[phase];
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TEXT[status.tone], className)} data-session-status={phase}>
      {phase === "thread_lost" ? (
        <AlertTriangle aria-hidden className={compact ? "size-3.5!" : "size-3"} />
      ) : (
        <span aria-hidden className="relative grid size-2 place-items-center">
          {status.live && <span className={cn("absolute size-2 animate-ping rounded-full opacity-60", DOT[status.tone])} />}
          <span className={cn("size-1.5 rounded-full", DOT[status.tone])} />
        </span>
      )}
      <span className={compact ? "sr-only" : undefined}>
        {status.label}
        {after !== undefined && <span className="tabular-nums" data-status-elapsed>{` · ${after}`}</span>}
      </span>
    </span>
  );
}

export function SessionStatus({ session, compact = false, className }: { session: SessionListing; compact?: boolean; className?: string }) {
  const phase = sessionPhase(session);
  return phase === null ? null : <PhaseStatus phase={phase} compact={compact} className={className} />;
}
