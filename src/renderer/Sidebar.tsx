import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ExternalLink, GitBranch, LayoutGrid, Undo2 } from "lucide-react";
import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { Callout } from "@/components/ui/callout";
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
  SidebarMenuMark,
  SidebarMenuSkeleton,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { Count } from "@/components/ui/count";
import { blockIdOf, isPendingThread, type BlockView, type ContentHash, type OpenPhase, type SessionId, type SessionListing, type SessionView, type SlotId, type SlotView, type VariantKey } from "../core/types";
import type { PaneLimits } from "./hooks/use-pane-width";
import { useRowFit } from "./headerAction";
import { Mark } from "./Mark";
import { TakeoverPhrase } from "./Regenerate";
import { PhaseDot, SessionStatus } from "./SessionStatus";
import { echoTone, PHASE, sessionPhase } from "./status";
import { groupByProject, splitSettled } from "./sessionGroups";
import { SETTLE_SHORTCUT, settleLabel, settleUndoes } from "./settle";
import { age, elapsed, useNow } from "./time";

export function AppSidebar({
  width,
  limits,
  onWidth,
  children,
}: {
  width: number;
  limits: PaneLimits;
  onWidth: (width: number) => void;
  children: ReactNode;
}) {
  const { isMobile } = useSidebar();
  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      {/* The sidebar's share of the window header: it moves the window, with the toggle at its left as in T3 Code. */}
      <SidebarHeader className="-mt-2 h-12 flex-row items-center gap-2 px-1 py-0" data-drag-region>
        <SidebarTrigger />
        <Mark size={20} />
        <span className="text-sm font-semibold">Brainstorm</span>
      </SidebarHeader>
      {children}
      {!isMobile && (
        <ResizeHandle edge="right" value={width} min={limits.min} max={limits.max} reset={limits.fallback} onValueChange={onWidth} aria-label="Sidebar width" />
      )}
    </Sidebar>
  );
}

/** Up and down move between the rows `selector` matches, for lists Rob scans with the keyboard. */
function arrowFocus(e: KeyboardEvent<HTMLElement>, selector: string): HTMLElement | null {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return null;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return null;
  const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
  if (next === undefined) return null;
  e.preventDefault();
  next.focus();
  return next;
}

export function HomePanel({
  sessions,
  failed,
  current,
  overview,
  onOverview,
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
        </SidebarMenu>
      </SidebarGroup>
      {sessions === null && failed ? (
        <p className="px-4 py-3 text-sm/relaxed text-balance text-fg-muted" data-home-failed-note>
          The list didn't load. Use <span className="whitespace-nowrap">Try again</span> on the right.
        </p>
      ) : sessions === null ? (
        <SidebarGroup data-home-loading>
          <div className="flex h-8 items-center px-2">
            <Skeleton className="h-3 w-16" />
          </div>
          <SidebarMenu>
            {(["w-3/4", "w-1/2", "w-2/3", "w-3/4", "w-1/2"] as const).map((width, i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuSkeleton width={width} />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
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
                <span className="flex group-data-[panel-open]/label:hidden">
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
        {/* The branch mark trails the title, so a fork's title keeps its siblings' text edge. */}
        {s.fork !== null && (
          <span className="flex shrink-0 text-fg-muted" data-row-fork>
            <GitBranch aria-hidden />
            <span className="sr-only">
              Fork of {s.fork.parentTitle} · iteration {s.fork.from}
            </span>
          </span>
        )}
        {/* An open request says what it is waiting on and for how long, as T3 Code's thread rows do, in the age's place. */}
        <span className="flex shrink-0 text-xs font-normal text-fg-muted tabular-nums group-focus-within/menu-item:invisible group-hover/menu-item:invisible">
          {sessionPhase(s) === null || s.settlement.state === "settled" ? <span data-age={since}>{age(since, now)}</span> : <SessionStatus session={s} now={now} collapsible />}
        </span>
      </SidebarMenuButton>
      {/* Right, over the main card: over its own row the hint would cover the title of the brainstorm it settles. */}
      <Hint label={label} shortcut={SETTLE_SHORTCUT} side="right">
        <SidebarMenuAction showOnHover className="text-fg-muted" onClick={onSettle} aria-label={`${label} ${s.title}`} data-settle={s.id}>
          {settleUndoes(s) ? <Undo2 aria-hidden /> : <CircleCheck aria-hidden />}
        </SidebarMenuAction>
      </Hint>
    </SidebarMenuItem>
  );
}

export function SessionPanel({
  view,
  slots,
  blocks,
  blockErrors,
  onHome,
  onOpen,
  selectedSlot,
  onSlot,
  onVariant,
}: {
  view: SessionView | null;
  slots: readonly SlotView[];
  blocks: readonly BlockView[];
  blockErrors: ReadonlyMap<ContentHash, string>;
  onHome: () => void;
  /** Opens another brainstorm: a fork's parent. */
  onOpen: (id: SessionId) => void;
  selectedSlot: SlotId | null;
  onSlot: (slot: SlotId) => void;
  onVariant: (slot: SlotId, variant: VariantKey) => void;
}) {
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  return (
    <SidebarContent className="animate-in pb-8 fade-in-0 slide-in-from-right-3 duration-200" data-sidebar-panel="session">
      <SidebarGroup className="pb-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tone="quiet" onClick={onHome} data-back>
              <ChevronLeft aria-hidden />
              <span>All brainstorms</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {view === null ? (
        <div data-session-loading>
          {/* The panel it stands for: the thread, then each slot's heading and variant rows. */}
          <SidebarGroup className="py-1">
            <div className="flex h-8 items-center px-2">
              <Skeleton className="h-3 w-12" />
            </div>
            {/* The thread row's two lines: its title, then its status. */}
            <div className="flex flex-col justify-center gap-1.5 px-2 py-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </SidebarGroup>
          {[3, 2].map((rows, slot) => (
            <SidebarGroup key={slot}>
              <div className="flex h-8 items-center justify-between px-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-12" />
              </div>
              <SidebarMenu>
                {(["w-1/2", "w-2/3", "w-1/2"] as const).slice(0, rows).map((width, i) => (
                  <SidebarMenuItem key={i}>
                    <SidebarMenuSkeleton width={width} />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </div>
      ) : (
        <ThreadSection view={view} onOpen={onOpen} />
      )}
      {slots.map((slot) => (
        <SlotSection
          key={slot.id}
          slot={slot}
          blocks={byId}
          blockErrors={blockErrors}
          selected={slot.id === selectedSlot}
          onSlot={() => onSlot(slot.id)}
          onVariant={(v) => onVariant(slot.id, v)}
        />
      ))}
    </SidebarContent>
  );
}

/**
 * The brainstorm's T3 thread. An attached thread is a link out to it. A lost one is a status, not a control: one line
 * that says "Thread lost", the term the bar and home use, and under it the phrase that takes the brainstorm over.
 */
function ThreadSection({ view, onOpen }: { view: SessionView; onOpen: (id: SessionId) => void }) {
  const lost = view.attachment.lostAt !== null;
  // A fork has no thread until T3 starts one; the bar says how that is going, so this names the state only.
  const pending = isPendingThread(view.attachment.threadId);
  const failed = view.request?.phase.phase === "start_failed";
  const fork = view.fork;
  // A lost thread with a request in flight already says so, with the phrase, in the request strip.
  const showTakeover = lost && view.request?.phase.phase !== "thread_lost";
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>Thread</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          {pending ? (
            <div className="flex h-8 items-center gap-2 px-2 text-sm" data-thread-link>
              <SidebarMenuMark className={failed ? "bg-fg-muted" : "bg-accent"} />
              <span className="text-fg-muted" data-thread={failed ? "start_failed" : "starting"}>
                {failed ? "New thread didn't start" : "New thread · starting"}
              </span>
            </div>
          ) : lost || view.thread === null ? (
            // T3 may not have answered yet for an attached thread, so it shows the state without a name or a link.
            <div className="flex h-8 items-center gap-2 px-2 text-sm" data-thread-link>
              {/* The header names a lost thread in amber, and its strip says what to do, so the row only states it. */}
              {lost ? <SidebarMenuMark className="bg-fg-muted" /> : <ThreadMark view={view} />}
              {lost ? (
                <span className="text-fg-muted" data-thread="lost">
                  Thread lost
                </span>
              ) : (
                <ThreadState view={view} />
              )}
            </div>
          ) : (
            <SidebarMenuButton size="tall" render={<a href={view.thread.link} target="_blank" rel="noreferrer" />} data-thread-link>
              <span className="mt-0.5 flex">
                <ThreadMark view={view} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Truncate>{view.thread.title}</Truncate>
                <ThreadState view={view} className="text-xs" />
              </span>
              <ExternalLink aria-hidden className="mt-0.5 text-fg-muted" />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
      {fork !== null && (
        <SidebarMenu>
          <SidebarMenuItem>
            {fork.parent.state === "gone" ? (
              <div className="flex h-8 items-center gap-2 px-2 text-xs text-fg-muted" data-forked-from="gone">
                <GitBranch aria-hidden className="size-4 shrink-0" />
                <ForkedFrom title={fork.parent.title} from={`iteration ${fork.from}, since discarded`} />
              </div>
            ) : (
              <SidebarMenuButton tone="quiet" onClick={() => onOpen(fork.parent.id)} data-forked-from={fork.parent.id}>
                <GitBranch aria-hidden />
                <ForkedFrom title={fork.parent.title} from={`iteration ${fork.from}`} />
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      )}
      {showTakeover && (
        <div className="pt-1" data-takeover>
          <Callout tone="warning" wide actions={<TakeoverPhrase title={view.session.title} />}>
            <p>In a T3 thread on this project, say:</p>
          </Callout>
        </div>
      )}
    </SidebarGroup>
  );
}

/** The open request's phase, or null once it has closed. */
function openPhase(view: SessionView): OpenPhase | null {
  const phase = view.request?.phase.phase;
  return phase === undefined || phase === "fulfilled" || phase === "withdrawn" ? null : phase;
}

/**
 * The Thread row's lead mark: green while the thread is attached and idle, the phase's dot while a request is open. A
 * phase in a status hue shows muted here, since the header and its strip already carry the hue.
 */
function ThreadMark({ view }: { view: SessionView }) {
  const phase = openPhase(view);
  if (phase === null) return <SidebarMenuMark className="bg-success" />;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" data-thread-mark={echoTone(phase)}>
      <PhaseDot phase={phase} tone={echoTone(phase)} />
    </span>
  );
}

/**
 * What the attached thread is doing, in the words home's rows use: the open request's phase and how long it has been
 * open, or Attached once nothing is open. The lead mark carries the tone, so the words stay muted and keep one edge.
 */
function ThreadState({ view, className }: { view: SessionView; className?: string }) {
  const request = view.request;
  const phase = openPhase(view);
  const now = useNow(phase === null ? undefined : 1_000);
  if (request === null || phase === null) {
    return (
      <span className={cn("text-fg-muted", className)} data-thread="attached">
        Attached
      </span>
    );
  }
  return (
    <span className={cn("text-fg-muted", className)} data-thread={phase}>
      {PHASE[phase].short}
      <span className="tabular-nums" data-status-elapsed>{` ${elapsed(request.request.sentAt ?? request.request.createdAt, now)}`}</span>
    </span>
  );
}

function SlotSection({
  slot,
  blocks,
  blockErrors,
  selected,
  onSlot,
  onVariant,
}: {
  slot: SlotView;
  blocks: ReadonlyMap<string, BlockView>;
  blockErrors: ReadonlyMap<ContentHash, string>;
  selected: boolean;
  onSlot: () => void;
  onVariant: (variant: VariantKey) => void;
}) {
  return (
    <>
      <SidebarSeparator />
      <SidebarGroup data-slot-id={slot.id}>
        <SidebarGroupLabel
          render={<button type="button" onClick={onSlot} />}
          className="w-full cursor-pointer gap-2 hover:bg-hover hover:text-fg"
        >
          <Truncate>{slot.title}</Truncate>
          <Count className="ml-auto" data-slot-count>
            {slot.variants.length} {slot.variants.length === 1 ? "variant" : "variants"}
          </Count>
        </SidebarGroupLabel>
        <SidebarMenu
          role="radiogroup"
          aria-label={`${slot.title} variant`}
          onKeyDown={(e) => {
            const next = arrowFocus(e, "[data-variant]")?.dataset.variant;
            if (next !== undefined) onVariant(next as VariantKey);
          }}
        >
          {slot.variants.map((variant) => {
            const block = blocks.get(blockIdOf(slot.id, variant));
            const active = variant === slot.active;
            const failed = block !== undefined && blockErrors.has(block.hash);
            return (
              <SidebarMenuItem key={variant}>
                <SidebarMenuButton
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  // Only the selected slot's row is tinted; the others mark what's showing with a dot.
                  isActive={active && selected}
                  onClick={() => onVariant(variant)}
                  data-variant={variant}
                  data-showing={active || undefined}
                >
                  {/* What shows is a filled dot. A variant the agent just added rings the mark in the accent, the agent's colour,
                      until Rob has seen it, so the two read apart by form and not hue alone, and one row can carry both. */}
                  <SidebarMenuMark className={cn(active && "bg-fg-muted", block?.isNew === true && "outline-2 outline-offset-1 outline-accent")} />
                  {block?.isNew === true && (
                    <span className="sr-only" data-variant-new>
                      new
                    </span>
                  )}
                  {/* The name Rob reads keeps its width; the raw key beside it gives way first, down to nothing. */}
                  <Truncate className="max-w-full shrink-0" data-variant-title>
                    {block?.title ?? variant}
                  </Truncate>
                  {failed && (
                    <Hint label="This block failed to render" side="left">
                      <CircleAlert aria-label="Failed to render" className="text-danger" data-variant-error />
                    </Hint>
                  )}
                  <Truncate className="flex-1 text-right text-xs font-normal text-fg-muted" data-variant-key>
                    {variant}
                  </Truncate>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

/** Only the parent's title gives way, so the iteration, which the breadcrumb doesn't show, always reads whole. */
function ForkedFrom({ title, from }: { title: string; from: string }) {
  return (
    <span className="flex min-w-0 gap-1 text-xs" data-forked-line>
      <Truncate>{`Forked from ${title}`}</Truncate>
      <span className="shrink-0">· {from}</span>
    </span>
  );
}
