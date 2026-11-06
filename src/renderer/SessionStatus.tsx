import { AlertTriangle } from "lucide-react";
import { cn } from "cn";
import type { OpenPhase, SessionListing } from "../core/types";

type Tone = "accent" | "info" | "warning" | "danger";

/**
 * What a brainstorm is waiting on, as its list row and card say it. The accent is the agent at work; a status hue is
 * something Rob has to look at. Working and sending pulse, since they change on their own.
 */
const STATUS: Record<OpenPhase, { readonly label: string; readonly tone: Tone; readonly live?: true }> = {
  sending: { label: "Sending", tone: "accent", live: true },
  queued: { label: "Queued in T3", tone: "accent" },
  working: { label: "Agent working", tone: "accent", live: true },
  asking: { label: "Agent asking", tone: "info" },
  no_change: { label: "No change", tone: "info" },
  previous_thread: { label: "Previous thread", tone: "warning" },
  thread_lost: { label: "Thread lost", tone: "warning" },
  send_failed: { label: "Send failed", tone: "danger" },
  run_failed: { label: "Run failed", tone: "danger" },
};

const DOT: Record<Tone, string> = { accent: "bg-accent", info: "bg-info", warning: "bg-warning", danger: "bg-danger" };
const TEXT: Record<Tone, string> = { accent: "text-accent", info: "text-info", warning: "text-warning", danger: "text-danger" };

/** A lost thread outranks any request, since nobody can answer it. */
export function sessionStatus(s: SessionListing): (typeof STATUS)[OpenPhase] | null {
  if (s.lost) return STATUS.thread_lost;
  return s.request === null ? null : STATUS[s.request];
}

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
