import { ChevronRight, PanelRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Hint, HintAnchor } from "@/components/ui/tooltip";
import type { BlockId, ExportResult, RobAction, SessionView } from "../core/types";
import { ExportButton } from "./Export";
import { Mark } from "./Mark";
import { PhaseActions, phaseActions, Regenerate, RequestStatus } from "./Regenerate";

/** The right panel's toggle, as T3 Code has it: pressed while the panel shows. */
export type PanelToggle = { readonly open: boolean; readonly onToggle: () => void };

/**
 * The window header: the native title bar is gone, so this row moves the window, and the native buttons overlay its
 * right end. The sidebar's toggle comes here when the sidebar is hidden, and the Inspector's toggle sits last.
 */
export function TopBar({ actions, panel, children }: { actions?: ReactNode; panel?: PanelToggle; children?: ReactNode }) {
  const { state, isMobile } = useSidebar();
  const cluster = useRef<HTMLDivElement>(null);
  return (
    <header className="titlebar-inset flex h-12 shrink-0 items-center gap-3 pl-1" data-topbar data-drag-region>
      {/* With the sidebar away, its toggle and the mark move here, so the window still says whose it is. */}
      {(state === "collapsed" || isMobile) && (
        <>
          <SidebarTrigger />
          <Mark size={20} />
        </>
      )}
      {children}
      {/* Its hints open left of the whole cluster, over the breadcrumb, so none covers a neighbouring control. */}
      <div ref={cluster} className="ml-auto flex shrink-0 items-center gap-2" data-header-actions>
        <HintAnchor.Provider value={cluster}>
          {actions}
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
  selected,
  send,
  exportHtml,
  panel,
}: {
  title: string;
  /** The project's label, or null until the list has loaded. */
  project: string | null;
  view: SessionView | null;
  selected: BlockId | null;
  send: (action: RobAction) => Promise<SessionView | null>;
  exportHtml: () => Promise<ExportResult | null>;
  panel: PanelToggle;
}) {
  return (
    <TopBar
      panel={panel}
      actions={
        view === null ? (
          // Held in place while the brainstorm loads, so the bar doesn't change shape when it arrives.
          <>
            <Button variant="accent" disabled data-regenerate-toggle>
              Regenerate
            </Button>
            <Button variant="outline" disabled data-export>
              Export
            </Button>
          </>
        ) : (
          <>
            {phaseActions(view).length > 0 && (
              <>
                <PhaseActions view={view} send={send} />
                {/* The request's actions, then the session's. */}
                <Separator orientation="vertical" className="h-4 self-center" data-phase-divider />
              </>
            )}
            <Regenerate view={view} selected={selected} send={send} />
            <ExportButton disabled={view.iteration === null} exportHtml={exportHtml} />
          </>
        )
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
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
          <h1 className="truncate font-semibold" data-session-title>
            {title}
          </h1>
        </nav>
        {view !== null && view.iteration !== null && <Badge data-iteration>Iteration {view.iteration.n}</Badge>}
        {view !== null && view.request !== null && (
          <>
            <Separator orientation="vertical" className="h-4 self-center" />
            <RequestStatus view={view} send={send} />
          </>
        )}
      </div>
    </TopBar>
  );
}
