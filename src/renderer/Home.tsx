import { AlertTriangle, CloudOff, Lightbulb } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { SessionId, SessionListing } from "../core/types";
import { markdownText } from "./markdownSubset";
import { ago, useNow } from "./time";

const START = (
  <>
    run <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-fg">/ux-brainstorm</code> in a T3 thread on your project
  </>
);

/** The main panel with no brainstorm open: every brainstorm as a card, newest activity first. */
export function HomeOverview({
  sessions,
  error,
  onRetry,
  onSession,
}: {
  sessions: readonly SessionListing[] | null;
  error: string | null;
  onRetry: () => void;
  onSession: (id: SessionId) => void;
}) {
  const now = useNow();
  const sorted = useMemo(() => [...(sessions ?? [])].sort((a, b) => (a.activeAt < b.activeAt ? 1 : a.activeAt > b.activeAt ? -1 : 0)), [sessions]);
  if (sessions === null && error !== null) return <ListError message={error} onRetry={onRetry} />;
  if (sessions !== null && sessions.length === 0) return <HomeEmpty />;
  return (
    <div className="size-full overflow-y-auto" data-home-overview>
      <div className="grid gap-4 p-6">
        <p className="text-sm text-fg-muted" data-home-hint>
          To start a new brainstorm, {START}.
        </p>
        <ul className="grid-overview grid gap-3" aria-busy={sessions === null || undefined}>
          {sessions === null
            ? [0, 1, 2, 3, 4, 5].map((i) => (
                <li key={i} className="flex flex-col gap-1.5 rounded-lg bg-card p-4 ring-1 ring-border" data-overview-skeleton>
                  {/* One bar a line, each as tall as the card's text, so the cards that replace these don't move. */}
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4.5 w-full" />
                  <Skeleton className="h-4.5 w-1/2" />
                  <Skeleton className="mt-1 h-4 w-1/3" />
                </li>
              ))
            : sorted.map((s) => (
                <li key={s.id} className="grid">
                  <OverviewCard session={s} now={now} onOpen={() => onSession(s.id)} />
                </li>
              ))}
        </ul>
      </div>
    </div>
  );
}

function OverviewCard({ session: s, now, onOpen }: { session: SessionListing; now: number; onOpen: () => void }) {
  const brief = markdownText(s.brief).trim();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-1.5 rounded-lg bg-card p-4 text-left shadow-xs ring-1 ring-border transition-shadow outline-none hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring"
      data-overview-session={s.id}
      data-lost={s.lost || undefined}
    >
      <span className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="truncate">{s.projectName ?? "Other project"}</span>
        {/* One status place a card: a lost thread outranks a wait, since nobody can answer it. */}
        {s.lost ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-warning" data-session-lost>
            <AlertTriangle aria-hidden className="size-3" />
            Thread lost
          </span>
        ) : (
          s.openRequest && (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-accent" data-session-busy>
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              Waiting on the agent
            </span>
          )
        )}
      </span>
      <span className="truncate text-base font-semibold">{s.title}</span>
      {brief !== "" && <span className="line-clamp-2 text-sm text-fg-muted">{brief}</span>}
      <span className="mt-auto flex items-center gap-1 pt-1 text-xs whitespace-nowrap text-fg-muted" data-overview-footer>
        <span className="tabular-nums">{s.latest === null ? "No iterations yet" : `Iteration ${s.latest}`}</span>
        <span aria-hidden>·</span>
        <span>{ago(s.activeAt, now)}</span>
      </span>
    </button>
  );
}

function HomeEmpty() {
  return (
    <Empty className="size-full rounded-none" data-home-empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lightbulb aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No brainstorms yet</EmptyTitle>
        <EmptyDescription>
          To start one, {START}. It appears here as soon as the agent creates it.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty className="size-full rounded-none" data-home-error>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudOff aria-hidden />
        </EmptyMedia>
        <EmptyTitle>Couldn't load your brainstorms</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry} data-home-retry>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
