import { CircleCheck, CloudOff, Lightbulb, SearchX, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Code } from "@/components/ui/kbd";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { DEFAULT_HOME, type HomeQuery, type HomeStatus } from "../core/prefs";
import type { SessionId, SessionListing } from "../core/types";
import { HomeFilters, useSearchShortcut } from "./HomeFilters";
import { liveProjects, projectOptions, queryHome } from "./homeQuery";
import { markdownText } from "./markdownSubset";
import { CardPreview, type LoadPreview } from "./Preview";
import { SessionStatus } from "./SessionStatus";
import { SETTLE_SHORTCUT, settleLabel, settleUndoes } from "./settle";
import { ago, useNow } from "./time";

const START = (
  <>
    run <Code>/ux-brainstorm</Code> in a T3 thread on your project
  </>
);

/**
 * The main panel with no brainstorm open: the brainstorms that match home's search and filters, as cards. Under All,
 * the settled ones follow under their own heading.
 */
export function HomeOverview({
  sessions,
  error,
  onRetry,
  onSession,
  onSettle,
  revisions,
  loadPreview,
  query,
  onQuery,
}: {
  sessions: readonly SessionListing[] | null;
  error: string | null;
  onRetry: () => void;
  onSession: (id: SessionId) => void;
  onSettle: (session: SessionListing) => void;
  /** Bumped for a brainstorm whenever it changes, so its preview reloads. */
  revisions: ReadonlyMap<SessionId, number>;
  loadPreview: LoadPreview;
  query: HomeQuery;
  onQuery: (query: HomeQuery) => void;
}) {
  const now = useNow();
  const [search, setSearch] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useSearchShortcut(field);
  const all = sessions ?? [];
  const result = useMemo(() => queryHome(all, query, search), [all, query, search]);
  const projects = useMemo(() => projectOptions(all), [all]);
  const selected = useMemo(() => liveProjects(query, all), [query, all]);
  const card = (s: SessionListing) => (
    <li key={s.id} className="grid min-w-0">
      <OverviewCard
        session={s}
        now={now}
        revision={revisions.get(s.id) ?? 0}
        loadPreview={loadPreview}
        onOpen={() => onSession(s.id)}
        onSettle={() => onSettle(s)}
      />
    </li>
  );
  const failed = sessions === null && error !== null;
  const empty = sessions !== null && sessions.length === 0;
  const narrowed = search.trim() !== "" || selected.size > 0;
  const nothing = sessions !== null && result.shown.length === 0 && result.settled.length === 0;
  const clear = () => {
    setSearch("");
    onQuery({ ...query, status: DEFAULT_HOME.status, projects: [] });
  };
  // The heading holds in every state, so loading, empty and failed home keep the page's frame. Empty drops the hint,
  // which its own message says.
  return (
    <ScrollPane inset={6} className="size-full" data-home-overview>
      <div className="flex min-h-full flex-col gap-5 py-6">
        <PageHeader
          heading="All brainstorms"
          description={failed || empty ? undefined : <span data-home-hint>To start a new brainstorm, {START}.</span>}
        />
        {!failed && !empty && (
          <HomeFilters
            field={field}
            search={search}
            onSearch={setSearch}
            query={query}
            onQuery={onQuery}
            counts={result.counts}
            projects={projects}
            selected={selected}
          />
        )}
        {failed ? (
          <ListError message={error} onRetry={onRetry} />
        ) : empty ? (
          <HomeEmpty />
        ) : nothing && !narrowed && query.status === "active" && result.counts.settled > 0 ? (
          <NoneShown
            title="Every brainstorm is settled"
            description="Settled brainstorms wait under Settled. A new request or commit brings one back on its own."
            action="Show settled"
            onAction={() => onQuery({ ...query, status: "settled" })}
            data="all-settled"
          />
        ) : nothing ? (
          <NoneShown
            title="No brainstorms match"
            description={narrowed ? "Nothing matches the search and filters as they are." : `Nothing is ${STATUS_WORDS[query.status]} right now.`}
            action="Clear search and filters"
            onAction={clear}
            data="no-match"
          />
        ) : (
          <ul className="grid-overview grid gap-3" aria-busy={sessions === null || undefined} data-home-results>
            {sessions === null
              ? [true, false, false, true, false, false].map((brief, i) => (
                  <li key={i} className="flex flex-col rounded-lg bg-card ring-1 ring-border" data-overview-skeleton>
                    <div className="h-preview rounded-t-lg border-b bg-canvas" />
                    {/* One bar a line, each as tall as the card's text, so the cards that replace these don't move. */}
                    <div className="flex flex-col gap-1.5 p-4">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-5 w-2/3" />
                      {brief && <Skeleton className="h-4.5 w-full" />}
                      {brief && <Skeleton className="h-4.5 w-1/2" />}
                      <Skeleton className="mt-1 h-4 w-1/3" />
                    </div>
                  </li>
                ))
              : result.shown.map(card)}
          </ul>
        )}
        {result.settled.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="settled-heading" data-overview-settled>
            <h2 id="settled-heading" className="flex items-center gap-2 text-sm font-medium text-fg-muted">
              Settled
              <Badge>{result.settled.length}</Badge>
            </h2>
            <ul className="grid-overview grid gap-3">{result.settled.map(card)}</ul>
          </section>
        )}
      </div>
    </ScrollPane>
  );
}

const STATUS_WORDS: Record<HomeStatus, string> = { active: "active", attention: "waiting on you", settled: "settled", all: "here" };

/** Home with cards to show but none the search and filters let through, and the one step that shows some again. */
function NoneShown({ title, description, action, onAction, data }: { title: string; description: string; action: string; onAction: () => void; data: string }) {
  return (
    <Empty className="rounded-none" data-home-none={data}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onAction} data-home-none-action>
          {action}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/**
 * One brainstorm: its preview, then its project, status, title, brief and footer. The title is the button that opens
 * it, stretched over the whole card, so the preview and the text are a click target without a button holding a frame.
 * The settle control sits over the bottom right corner, above the stretched button, and shows on hover or focus. A
 * settled card is muted and counts from when it was settled.
 */
function OverviewCard({
  session: s,
  now,
  revision,
  loadPreview,
  onOpen,
  onSettle,
}: {
  session: SessionListing;
  now: number;
  revision: number;
  loadPreview: LoadPreview;
  onOpen: () => void;
  onSettle: () => void;
}) {
  const brief = markdownText(s.brief).trim();
  const settledAt = s.settlement.state === "settled" ? s.settlement.at : null;
  const label = settleLabel(s);
  return (
    <div
      className="group/card relative flex h-full min-w-0 flex-col rounded-lg bg-card shadow-xs ring-1 ring-border transition-shadow has-[[data-card-open]:hover]:ring-border-strong has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-ring"
      data-overview-session={s.id}
      data-lost={s.lost || undefined}
      data-settled={settledAt !== null || undefined}
    >
      <CardPreview id={s.id} revision={revision} load={loadPreview} muted={settledAt !== null} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
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
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "truncate text-left text-base font-semibold outline-none after:absolute after:inset-0 after:rounded-lg",
            settledAt !== null && "text-fg-muted",
          )}
          data-card-open
        >
          {s.title}
        </button>
        {brief !== "" && <span className="line-clamp-2 text-sm text-fg-muted">{brief}</span>}
        <span className="mt-auto flex items-center gap-1 pt-1 text-xs whitespace-nowrap text-fg-muted" data-overview-footer>
          <span className="tabular-nums">{s.latest === null ? "No iterations yet" : `Iteration ${s.latest}`}</span>
          <span aria-hidden>·</span>
          <span>{settledAt !== null ? `Settled ${ago(settledAt, now)}` : ago(s.activeAt, now)}</span>
        </span>
      </div>
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
