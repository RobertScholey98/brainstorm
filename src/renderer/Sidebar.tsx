import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleAlert, ExternalLink, LayoutGrid } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { blockIdOf, type BlockId, type BlockView, type SessionId, type SessionListing, type SessionView, type SlotId, type SlotView, type VariantKey } from "../core/types";
import type { PaneLimits } from "./hooks/use-pane-width";
import { Mark } from "./Mark";
import { Markdown } from "./Markdown";
import { parseMarkdown, withLeadLabel } from "./markdownSubset";
import { TakeoverPhrase } from "./Regenerate";
import { groupByProject } from "./sessionGroups";
import { age, useNow } from "./time";

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

/** The sidebar's end: room after the last row, and a soft edge over rows that scroll under it, so a cut row reads as cut. */
function BottomFade() {
  return <div aria-hidden className="pointer-events-none sticky bottom-0 h-8 shrink-0 bg-linear-to-t from-app" data-sidebar-fade />;
}

export function HomePanel({
  sessions,
  failed,
  current,
  overview,
  onOverview,
  onSession,
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
}) {
  const groups = useMemo(() => groupByProject(sessions ?? []), [sessions]);
  const now = useNow();
  return (
    <SidebarContent
      className="animate-in fade-in-0 slide-in-from-left-3 duration-200"
      data-sidebar-panel="home"
      onKeyDown={(e) => arrowFocus(e, "[data-overview], [data-session]")}
    >
      <SidebarGroup className="pb-0">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={overview} onClick={onOverview} data-overview>
              <LayoutGrid aria-hidden />
              <span>Overview</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {sessions === null && failed ? (
        <p className="px-4 py-3 text-sm/relaxed text-pretty text-fg-muted">The list didn't load. Try again from the overview.</p>
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
      ) : groups.length === 0 ? (
        <p className="px-4 py-3 text-sm/relaxed text-pretty text-fg-muted">Brainstorms you start appear here.</p>
      ) : (
        groups.map((group) => (
          <Collapsible key={group.projectId} defaultOpen render={<SidebarGroup className="py-1" data-project={group.projectId} />}>
            <SidebarGroupLabel
              render={<CollapsibleTrigger />}
              className="group/label w-full cursor-pointer gap-1 hover:bg-hover hover:text-fg"
              data-project-label
            >
              {/* First, so every group's chevron sits at one x whatever its label's length. */}
              <ChevronRight aria-hidden className="transition-transform group-data-[panel-open]/label:rotate-90" />
              <span className="truncate">{group.label}</span>
              <span className="ml-auto pl-2 font-normal text-fg-muted tabular-nums group-data-[panel-open]/label:hidden" data-project-count>
                {group.sessions.length}
              </span>
            </SidebarGroupLabel>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.sessions.map((s) => (
                    <SidebarMenuItem key={s.id}>
                      <SessionRow session={s} now={now} active={s.id === current} onOpen={() => onSession(s.id)} />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
      <BottomFade />
    </SidebarContent>
  );
}

/** One line, as T3 Code lists threads: the title, its live status, and how long ago it last moved, right-aligned. */
function SessionRow({ session: s, now, active, onOpen }: { session: SessionListing; now: number; active: boolean; onOpen: () => void }) {
  return (
    <SidebarMenuButton isActive={active} onClick={onOpen} data-session={s.id} data-lost={s.lost || undefined}>
      <span className="min-w-0 flex-1 truncate">{s.title}</span>
      {/* A lost thread outranks a wait, since nobody can answer it. */}
      {s.lost ? (
        <span className="flex shrink-0 items-center text-warning" data-session-lost>
          <AlertTriangle aria-hidden className="size-3.5!" />
          <span className="sr-only">Thread lost</span>
        </span>
      ) : (
        s.openRequest && (
          <span className="flex shrink-0 items-center" data-session-busy>
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            <span className="sr-only">Waiting on the agent</span>
          </span>
        )
      )}
      <span className="shrink-0 text-xs font-normal text-fg-muted tabular-nums" data-age={s.activeAt}>
        {age(s.activeAt, now)}
      </span>
    </SidebarMenuButton>
  );
}

export function SessionPanel({
  view,
  slots,
  blocks,
  blockErrors,
  onHome,
  selectedSlot,
  onSlot,
  onVariant,
}: {
  view: SessionView | null;
  slots: readonly SlotView[];
  blocks: readonly BlockView[];
  blockErrors: ReadonlyMap<BlockId, string>;
  onHome: () => void;
  selectedSlot: SlotId | null;
  onSlot: (slot: SlotId) => void;
  onVariant: (slot: SlotId, variant: VariantKey) => void;
}) {
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  return (
    <SidebarContent className="animate-in fade-in-0 slide-in-from-right-3 duration-200" data-sidebar-panel="session">
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
            <SidebarMenuSkeleton width="w-2/3" trailing={false} />
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
        <ThreadSection view={view} />
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
      <BottomFade />
    </SidebarContent>
  );
}

/**
 * The brainstorm's T3 thread. An attached thread is a link out to it. A lost one is a status, not a control: one line
 * that says "Thread lost", the term the bar and home use, and under it the phrase that takes the brainstorm over.
 */
function ThreadSection({ view }: { view: SessionView }) {
  const lost = view.attachment.lostAt !== null;
  // A lost thread with a request in flight already says so, with the phrase, in the request strip.
  const showTakeover = lost && view.request?.phase.phase !== "thread_lost";
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>Thread</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          {lost || view.thread === null ? (
            // T3 may not have answered yet for an attached thread, so it shows the state without a name or a link.
            <div className="flex h-8 items-center gap-2 px-2 text-sm" data-thread-link>
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", lost ? "bg-warning" : "bg-success")} />
              <span className={lost ? "font-medium text-warning" : "text-fg-muted"} data-thread={lost ? "lost" : "attached"}>
                {lost ? "Thread lost" : "Attached"}
              </span>
            </div>
          ) : (
            <SidebarMenuButton size="tall" render={<a href={view.thread.link} target="_blank" rel="noreferrer" />} data-thread-link>
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate">{view.thread.title}</span>
                <span className="text-xs text-fg-muted" data-thread="attached">
                  Attached
                </span>
              </span>
              <ExternalLink aria-hidden className="mt-0.5 text-fg-muted" />
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
      {showTakeover && (
        <div className="px-2 pt-1" data-takeover>
          <Callout tone="warning" actions={<TakeoverPhrase title={view.session.title} />}>
            <p>In a T3 thread on this project, say:</p>
          </Callout>
        </div>
      )}
    </SidebarGroup>
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
  blocks: ReadonlyMap<BlockId, BlockView>;
  blockErrors: ReadonlyMap<BlockId, string>;
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
          className="w-full cursor-pointer gap-2 hover:bg-hover data-[selected]:text-fg"
          data-selected={selected || undefined}
        >
          <span className="truncate">{slot.title}</span>
          <span className="ml-auto shrink-0 font-normal tabular-nums">
            {slot.variants.length} {slot.variants.length === 1 ? "variant" : "variants"}
          </span>
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
            const failed = block !== undefined && blockErrors.has(block.id);
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
                  <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${active ? "bg-fg-muted" : ""}`} />
                  <span className="min-w-0 flex-1 truncate" data-variant-title>
                    {block?.title ?? variant}
                  </span>
                  {failed && (
                    <Hint label="This block failed to render" side="right">
                      <CircleAlert aria-label="Failed to render" className="text-danger" data-variant-error />
                    </Hint>
                  )}
                  <span className="shrink-0 text-xs font-normal text-fg-muted">{variant}</span>
                </SidebarMenuButton>
                {active && block?.about && <About source={block.about} />}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

/**
 * A variant's note, aligned with the variant's name. Past three lines it is cut with a fade, not an ellipsis that
 * can land after a full stop, and More shows the rest in place.
 */
function About({ source }: { source: string }) {
  const blocks = useMemo(() => withLeadLabel(parseMarkdown(source)), [source]);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (el === null || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, blocks]);
  const id = useId();
  return (
    <div className="flex gap-2 px-2 pt-1.5 pb-2 text-xs/relaxed text-fg-muted" data-about>
      {/* The row's dot column, so the note starts where the variant's name does. */}
      <span aria-hidden className="w-1.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div
          ref={body}
          id={id}
          className={cn("[&>*+*]:mt-1.5", !open && "max-h-about overflow-hidden", !open && long && "mask-b-from-50%")}
          data-about-body
        >
          <Markdown source={source} blocks={blocks} />
        </div>
        {long && (
          <Button variant="ghost" className="-ml-2" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} data-about-more>
            {open ? "Less" : "More"}
            {open ? <ChevronUp data-icon="inline-end" aria-hidden /> : <ChevronDown data-icon="inline-end" aria-hidden />}
          </Button>
        )}
      </div>
    </div>
  );
}
