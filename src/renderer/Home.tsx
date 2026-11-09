import { CircleCheck, CloudOff, Lightbulb, SearchX, Undo2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Code } from "@/components/ui/kbd";
import { PageHeader } from "@/components/ui/page-header";
import { ScrollPane } from "@/components/ui/scroll-pane";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { Count } from "@/components/ui/count";
import { DEFAULT_HOME, type HomeQuery, type HomeStatus } from "../core/prefs";
import type { SessionId, SessionListing } from "../core/types";
import { HomeFilters, useSearchShortcut } from "./HomeFilters";
import { briefMatch, liveProjects, projectOptions, queryHome, type BriefMatch } from "./homeQuery";
import { markdownText } from "./markdownSubset";
import { CardPreview, type LoadPreview, PreviewSkeleton } from "./Preview";
import { SessionStatus } from "./SessionStatus";
import { SETTLE_SHORTCUT, settleLabel, settleUndoes } from "./settle";
import { sessionPhase } from "./status";
import { age, useNow } from "./time";

const START = (
  <>
    run <Code>/use-brainstorm</Code> in a T3 thread on your project
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
  const now = useNow(sessions?.some((s) => sessionPhase(s) !== null) === true ? 1_000 : undefined);
  const [search, setSearch] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useSearchShortcut(field);
  const all = sessions ?? [];
  const result = useMemo(() => queryHome(all, query, search), [all, query, search]);
  const projects = useMemo(() => projectOptions(all, query.status, search), [all, query.status, search]);
  const selected = useMemo(() => liveProjects(query, all), [query, all]);
  const card = (s: SessionListing) => (
    <li key={s.id} className="grid min-w-0">
      <OverviewCard
        session={s}
        search={search}
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
  // The heading, the hint and the query row hold in every state, so loading, empty and failed home keep the page's
  // frame. With nothing to ask yet, or nothing loaded, the row is off. Only what they find scrolls.
  return (
    <div className="flex size-full flex-col" data-home-overview>
      <ScrollPane
        inset={6}
        data-home-scroll
        head={
          <div className="flex flex-col gap-5 px-6 pt-6 pb-2" data-home-head>
            <PageHeader heading="All brainstorms" description={<span data-home-hint>To start a new brainstorm, {START}.</span>} />
            <HomeFilters
              disabled={failed || empty}
              field={field}
              search={search}
              onSearch={setSearch}
              query={query}
              onQuery={onQuery}
              counts={sessions === null ? null : result.counts}
              projects={projects}
              selected={selected}
            />
          </div>
        }
      >
        <div className="flex min-h-full flex-col gap-5 pt-3 pb-6">
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
              description={noMatch(query.status, search.trim(), selected.size > 0, result.counts.all > 0)}
              action={clearLabel(search.trim() !== "", selected.size > 0 || query.status !== DEFAULT_HOME.status)}
              onAction={clear}
              data="no-match"
            />
          ) : (
            <ul className="grid-overview grid gap-3" aria-busy={sessions === null || undefined} data-home-results>
              {sessions === null
                ? [true, false, false, true, false, false].map((brief, i) => (
                    <li key={i} className="flex flex-col rounded-lg bg-card shadow-xs ring-1 ring-border" data-overview-skeleton>
                      <PreviewSkeleton />
                      {/* One bar a line, each as tall as the card's text, so the cards that replace these don't move. */}
                      <div className="flex flex-col gap-1.5 p-4">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className={cn("h-4.5", brief ? "w-full" : "invisible")} />
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
                <Count>{result.settled.length}</Count>
              </h2>
              <ul className="grid-overview grid gap-3">{result.settled.map(card)}</ul>
            </section>
          )}
        </div>
      </ScrollPane>
    </div>
  );
}

const STATUS_WORDS: Record<HomeStatus, string> = { active: "active", attention: "waiting on you", settled: "settled", all: "here" };

/**
 * Why nothing shows, naming only what is narrowing it, so the copy never blames a filter that isn't on. A search is
 * named by its words, so the line says what the title above it doesn't, and it opens "Nothing" so it never echoes the
 * title's "No brainstorms". `elsewhere` is whether another status holds a match; if none does, the status didn't
 * narrow anything, so isn't named.
 */
function noMatch(shown: HomeStatus, search: string, picked: boolean, elsewhere: boolean): string {
  const status = elsewhere ? shown : "all";
  const has = `has “${search}” in its title or brief`;
  const words = status === "all" ? "" : ` ${STATUS_WORDS[status]}`;
  if (search !== "" && picked) return `Nothing${words} in the projects you picked ${has}.`;
  if (search !== "") return `Nothing ${STATUS_WORDS[status]} ${has}.`;
  if (picked) return `The projects you picked have nothing${words || " in them"}.`;
  return `Nothing is ${STATUS_WORDS[status]} right now.`;
}

const clearLabel = (searched: boolean, filtered: boolean) =>
  searched && filtered ? "Clear search and filters" : searched ? "Clear search" : "Clear filters";

/** Home with cards to show but none the search and filters let through, and the one step that shows some again. */
/** Every message home shows in place of cards starts where the first card would, so the page top never moves. */
const MESSAGE = "flex-none rounded-none pt-0 pb-12";

function NoneShown({ title, description, action, onAction, data }: { title: string; description: string; action: string; onAction: () => void; data: string }) {
  return (
    // Under the query row it answers, not mid-page: the page's height says nothing about this.
    <Empty align="start" className={MESSAGE} data-home-none={data}>
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
 * One brainstorm: its preview, then its project and status, title, one line of what it is, and footer. Every card has
 * those four lines, so a row of cards is one height with no blank in any of them; the one line is the brief, cut
 * to fit. The title is the button that opens it, stretched over the whole card, so the
 * preview and the text are a click target without a button holding a frame. The settle control sits over the bottom
 * right corner, above the stretched button, and shows on hover or focus. A settled card is a ghost of an active one,
 * with no fill or lift and its still greyed, and counts from when it was settled.
 */
function OverviewCard({
  session: s,
  search,
  now,
  revision,
  loadPreview,
  onOpen,
  onSettle,
}: {
  session: SessionListing;
  search: string;
  now: number;
  revision: number;
  loadPreview: LoadPreview;
  onOpen: () => void;
  onSettle: () => void;
}) {
  const brief = markdownText(s.brief).trim();
  // With nothing under its title, the title takes that line's room, so a long one wraps to a second line rather than cut beside a blank.
  const lone = brief === "";
  const settledAt = s.settlement.state === "settled" ? s.settlement.at : null;
  const found = briefMatch(s.title, brief, search);
  const label = settleLabel(s);
  return (
    <div
      className={cn(
        "group/card relative flex h-full min-w-0 flex-col rounded-lg ring-1 ring-border transition has-[[data-card-open]:hover]:ring-border-strong has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-ring",
        // Hover lifts the card: a shadow in light, and in dark, where a shadow doesn't read, a lighter fill.
        settledAt === null
          ? "bg-card shadow-xs has-[[data-card-open]:hover]:shadow-sm dark:has-[[data-card-open]:hover]:bg-muted"
          : "bg-transparent has-[[data-card-open]:hover]:bg-hover",
      )}
      data-overview-session={s.id}
      data-lost={s.lost || undefined}
      data-settled={settledAt !== null || undefined}
    >
      <CardPreview id={s.id} revision={revision} load={loadPreview} muted={settledAt !== null} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
        <span className="flex items-center gap-2 text-xs text-fg-muted">
          <Truncate>{s.projectName ?? "Other project"}</Truncate>
          {settledAt !== null ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5" data-session-status="settled">
              <CircleCheck aria-hidden className="size-3" />
              Settled
            </span>
          ) : (
            <SessionStatus session={s} now={now} className="ml-auto" />
          )}
        </span>
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "flex min-w-0 text-left text-base font-semibold outline-none after:absolute after:inset-0 after:rounded-lg",
            settledAt !== null && "text-fg-muted",
            lone && "grid *:col-start-1 *:row-start-1",
          )}
          data-card-open
        >
          {lone ? (
            <>
              {/* Holds the title's line and the brief's, so this card stays the height of the rest. */}
              <span aria-hidden className="invisible flex flex-col gap-1.5">
                <span className="h-5" />
                <span className="h-4.5" />
              </span>
              <span className="line-clamp-2 self-start text-pretty" data-card-title-wraps>
                {s.title}
              </span>
            </>
          ) : (
            <Truncate>{s.title}</Truncate>
          )}
        </button>
        {lone ? null : found !== null ? (
          <BriefFragment found={found} settled={settledAt !== null} />
        ) : (
          <Truncate className="h-4.5 text-sm text-fg-muted" data-card-brief>
            {brief}
          </Truncate>
        )}
        <span className="mt-auto flex items-center gap-1 pt-1 text-xs whitespace-nowrap text-fg-muted" data-overview-footer>
          {/* A brainstorm with no iteration says so once, in its preview, so the footer gives only its age. */}
          {s.latest !== null && (
            <>
              <span className="tabular-nums">Iteration {s.latest}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>{settledAt !== null ? `Settled ${age(settledAt, now)}` : age(s.activeAt, now)}</span>
        </span>
      </div>
      <span className="absolute right-3 bottom-3 text-fg-muted opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100">
        <Hint label={label} shortcut={SETTLE_SHORTCUT} side="top">
          {/* Named, as the row's action is, so the glyph never reads as the Settled status it shares. */}
          <Button variant="ghost" size="xs" onClick={onSettle} aria-label={`${label} ${s.title}`} data-settle={s.id}>
            {settleUndoes(s) ? <Undo2 aria-hidden /> : <CircleCheck aria-hidden />}
            {label}
          </Button>
        </Hint>
      </span>
    </div>
  );
}

/**
 * The brief on a card the search found through it, from just before the match, so the match shows whatever the card's
 * width. The match takes the title's ink, at medium weight, and the rest of the brief cuts to fit.
 */
function BriefFragment({ found, settled }: { found: BriefMatch; settled: boolean }) {
  // A space at a part's edge would collapse there, so it is held as a no-break space.
  const held = (text: string, edge: RegExp) => text.replace(edge, "\u00a0");
  return (
    <span className="flex h-4.5 min-w-0 overflow-hidden text-sm text-fg-muted" data-card-brief data-card-match>
      <span className="shrink-0 whitespace-nowrap">{held(found.before, / $/u)}</span>
      <mark className={cn("shrink-0 bg-transparent font-medium whitespace-nowrap", settled ? "text-fg-muted" : "text-fg")}>{found.match}</mark>
      <Truncate>{held(found.after, /^ /u)}</Truncate>
    </span>
  );
}

function HomeEmpty() {
  return (
    <Empty align="start" className={MESSAGE} data-home-empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Lightbulb aria-hidden />
        </EmptyMedia>
        <EmptyTitle>No brainstorms yet</EmptyTitle>
        <EmptyDescription>Your first one appears here as soon as the agent creates it.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ListError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Empty align="start" tone="danger" className={MESSAGE} data-home-error>
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
