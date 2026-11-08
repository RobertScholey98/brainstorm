import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import type { AgentWork, OpenPhase, ThreadId } from "../core/types";
import type { Api } from "./api";
import { Elapsed, PhaseDot } from "./SessionStatus";
import { TONE_TEXT, type Tone } from "./status";
import { useNow } from "./time";

/** How often a card asks T3 what its agent is doing: often while it works, rarely once it stopped. */
const LIVE_MS = 3_000;
const SETTLED_MS = 15_000;

/**
 * What the agent in `thread` is doing with the work Brainstorm handed it, kept current while the card shows. Null until
 * T3 first answers.
 */
export function useAgentWork(api: Api, thread: ThreadId | null): AgentWork | null {
  const [work, setWork] = useState<AgentWork | null>(null);
  useEffect(() => {
    setWork(null);
    if (thread === null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const r = await api.agentWork(thread);
      if (stopped) return;
      if (r.ok) setWork(r.data);
      const live = !r.ok || r.data.phase === "waiting" || r.data.phase === "working" || r.data.phase === "asking";
      timer = setTimeout(() => void poll(), live ? LIVE_MS : SETTLED_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, thread]);
  return work;
}

/** Each phase in the words and hue the brainstorm's own request phases use, so an agent at work reads the same anywhere. */
const WORK: Record<AgentWork["phase"], { readonly label: string; readonly tone: Tone; readonly phase: OpenPhase | null; readonly counts?: true }> = {
  waiting: { label: "Waiting for the agent", tone: "muted", phase: "queued", counts: true },
  working: { label: "Agent working", tone: "accent", phase: "working", counts: true },
  asking: { label: "Agent asking you in T3", tone: "info", phase: "asking" },
  finished: { label: "Agent finished", tone: "success", phase: null },
  failed: { label: "The agent's run failed", tone: "danger", phase: "run_failed" },
  missing: { label: "The thread is gone", tone: "warning", phase: "thread_lost" },
};

/**
 * One agent's work, as Claude Code shows a background task: its phase with how long it has run, the end of its latest
 * reply, and the thread to open. `since` is when Brainstorm handed the work over. `compact` shows Open thread as its icon,
 * for the Inspector's narrow column.
 */
export function AgentWorkStatus({
  work,
  since,
  link,
  compact = false,
  className,
}: {
  work: AgentWork | null;
  since: string;
  link: string | null;
  compact?: boolean;
  className?: string;
}) {
  const now = useNow(work?.phase === "working" || work?.phase === "waiting" ? 1_000 : undefined);
  const shown = work ?? { phase: "waiting" as const, lastLine: null, link };
  const w = WORK[shown.phase];
  const href = shown.link ?? link;
  return (
    <div className={cn("grid min-w-0 gap-1", className)} data-agent-work={work?.phase ?? "unknown"}>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className={cn("flex shrink-0 items-center gap-1.5 font-medium", TONE_TEXT[w.tone])}>
          {w.phase === null ? <span aria-hidden className="size-1.5 rounded-full bg-success" /> : <PhaseDot phase={w.phase} tone={w.tone} />}
          {work === null ? "Asking T3…" : w.label}
        </span>
        {w.counts === true && work !== null && <Elapsed since={since} now={now} className="text-fg-muted tabular-nums" />}
        {href !== null &&
          (compact ? (
            <Hint label="Open thread" side="left">
              <Button variant="ghost" size="icon-xs" className="ml-auto shrink-0" aria-label="Open thread" nativeButton={false} render={<a href={href} target="_blank" rel="noreferrer" />} data-agent-thread>
                <ExternalLink aria-hidden />
              </Button>
            </Hint>
          ) : (
            <Button variant="ghost" size="xs" className="ml-auto shrink-0" nativeButton={false} render={<a href={href} target="_blank" rel="noreferrer" />} data-agent-thread>
              <ExternalLink data-icon="inline-start" aria-hidden />
              Open thread
            </Button>
          ))}
      </div>
      {shown.lastLine !== null && (
        <p className="flex min-w-0 text-xs text-fg-muted" data-agent-last-line>
          <Truncate>{shown.lastLine}</Truncate>
        </p>
      )}
    </div>
  );
}
