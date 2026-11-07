import { AlertTriangle } from "lucide-react";
import { cn } from "cn";
import type { OpenPhase, SessionListing } from "../core/types";
import { PHASE, sessionPhase, TONE_DOT, TONE_TEXT, type Tone } from "./status";
import { elapsed, elapsedSlot } from "./time";

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
 * How long a request has been open, the one running count the header, the Thread row, the sidebar and home share. It
 * keeps its unit's widest room, so the words before it never re-cut as it counts.
 */
export function Elapsed({ since, now, rank, className }: { since: string; now: number; rank?: number; className?: string }) {
  return (
    <span className={cn("count-slot data-collapsed:hidden", className)} data-count-slot={elapsedSlot(since, now)} data-collapse={rank} data-status-elapsed>
      <span>{elapsed(since, now)}</span>
    </span>
  );
}

/**
 * What a brainstorm waits on, the one mark every list uses: its dot (a warning sign for a lost thread), its short name,
 * then how long the request has been open. In a row that fits itself (`useRowFit`), the time gives way first and then
 * the name, kept for screen readers, so the ages' column never holds a bare count that reads as an age.
 */
export function PhaseStatus({
  phase,
  tone = PHASE[phase].tone,
  since,
  now,
  collapsible = false,
  className,
}: {
  phase: OpenPhase;
  tone?: Tone;
  since?: string;
  now?: number;
  collapsible?: boolean;
  className?: string;
}) {
  const status = PHASE[phase];
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", TONE_TEXT[tone], className)} data-session-status={phase} data-tone={tone}>
      {phase === "thread_lost" ? <AlertTriangle aria-hidden className="size-3" /> : <PhaseDot phase={phase} tone={tone} />}
      <span className="flex gap-1">
        <span data-collapse={collapsible ? 2 : undefined} data-status-words className="data-collapsed:sr-only">
          {status.short}
        </span>
        {since !== undefined && now !== undefined && (
          <>
            {/* The gap lays the words apart; the space keeps them apart in the text and for screen readers. */}
            {" "}
            <Elapsed since={since} now={now} rank={collapsible ? 1 : undefined} />
          </>
        )}
      </span>
    </span>
  );
}

/** A listed brainstorm's open phase, counting from when it last moved, as T3 Code counts a thread's turn. */
export function SessionStatus({ session, now, tone, collapsible, className }: { session: SessionListing; now?: number; tone?: Tone; collapsible?: boolean; className?: string }) {
  const phase = sessionPhase(session);
  if (phase === null) return null;
  return <PhaseStatus phase={phase} tone={tone} since={PHASE[phase].ended === true ? undefined : session.activeAt} now={now} collapsible={collapsible} className={className} />;
}
