import { CircleCheck, CloudOff, Lightbulb, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Code } from "@/components/ui/kbd";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import type { SessionId, SessionListing } from "../core/types";
import { markdownText } from "./markdownSubset";
import { splitSettled } from "./sessionGroups";
import { SessionStatus } from "./SessionStatus";
import { SETTLE_SHORTCUT, settleLabel, settleUndoes } from "./settle";
import { ago, useNow } from "./time";

const START = (
  <>
    run <Code>/ux-brainstorm</Code> in a T3 thread on your project
  </>
);

/**
 * The main panel with no brainstorm open: every brainstorm as a card, newest activity first, then the settled ones,
 * newest settled first, under their own heading.
 */
export function HomeOverview({
  sessions,
  error,
  onRetry,
  onSession,
  onSettle,
}: {
  sessions: readonly SessionListing[] | null;
  error: string | null;
  onRetry: () => void;
  onSession: (id: SessionId) => void;
  onSettle: (session: SessionListing) => void;
}) {
  const now = useNow();
  const { active, settled } = useMemo(() => splitSettled(sessions ?? []), [sessions]);
  const card = (s: SessionListing) => (
    <li key={s.id} className="grid min-w-0">
      <OverviewCard session={s} now={now} onOpen={() => onSession(s.id)} onSettle={() => onSettle(s)} />
    </li>
  );
  const failed = sessions === null && error !== null;
  const empty = sessions !== null && sessions.length === 0;
  // The heading holds in every state, so loading, empty and failed home keep the page's frame. Empty drops the hint,
  // which its own message says.
  return (
    <ScrollPane inset={6} className="size-full" data-home-overview>
      <div className="flex min-h-full flex-col gap-5 py-6">
        <PageHeader
          heading="All brainstorms"
          description={failed || empty ? undefined : <span data-home-hint>To start a new brainstorm, {START}.</span>}
        />
        {failed ? (
          <ListError message={error} onRetry={onRetry} />
        ) : empty ? (
          <HomeEmpty />
        ) : sessions !== null && active.length === 0 ? (
          <p className="text-sm text-fg-muted" data-all-settled>
            Every brainstorm is settled.
          </p>
        ) : (
          // Cards hug their own content, so a card with no brief never carries a blank band to match its row.
          <ul className="grid-overview grid gap-3" aria-busy={sessions === null || undefined}>
            {sessions === null
              ? [true, false, false, true, false, false].map((brief, i) => (
                  <li key={i} className="flex flex-col gap-1.5 rounded-lg bg-card p-4 ring-1 ring-border" data-overview-skeleton>
                    {/* One bar a line, each as tall as the card's text, so the cards that replace these don't move. */}
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-5 w-2/3" />
                    {brief && <Skeleton className="h-4.5 w-full" />}
                    {brief && <Skeleton className="h-4.5 w-1/2" />}
                    <Skeleton className="mt-1 h-4 w-1/3" />
                  </li>
                ))
              : active.map(card)}
          </ul>
        )}
        {settled.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="settled-heading" data-overview-settled>
            <h2 id="settled-heading" className="flex items-center gap-2 text-sm font-medium text-fg-muted">
              Settled
              <Badge>{settled.length}</Badge>
            </h2>
            <ul className="grid-overview grid gap-3">{settled.map(card)}</ul>
          </section>
        )}
      </div>
    </ScrollPane>
  );
}

/**
 * One brainstorm. The card opens it; the settle control sits over its corner as a sibling, since a button can't hold
 * another, and shows on hover or focus. A settled card is muted and counts from when it was settled.
 */
function OverviewCard({ session: s, now, onOpen, onSettle }: { session: SessionListing; now: number; onOpen: () => void; onSettle: () => void }) {
  const brief = markdownText(s.brief).trim();
  const settledAt = s.settlement.state === "settled" ? s.settlement.at : null;
  const label = settleLabel(s);
  return (
    <div className="group/card relative flex min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full min-w-0 flex-1 flex-col gap-1.5 rounded-lg bg-card p-4 text-left shadow-xs ring-1 ring-border transition-shadow outline-none hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-ring"
        data-overview-session={s.id}
        data-lost={s.lost || undefined}
        data-settled={settledAt !== null || undefined}
      >
        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="truncate">{s.projectName ?? "Other project"}</span>
          {settledAt !== null ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5" data-session-status="settled">
              <CircleCheck aria-hidden className="size-3" />
              Settled
            </span>
          ) : (
            <SessionStatus session={s} className="ml-auto" />
          )}
        </span>
        <span className={cn("truncate text-base font-semibold", settledAt !== null && "text-fg-muted")}>{s.title}</span>
        {brief !== "" && <span className="line-clamp-2 text-sm text-fg-muted">{brief}</span>}
        <span className="mt-auto flex items-center gap-1 pt-1 text-xs whitespace-nowrap text-fg-muted" data-overview-footer>
          <span className="tabular-nums">{s.latest === null ? "No iterations yet" : `Iteration ${s.latest}`}</span>
          <span aria-hidden>·</span>
          <span>{settledAt !== null ? `Settled ${ago(settledAt, now)}` : ago(s.activeAt, now)}</span>
        </span>
      </button>
      <span className="absolute right-3 bottom-3 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100">
        <Hint label={label} shortcut={SETTLE_SHORTCUT} side="top">
          <Button variant="ghost" size="icon-xs" onClick={onSettle} aria-label={`${label} ${s.title}`} data-settle={s.id}>
            {settleUndoes(s) ? <Undo2 aria-hidden /> : <CircleCheck aria-hidden />}
          </Button>
        </Hint>
      </span>
    </div>
  );
}

function HomeEmpty() {
  return (
    <Empty className="rounded-none" data-home-empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lightbulb aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No brainstorms yet</EmptyTitle>
        <EmptyDescription>To start one, {START}. It appears here as soon as the agent creates it.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty className="rounded-none" data-home-error>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudOff aria-hidden className="text-danger" />
        </EmptyMedia>
        <EmptyTitle>Your brainstorms didn't load</EmptyTitle>
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
