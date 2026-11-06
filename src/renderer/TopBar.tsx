import { ChevronRight, Download, GitBranch, History, PanelRight } from "lucide-react";
import { useCallback, useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Hint, HintAnchor } from "@/components/ui/tooltip";
import type { BlockId, ContentHash, ExportResult, ForkInput, IterationN, IterationView, RobAction, SessionId, SessionView } from "../core/types";
import { ExportButton } from "./Export";
import { ForkButton } from "./Fork";
import { COMPACT, COMPACT_LABEL } from "./headerAction";
import { Mark } from "./Mark";
import { PhaseActions, phaseActions, Regenerate, RequestStatus } from "./Regenerate";

/** The right panel's toggle, as T3 Code has it: pressed while the panel shows. */
export type PanelToggle = { readonly open: boolean; readonly onToggle: () => void };

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
  // The row its hints open left of: the right cluster, and the request status before it when there is one.
  const row = useCallback(() => {
    const actions = cluster.current;
    const status = header.current?.querySelector("[data-header-status]");
    if (actions === null || status == null) return actions;
    return {
      getBoundingClientRect: () => {
        const [s, a] = [status.getBoundingClientRect(), actions.getBoundingClientRect()];
        return DOMRect.fromRect({ x: s.left, y: a.top, width: a.right - s.left, height: a.height });
      },
    };
  }, []);
  return (
    <header
      ref={header}
      className="@container/header titlebar-inset flex h-12 shrink-0 items-center gap-3 pl-1"
      data-topbar
      data-drag-region
      data-sidebar-state={isMobile ? "collapsed" : state}
    >
      {/* With the sidebar away, its toggle and the mark move here, so the window still says whose it is. */}
      {(state === "collapsed" || isMobile) && (
        <>
          <SidebarTrigger />
          <Mark size={20} />
        </>
      )}
      {children}
      {/* Its hints open left of the whole cluster and the status, over the title, so none covers a control or the status. */}
      <div ref={cluster} className="ml-auto flex shrink-0 items-center gap-2" data-header-actions>
        <HintAnchor.Provider value={row}>
          {actions}
          {history !== undefined && (
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
          )}
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
  blockErrors,
  send,
  fork,
  exportHtml,
  panel,
  history,
  onDiscard,
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
  fork: (input: ForkInput) => Promise<boolean>;
  exportHtml: () => Promise<ExportResult | null>;
  panel: PanelToggle;
  history: PanelToggle;
  /** Throws away a fork whose thread never started. */
  onDiscard: () => void;
  onOpen: (id: SessionId) => void;
}) {
  const latest = view?.iteration?.n ?? null;
  return (
    <TopBar
      panel={panel}
      history={history}
      actions={
        view === null ? (
          // Held in place while the brainstorm loads, so the bar doesn't change shape when it arrives.
          <>
            <Button variant="outline" disabled className={COMPACT} data-fork-toggle>
              <GitBranch data-icon="inline-start" aria-hidden />
              <span className={COMPACT_LABEL}>Fork</span>
            </Button>
            <Button variant="accent" disabled data-regenerate-toggle>
              Regenerate
            </Button>
            <Button variant="outline" disabled className={COMPACT} data-export>
              <Download data-icon="inline-start" aria-hidden />
              <span className={COMPACT_LABEL}>Export</span>
            </Button>
          </>
        ) : (
          <>
            {phaseActions(view).length > 0 && (
              <>
                <PhaseActions view={view} send={send} onDiscard={onDiscard} />
                {/* The request's actions, then the session's. */}
                <Separator orientation="vertical" className="h-4 self-center" data-phase-divider />
              </>
            )}
            <ForkButton view={view} iteration={iteration} past={past !== null} blockErrors={blockErrors} fork={fork} />
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
              <span className="max-w-picker shrink-0 truncate text-fg-muted" data-breadcrumb-project>
                {project}
              </span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            </>
          )}
          {view !== null && <Lineage view={view} onOpen={onOpen} />}
          <h1 className="truncate font-semibold" data-session-title>
            {title}
          </h1>
        </nav>
        {latest !== null && (
          <Badge data-iteration={past ?? latest} data-iteration-past={past !== null || undefined}>
            {past === null ? `Iteration ${latest}` : `Iteration ${past} of ${latest}`}
          </Badge>
        )}
        {view !== null && (view.request !== null || view.attachment.lostAt !== null) && (
          <div className="flex min-w-0 items-center gap-2" data-header-status>
            <Separator orientation="vertical" className="h-4 self-center" />
            <RequestStatus view={view} />
          </div>
        )}
      </div>
    </TopBar>
  );
}

const LINEAGE_SHOWN = 2;

/**
 * A fork's ancestors between the project and its title, oldest first, each a link to its brainstorm. A long line keeps
 * the nearest two and folds the rest into an ellipsis that names them.
 */
function Lineage({ view, onOpen }: { view: SessionView; onOpen: (id: SessionId) => void }) {
  const all = view.lineage;
  if (all.length === 0) return null;
  const folded = all.slice(0, Math.max(0, all.length - LINEAGE_SHOWN));
  const shown = all.slice(folded.length);
  return (
    <>
      {folded.length > 0 && (
        <>
          <Hint label={folded.map((a) => a.title).join(" › ")} side="right">
            <span tabIndex={0} className="shrink-0 text-fg-muted" data-lineage-folded={folded.length}>
              …
            </span>
          </Hint>
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
        </>
      )}
      {shown.map((a) => (
        <span key={a.id} className="flex min-w-0 shrink items-center gap-1">
          {a.gone ? (
            <span className="max-w-menu truncate text-fg-muted line-through" data-lineage={a.id} data-lineage-gone>
              {a.title}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onOpen(a.id)}
              className="max-w-menu truncate rounded-sm text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
              data-lineage={a.id}
            >
              {a.title}
            </button>
          )}
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
        </span>
      ))}
    </>
  );
}
