import { ChevronRight, Download, ExternalLink, History, PanelRight, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { BlockedHint, Hint, HintAnchor } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import type { BlockId, ContentHash, ExportResult, IterationN, IterationView, OpenPhase, RobAction, SessionId, SessionView } from "../core/types";
import { ExportButton } from "./Export";
import { COLLAPSE, COMPACT, COMPACT_LABEL, useHeaderFit } from "./headerAction";
import { Mark } from "./Mark";
import { PhaseActions, phaseActions, Regenerate, RegenerateLabel, RequestStatus } from "./Regenerate";
import { PhaseDot } from "./SessionStatus";
import { echoTone } from "./status";

/** The right panel's toggle, as T3 Code has it: pressed while the panel shows. */
export type PanelToggle = {
  readonly open: boolean;
  readonly onToggle: () => void;
  /** Why the toggle is off, when its pane has nothing to show yet. */
  readonly blocked?: string;
};

/**
 * The window header: the native title bar is gone, so this row moves the window, and the native buttons overlay its
 * right end. The sidebar's toggle comes here when the sidebar is hidden, and the Inspector's toggle sits last.
 */
export function TopBar({
  actions,
  panel,
  history,
  children,
}: {
  actions?: ReactNode;
  panel?: PanelToggle;
  /** The history filmstrip's toggle, just before the Inspector's. */
  history?: PanelToggle;
  children?: ReactNode;
}) {
  const { state, isMobile } = useSidebar();
  const header = useRef<HTMLElement>(null);
  const cluster = useRef<HTMLDivElement>(null);
  useHeaderFit(header);
  // The row its hints open left of: the right cluster, and the thread chip and request status before it. The text they
  // open over is the breadcrumb and its badge.
  const row = useMemo(
    () => ({
      anchor: () => {
        const actions = cluster.current;
        const status = header.current?.querySelector("[data-header-thread], [data-header-status]");
        if (actions === null || status == null) return actions;
        return {
          getBoundingClientRect: () => {
            const [s, a] = [status.getBoundingClientRect(), actions.getBoundingClientRect()];
            return DOMRect.fromRect({ x: s.left, y: a.top, width: a.right - s.left, height: a.height });
          },
        };
      },
      text: () => {
        const crumb = header.current?.querySelector("nav[aria-label=Breadcrumb]")?.getBoundingClientRect();
        if (crumb === undefined) return null;
        const badge = header.current?.querySelector("[data-iteration]")?.getBoundingClientRect();
        return { start: crumb.left, end: Math.max(crumb.right, badge?.right ?? 0) };
      },
    }),
    [],
  );
  return (
    <header
      ref={header}
      className="titlebar-inset flex h-12 shrink-0 items-center gap-3 pl-1"
      data-topbar
      data-drag-region
      data-sidebar-state={isMobile ? "collapsed" : state}
    >
      {/* With the sidebar away, its toggle and the mark move here, so the window still says whose it is. */}
      {(state === "collapsed" || isMobile) && (
        // The sidebar's own gap, so the mark keeps its x whichever side of Ctrl+B it is on.
        <div className="flex shrink-0 items-center gap-2" data-window-start>
          <SidebarTrigger />
          <Mark size={20} />
        </div>
      )}
      {children}
      {/* Its hints open left of the whole cluster and the status, over the title, so none covers a control or the status. */}
      <div ref={cluster} className="ml-auto flex shrink-0 items-center gap-2" data-header-actions>
        <HintAnchor.Provider value={row}>
          {actions}
          {history !== undefined &&
            (history.blocked !== undefined ? (
              <BlockedHint label={history.blocked} side="left" data-history-blocked>
                <Button variant="ghost" size="icon" aria-label="History" aria-pressed={false} disabled data-history-toggle>
                  <History aria-hidden />
                </Button>
              </BlockedHint>
            ) : (
              <Hint label={history.open ? "Hide the history" : "Show the history"} side="left">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="History"
                  aria-pressed={history.open}
                  onClick={history.onToggle}
                  data-history-toggle
                >
                  <History aria-hidden />
                </Button>
              </Hint>
            ))}
          {panel !== undefined && (
            <Hint label={panel.open ? "Collapse the Inspector" : "Show the Inspector"} side="left">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Inspector"
                aria-pressed={panel.open}
                onClick={panel.onToggle}
                data-inspector-toggle
              >
                <PanelRight aria-hidden />
              </Button>
            </Hint>
          )}
        </HintAnchor.Provider>
      </div>
    </header>
  );
}

export function SessionBar({
  title,
  project,
  view,
  iteration,
  past,
  selected,
  blockErrors: _blockErrors,
  send,
  exportHtml,
  panel,
  history,
  onOpen,
}: {
  title: string;
  /** The project's label, or null until the list has loaded. */
  project: string | null;
  view: SessionView | null;
  /** The iteration on the canvas, as it shows there. */
  iteration: IterationView | null;
  /** The past iteration on the canvas, or null at the latest. */
  past: IterationN | null;
  selected: BlockId | null;
  blockErrors: ReadonlyMap<ContentHash, string>;
  send: (action: RobAction) => Promise<SessionView | null>;
  exportHtml: () => Promise<ExportResult | null>;
  panel: PanelToggle;
  history: PanelToggle;
  /** Opens another branch of the brainstorm: the primary, from the breadcrumb. */
  onOpen: (id: SessionId) => void;
}) {
  const latest = view?.iteration?.n ?? null;
  // A brainstorm goes by its root's title; a branch that isn't the primary is named after it (ADR 009).
  const branch = view !== null && view.session.id !== view.tree.primary;
  const heading = view === null ? title : branch ? view.session.title : view.tree.root.title;
  return (
    <TopBar
      panel={panel}
      history={history}
      actions={
        view === null ? (
          // Held in place while the brainstorm loads, so the bar doesn't change shape when it arrives.
          <>
            <Button variant="accent" disabled data-regenerate-toggle>
              <RegenerateLabel />
            </Button>
            <Button variant="outline" disabled className={COMPACT} data-collapse={COLLAPSE.export} data-export>
              <Download data-icon="inline-start" aria-hidden />
              <span className={COMPACT_LABEL}>Export</span>
            </Button>
          </>
        ) : (
          <>
            {phaseActions(view).length > 0 && (
              <>
                <PhaseActions view={view} send={send} />
                {/* The request's actions, then the session's. */}
                <Separator orientation="vertical" data-phase-divider />
              </>
            )}
            <Regenerate view={view} selected={selected} past={past} send={send} />
            <ExportButton disabled={view.iteration === null} exportHtml={exportHtml} />
          </>
        )
      }
    >
      {/* 16 px into the card, on the first ink of the canvas bar and the Inspector's header under it. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-3 in-data-[sidebar-state=collapsed]:pl-0">
        <nav aria-label="Breadcrumb" className="flex min-w-0 max-w-fit flex-1 items-center gap-1 text-sm">
          {project !== null && (
            <>
              {/* A long title cuts itself, not the project down to a letter. */}
              <Truncate className="max-w-picker shrink-0 text-fg-muted" data-breadcrumb-project>
                {project}
              </Truncate>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            </>
          )}
          {/* On a branch the primary's title gives way well before the branch's own, whose floor comes first. */}
          {view !== null && branch && (
            <span className="flex min-w-0 shrink-8 items-center gap-1">
              <button
                type="button"
                onClick={() => onOpen(view.tree.primary)}
                className="flex min-w-0 max-w-menu rounded-sm text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
                data-breadcrumb-primary={view.tree.primary}
              >
                <Truncate data-breadcrumb-root>{view.tree.root.title}</Truncate>
              </button>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            </span>
          )}
          <h1 className="flex min-w-0 font-semibold">
            <Truncate data-session-title>{heading}</Truncate>
          </h1>
        </nav>
        {latest !== null && (
          <Badge data-iteration={past ?? latest} data-iteration-past={past !== null || undefined}>
            {past === null ? `Iteration ${latest}` : `Iteration ${past} of ${latest}`}
          </Badge>
        )}
        {view !== null && (
          <div className="flex shrink-0 items-center gap-2" data-header-thread>
            <Separator orientation="vertical" />
            <ThreadChip view={view} send={send} />
          </div>
        )}
        {/* In the past the badge names the iteration shown, so a closed request's result, about the latest, steps aside. */}
        {view !== null && (view.attachment.lostAt !== null || (view.request !== null && (past === null || view.request.phase.actions.length > 0))) && (
          <div className="flex shrink-0 items-center gap-2" data-header-status>
            <Separator orientation="vertical" />
            <RequestStatus view={view} />
          </div>
        )}
      </div>
    </TopBar>
  );
}

/** The open request's phase, or null once it has closed. */
function openPhase(view: SessionView): OpenPhase | null {
  const phase = view.request?.phase.phase;
  return phase === undefined || phase === "fulfilled" || phase === "withdrawn" ? null : phase;
}

/**
 * The brainstorm's T3 thread, which every branch shares (ADR 009): its state as a dot and a word, and a menu that
 * opens the thread in T3 or starts a fresh one, which moves every branch to it. A fresh thread is also the way back
 * from a lost one, so then the chip says so and the menu leads with it.
 */
function ThreadChip({ view, send }: { view: SessionView; send: (action: RobAction) => Promise<SessionView | null> }) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const lost = view.attachment.lostAt !== null;
  const phase = openPhase(view);
  const state = lost ? "lost" : (phase ?? "attached");
  const busy = phase !== null || (!view.regenerate.ok && view.regenerate.reason === "branch_busy");
  const blocked = phase !== null ? "A request is open. Let it finish or withdraw it first." : busy ? "Another branch's request is open on this thread" : null;
  const refresh = async () => {
    setStarting(true);
    const done = await send({ kind: "refresh_thread" });
    setStarting(false);
    if (done !== null) setOpen(false);
  };
  const fresh = (
    <FreshThread key="fresh" blocked={blocked} starting={starting} primary={lost} onClick={() => void refresh()} />
  );
  const link =
    view.thread === null || lost ? null : (
      <Button
        key="open"
        variant="outline"
        className="w-full"
        nativeButton={false}
        render={<a href={view.thread.link} target="_blank" rel="noreferrer" />}
        data-open-thread
      >
        <ExternalLink data-icon="inline-start" aria-hidden />
        Open in T3
      </Button>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label={lost ? "This brainstorm's thread is gone" : (view.thread?.title ?? "The brainstorm's T3 thread")} side="right">
        <PopoverTrigger render={<Button variant="ghost" className={COMPACT} data-collapse={COLLAPSE.thread} data-thread-chip data-thread={state} />}>
          <ThreadDot lost={lost} phase={phase} />
          <span className={cn(COMPACT_LABEL, lost ? "text-fg" : "text-fg-muted")}>{lost ? "Thread lost" : "Thread"}</span>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="start" data-thread-menu>
        <PopoverHeader
          heading={lost ? "Thread lost" : (view.thread?.title ?? "T3 thread")}
          description={
            lost
              ? "This brainstorm's thread is gone. Start a fresh one, and every branch carries on there."
              : "Every branch of this brainstorm works in this thread. A fresh one gives the agent a clean context."
          }
        />
        <div className="flex flex-col gap-1.5">{lost ? [fresh, link] : [link, fresh]}</div>
      </PopoverContent>
    </Popover>
  );
}

/** Green while the thread is attached and idle, the phase's dot while a request is open, muted once it is lost. */
function ThreadDot({ lost, phase }: { lost: boolean; phase: OpenPhase | null }) {
  if (lost) return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fg-muted" />;
  if (phase === null) return <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />;
  return <PhaseDot phase={phase} tone={echoTone(phase)} />;
}

function FreshThread({ blocked, starting, primary, onClick }: { blocked: string | null; starting: boolean; primary: boolean; onClick: () => void }) {
  const button = (
    <Button
      variant={primary ? "accent" : "outline"}
      className="w-full"
      disabled={blocked !== null || starting}
      onClick={onClick}
      data-refresh-thread
    >
      <RefreshCw data-icon="inline-start" aria-hidden className={starting ? "animate-spin" : undefined} />
      {starting ? "Starting a fresh thread" : "Start a fresh thread"}
    </Button>
  );
  if (blocked === null) return button;
  return (
    <BlockedHint label={blocked} side="left" data-refresh-blocked>
      {button}
    </BlockedHint>
  );
}
