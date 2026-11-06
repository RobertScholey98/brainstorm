import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { BlockId, ExportResult, RobAction, SessionView } from "../core/types";
import { ExportButton } from "./Export";
import { Regenerate, RequestStatus } from "./Regenerate";

export function TopBar({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  const { state, isMobile } = useSidebar();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3" data-topbar>
      {(state === "collapsed" || isMobile) && <SidebarTrigger />}
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
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
}: {
  title: string;
  /** The project's label, or null until the list has loaded. */
  project: string | null;
  view: SessionView | null;
  selected: BlockId | null;
  send: (action: RobAction) => Promise<SessionView | null>;
  exportHtml: () => Promise<ExportResult | null>;
}) {
  return (
    <TopBar
      actions={
        view !== null && (
          <>
            <Regenerate view={view} selected={selected} send={send} />
            <ExportButton disabled={view.iteration === null} exportHtml={exportHtml} />
          </>
        )
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
        <nav aria-label="Breadcrumb" className="flex min-w-0 shrink items-center gap-1 text-sm">
          {project !== null && (
            <>
              <span className="truncate text-fg-muted" data-breadcrumb-project>
                {project}
              </span>
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
            </>
          )}
          <h1 className="truncate font-semibold" data-session-title>
            {title}
          </h1>
        </nav>
        {view !== null && view.iteration !== null && (
            <Badge variant="secondary" data-iteration>
              Iteration {view.iteration.n}
            </Badge>
        )}
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
