import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { BlockId, ExportResult, RobAction, SessionView } from "../core/types";
import { ExportButton } from "./Export";
import { Regenerate, RequestStatus } from "./Regenerate";

export function TopBar({ notice, actions, children }: { notice: string | null; actions?: ReactNode; children: ReactNode }) {
  const { state, isMobile } = useSidebar();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3" data-topbar>
      {(state === "collapsed" || isMobile) && (
        <>
          <SidebarTrigger className="text-fg-muted" />
          <Separator orientation="vertical" className="h-4 self-center" />
        </>
      )}
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {notice !== null && (
          <span role="alert" className="max-w-md truncate text-xs text-danger" title={notice}>
            {notice}
          </span>
        )}
        {actions}
      </div>
    </header>
  );
}

export function SessionBar({
  view,
  notice,
  selected,
  send,
  exportHtml,
}: {
  view: SessionView | null;
  notice: string | null;
  selected: BlockId | null;
  send: (action: RobAction) => Promise<SessionView | null>;
  exportHtml: () => Promise<ExportResult | null>;
}) {
  return (
    <TopBar
      notice={notice}
      actions={
        view !== null && (
          <>
            <Regenerate view={view} selected={selected} send={send} />
            <ExportButton disabled={view.iteration === null} exportHtml={exportHtml} />
          </>
        )
      }
    >
      {view !== null && (
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-1">
          <h1 className="shrink-0 truncate text-sm font-semibold">{view.session.title}</h1>
          {view.iteration !== null && (
            <Badge variant="secondary" className="shrink-0 tabular-nums" data-iteration>
              Iteration {view.iteration.n}
            </Badge>
          )}
          {view.request !== null && (
            <>
              <Separator orientation="vertical" className="h-4 self-center" />
              <RequestStatus view={view} send={send} />
            </>
          )}
        </div>
      )}
    </TopBar>
  );
}
