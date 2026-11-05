import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import type { BlockId, ExportResult, Regenerate as RegenerateGate, RobAction, SessionView } from "../core/types";
import { ExportButton } from "./Export";
import { Regenerate, RequestStatus } from "./Regenerate";

const BLOCKED: Record<Extract<RegenerateGate, { ok: false }>["reason"], (view: SessionView | null) => string> = {
  no_iteration: () => "Regenerate needs a first iteration",
  request_open: (view) => `Request ${view?.request?.request.n} is still open. Withdraw it to send another.`,
  thread_lost: () => "This session's thread is gone. Take it over from a T3 thread first.",
};

export function blockedReason(view: SessionView | null): string | null {
  const gate = view?.regenerate ?? { ok: false, reason: "no_iteration" };
  return gate.ok ? null : BLOCKED[gate.reason](view);
}

/** The main panel's bar: the session, its iteration and request, then Regenerate and Export. Home shows a title only. */
export function TopBar({
  view,
  home,
  notice,
  selected,
  send,
  exportHtml,
}: {
  view: SessionView | null;
  home: boolean;
  notice: string | null;
  selected: BlockId | null;
  send: (action: RobAction) => Promise<SessionView | null>;
  exportHtml: () => Promise<ExportResult | null>;
}) {
  const { state, isMobile } = useSidebar();
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-3" data-topbar>
      {(state === "collapsed" || isMobile) && (
        <>
          <SidebarTrigger className="text-muted-foreground" />
          <Separator orientation="vertical" className="h-4 self-center" />
        </>
      )}
      {home ? (
        <h1 className="pl-1 text-sm font-medium">All brainstorms</h1>
      ) : (
        view !== null && (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
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
        )
      )}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {notice !== null && (
          <span role="alert" className="max-w-[420px] truncate text-xs text-destructive" title={notice}>
            {notice}
          </span>
        )}
        {view !== null && (
          <>
            <Regenerate view={view} blocked={blockedReason(view)} selected={selected} send={send} />
            <ExportButton disabled={view.iteration === null} exportHtml={exportHtml} />
          </>
        )}
      </div>
    </header>
  );
}
