import { ChevronRight, CircleCheck, Component, LayoutGrid, Undo2 } from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";
import { arrowFocus } from "./arrowFocus";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ResizeHandle } from "@/components/ui/resize-handle";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Truncate } from "@/components/ui/truncate";
import { Count } from "@/components/ui/count";
import type { SessionId, SessionListing } from "../core/types";
import type { PaneLimits } from "./hooks/use-pane-width";
import { useRowFit } from "./headerAction";
import { Mark } from "./Mark";
import { SidebarFoot } from "./Update";
import type { AppUpdateState } from "../core/appUpdate";
import { PhaseDot, SessionStatus } from "./SessionStatus";
import { loudestPhase, PHASE, sessionPhase } from "./status";
import { groupByProject, splitSettled } from "./sessionGroups";
import { SETTLE_SHORTCUT, settleLabel, settleUndoes } from "./settle";
import { age, useNow } from "./time";

export function AppSidebar({
  width,
  limits,
  onWidth,
  update,
  children,
}: {
  width: number;
  limits: PaneLimits;
  onWidth: (width: number) => void;
  /** Where updating stands, and what Settings and the update button beside it do. */
  update: { state: AppUpdateState | null; onSettings: () => void; onCheck: () => void; onDownload: () => void; onInstall: () => void };
  children: ReactNode;
}) {
  const { isMobile } = useSidebar();
  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      {/* The sidebar's share of the window header: it moves the window, with the toggle at its left as in T3 Code. */}
      <SidebarHeader className="-mt-2 h-12 flex-row items-center gap-2 px-1 py-0" data-drag-region data-window-start>
        <SidebarTrigger />
        <Mark size={20} />
        <span className="text-sm font-semibold">Brainstorm</span>
      </SidebarHeader>
      {children}
      <SidebarFoot {...update} />
      {!isMobile && (
        <ResizeHandle edge="right" value={width} min={limits.min} max={limits.max} reset={limits.fallback} onValueChange={onWidth} aria-label="Sidebar width" />
      )}
    </Sidebar>
  );
}

export function HomePanel({
  sessions,
  failed,
  current,
  overview,
  onOverview,
  systems,
  onSystems,
  onSession,
  onSettle,
}: {
  /** Null while the first list is loading. */
  sessions: readonly SessionListing[] | null;
  /** The first list didn't load; the overview says why. */
  failed: boolean;
  /** The brainstorm open behind this panel, if any. */
  current: SessionId | null;
  overview: boolean;
  onOverview: () => void;
  /** The design systems page is open. */
  systems: boolean;
  onSystems: () => void;
  onSession: (id: SessionId) => void;
  /** Settles a brainstorm, or brings a settled one back. */
  onSettle: (session: SessionListing) => void;
}) {
  const { groups, settled } = useMemo(() => {
    const split = splitSettled(sessions ?? []);
    return { groups: groupByProject(split.active), settled: split.settled };
  }, [sessions]);
  const now = useNow(sessions?.some((s) => sessionPhase(s) !== null) === true ? 1_000 : undefined);
  return (
    <SidebarContent
      className="animate-in pb-8 fade-in-0 slide-in-from-left-3 duration-200"
      data-sidebar-panel="home"
      onKeyDown={(e) => arrowFocus(e, "[data-overview], [data-session]")}
    >
      <SidebarGroup className="pb-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={overview} onClick={onOverview} data-overview>
              <LayoutGrid aria-hidden />
              <span>All brainstorms</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={systems} onClick={onSystems} data-overview data-nav-systems>
              <Component aria-hidden />
              <span>Design systems</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {sessions === null && failed ? (
        <p className="px-4 py-3 text-sm/relaxed text-fg-muted" data-home-failed-note>
          {/* A sentence a line, so the note never ends on a stray pair of words. */}
          <span className="block">The list didn't load.</span>{" "}
          <span className="block">
            Use{" "}
            <span className="whitespace-nowrap" data-home-retry-name>
              Try again
            </span>{" "}
            on the right.
          </span>
        </p>
      ) : sessions === null ? (
        // The list it stands for: project groups, each a head over its rows.
        <div data-home-loading>
          {(
            [
              ["w-3/4", "w-1/2"],
              ["w-2/3"],
              ["w-1/2", "w-3/4"],
            ] as const
          ).map((rows, group) => (
            <SidebarGroup key={group} className="py-1">
              <div className="flex h-8 items-center justify-between px-2" data-home-loading-head>
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-4" />
              </div>
              <SidebarMenu>
                {rows.map((width, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton width={width} />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </div>
      ) : groups.length === 0 && settled.length === 0 ? (
        <p className="px-4 py-3 text-sm/relaxed text-pretty text-fg-muted">Brainstorms you start appear here.</p>
      ) : (
        groups.map((group) => (
          <Collapsible key={group.projectId} defaultOpen render={<SidebarGroup className="py-1" data-project={group.projectId} />}>
            <SidebarGroupLabel
              render={<CollapsibleTrigger />}
              className="group/label w-full cursor-pointer gap-1 hover:bg-hover hover:text-fg"
              data-project-label
            >
              {/* The label starts where its rows' titles do, and the chevron ends the row, at one x for every group. */}
              <Truncate>{group.label}</Truncate>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <span className="flex items-center gap-1.5 group-data-[panel-open]/label:hidden">
                  <GroupPhase sessions={group.sessions} />
                  <Count data-project-count>{group.sessions.length}</Count>
                </span>
                <ChevronRight aria-hidden className={GROUP_CHEVRON} />
              </span>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.sessions.map((s) => (
                    <SessionRow key={s.id} session={s} now={now} active={s.id === current} onOpen={() => onSession(s.id)} onSettle={() => onSettle(s)} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
      {groups.length === 0 && settled.length > 0 && (
        <p className="px-4 py-3 text-sm/relaxed text-pretty text-fg-muted" data-all-settled>
          Every brainstorm is settled.
        </p>
      )}
      {settled.length > 0 && (
        // As in T3 Code: below every project, shut until Rob opens it, its count always showing.
        <Collapsible render={<SidebarGroup className="py-1" data-settled-group />}>
          <SidebarGroupLabel render={<CollapsibleTrigger />} className="group/label w-full cursor-pointer gap-1 hover:bg-hover hover:text-fg" data-settled-label>
            <Truncate>Settled</Truncate>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <Count data-settled-count>{settled.length}</Count>
              <ChevronRight aria-hidden className={GROUP_CHEVRON} />
            </span>
          </SidebarGroupLabel>
          <CollapsibleContent>
            <SidebarGroupContent>
              <SidebarMenu>
                {settled.map((s) => (
                  <SessionRow key={s.id} session={s} now={now} active={s.id === current} onOpen={() => onSession(s.id)} onSettle={() => onSettle(s)} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </CollapsibleContent>
        </Collapsible>
      )}
    </SidebarContent>
  );
}

/** An open group's chevron ink stands 4 px inside its box, so the box reaches 4 px out to end the ink on the rows' ages. */
const GROUP_CHEVRON = "-mr-1 size-4 transition-transform group-data-[panel-open]/label:rotate-90";

/**
 * One line, as T3 Code lists threads: the title, its live status, and how long ago it last moved, right-aligned. A
 * settled row is muted and counts from when it was settled. On hover or focus the settle control takes the age's place.
 */
function SessionRow({
  session: s,
  now,
  active,
  onOpen,
  onSettle,
}: {
  session: SessionListing;
  now: number;
  active: boolean;
  onOpen: () => void;
  onSettle: () => void;
}) {
  const since = s.settlement.state === "settled" ? s.settlement.at : s.activeAt;
  const label = settleLabel(s);
  const glyph = settleUndoes(s) ? <Undo2 aria-hidden className="size-3.5" /> : <CircleCheck aria-hidden className="size-3.5" />;
  const row = useRef<HTMLButtonElement>(null);
  useRowFit(row);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        ref={row}
        isActive={active}
        tone={s.settlement.state === "settled" ? "quiet" : "default"}
        onClick={onOpen}
        data-session={s.id}
        data-lost={s.lost || undefined}
        data-settled={s.settlement.state === "settled" || undefined}
      >
        <Truncate className="flex-1" data-row-title>
          {s.title}
        </Truncate>
        {/* An open request says what it is waiting on and for how long, as T3 Code's thread rows do, in the age's place. A lost thread echoes muted: the card beside it carries the warning. */}
        <span className="flex shrink-0 text-xs font-normal text-fg-muted tabular-nums group-focus-within/menu-item:hidden group-hover/menu-item:hidden">
          {sessionPhase(s) === null || s.settlement.state === "settled" ? <span data-age={since}>{age(since, now)}</span> : <SessionStatus session={s} now={now} tone={sessionPhase(s) === "thread_lost" ? "muted" : undefined} collapsible />}
        </span>
        {/* The settle action's room, held while it shows in the age's place, so the title gives way to it rather than run under it. */}
        <span aria-hidden data-label={label} className="content-label invisible hidden shrink-0 gap-1 pr-1 pl-1.5 text-xs group-focus-within/menu-item:flex group-hover/menu-item:flex">
          {glyph}
        </span>
      </SidebarMenuButton>
      {/* In the row, in the age's place, as T3 Code shows a thread's actions: a hint off the row had no side that cleared both the title and the main card. */}
      <SidebarMenuAction
        showOnHover
        labelled
        className="text-fg-muted"
        onClick={onSettle}
        aria-label={`${label} ${s.title}, ${SETTLE_SHORTCUT}`}
        aria-keyshortcuts="Control+Shift+S"
        data-settle={s.id}
      >
        {glyph}
        {label}
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

/** A folded group's open phase, the dot its loudest row shows, so folding a group never hides an agent at work in it. */
function GroupPhase({ sessions }: { sessions: readonly SessionListing[] }) {
  const phase = loudestPhase(sessions);
  if (phase === null) return null;
  return (
    <span className="flex" data-group-phase={phase}>
      <PhaseDot phase={phase} />
      <span className="sr-only">{PHASE[phase].short}</span>
    </span>
  );
}

