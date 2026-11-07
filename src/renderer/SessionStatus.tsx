import { AlertTriangle } from "lucide-react";
import { cn } from "cn";
import type { OpenPhase, SessionListing } from "../core/types";
import { PHASE, sessionPhase, TONE_DOT, TONE_TEXT, type Tone } from "./status";
import { elapsed } from "./time";

/** A phase's dot, pulsing while it changes on its own. */
export function PhaseDot({ phase, tone = PHASE[phase].tone }: { phase: OpenPhase; tone?: Tone }) {
  return (
    <span aria-hidden className="relative grid size-2 shrink-0 place-items-center" data-phase-dot={tone}>
      {PHASE[phase].live && <span className={cn("absolute size-2 animate-ping rounded-full opacity-60", TONE_DOT[tone])} />}
      <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
    </span>
  );
}

/**
 * What a brainstorm waits on, the one mark every list uses: its dot (a warning sign for a lost thread), its short name,
 * then `after`, such as how long the request has been open.
 */
export function PhaseStatus({ phase, after, className }: { phase: OpenPhase; after?: string; className?: string }) {
  const status = PHASE[phase];
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TONE_TEXT[status.tone], className)} data-session-status={phase}>
      {phase === "thread_lost" ? <AlertTriangle aria-hidden className="size-3" /> : <PhaseDot phase={phase} />}
      <span>
        {status.short}
        {after !== undefined && <span className="tabular-nums" data-status-elapsed>{` ${after}`}</span>}
      </span>
    </span>
  );
}

/** A listed brainstorm's open phase, counting from when it last moved, as T3 Code counts a thread's turn. */
export function SessionStatus({ session, now, className }: { session: SessionListing; now?: number; className?: string }) {
  const phase = sessionPhase(session);
  if (phase === null) return null;
  return <PhaseStatus phase={phase} after={now === undefined || session.lost ? undefined : elapsed(session.activeAt, now)} className={className} />;
}
