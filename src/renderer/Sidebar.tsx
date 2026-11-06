import { AlertTriangle, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, LayoutGrid } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
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
import { Hint } from "@/components/ui/tooltip";
import { takeoverPhrase } from "../core/machines";
import { blockIdOf, type BlockId, type BlockView, type SessionId, type SessionListing, type SessionView, type SlotId, type SlotView, type VariantKey } from "../core/types";
import type { PaneLimits } from "./hooks/use-pane-width";
import { Mark } from "./Mark";
import { Markdown } from "./Markdown";
import { markdownText } from "./markdownSubset";
import { CopyPhrase } from "./Regenerate";
import { groupByProject } from "./sessionGroups";
import { ago, useNow } from "./time";

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
      <SidebarHeader className="flex-row items-center gap-2 px-3 pt-2 pb-1">
        <Mark size={20} />
        <span className="text-sm font-semibold">Brainstorm</span>
        <SidebarTrigger className="ml-auto" />
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

/** A soft edge at the bottom of a scrolling sidebar, so the last row reads as cut off rather than as the end. */
function BottomFade() {
  return <div aria-hidden className="pointer-events-none sticky bottom-0 -mt-6 h-6 shrink-0 bg-linear-to-t from-app" />;
}

export function HomePanel({
  sessions,
  current,
  overview,
  onOverview,
  onSession,
}: {
  /** Null while the first list is loading. */
  sessions: readonly SessionListing[] | null;
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
      className="animate-in fade-in-0 slide-in-from-left-3 pb-6 duration-200"
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
      {sessions === null ? (
        <SidebarGroup data-home-loading>
          <SidebarMenu>
            {[0, 1, 2, 3].map((i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ) : groups.length === 0 ? (
        <p className="px-4 py-3 text-sm/relaxed text-fg-muted">Brainstorms you start appear here.</p>
      ) : (
        groups.map((group) => (
          <Collapsible key={group.projectId} defaultOpen render={<SidebarGroup className="py-1" data-project={group.projectId} />}>
            <SidebarGroupLabel
              render={<CollapsibleTrigger />}
              className="group/label w-full cursor-pointer gap-1 hover:bg-hover hover:text-fg"
              data-project-label
            >
              <span className="truncate">{group.label}</span>
              <ChevronRight aria-hidden className="transition-transform group-data-[panel-open]/label:rotate-90" />
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

function SessionRow({ session: s, now, active, onOpen }: { session: SessionListing; now: number; active: boolean; onOpen: () => void }) {
  return (
    <SidebarMenuButton size="tall" isActive={active} onClick={onOpen} data-session={s.id} data-lost={s.lost || undefined}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{s.title}</span>
          {s.openRequest && (
            <span className="flex shrink-0 items-center" data-session-busy>
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              <span className="sr-only">Waiting on the agent</span>
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs font-normal text-fg-muted">
          <span className="shrink-0 tabular-nums">{s.latest === null ? "No iterations yet" : `Iteration ${s.latest}`}</span>
          <span aria-hidden>·</span>
          <span className="truncate" data-age={s.activeAt}>
            {ago(s.activeAt, now)}
          </span>
          {s.lost && (
            <span className="ml-auto flex shrink-0 items-center gap-1 text-warning" data-session-lost>
              <AlertTriangle aria-hidden className="size-3!" />
              Thread lost
            </span>
          )}
        </span>
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
    <SidebarContent className="animate-in fade-in-0 slide-in-from-right-3 pb-6 duration-200" data-sidebar-panel="session">
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
        <SidebarGroup data-session-loading>
          <SidebarMenu>
            {[0, 1, 2, 3, 4].map((i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuSkeleton />
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
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

function ThreadSection({ view }: { view: SessionView }) {
  const lost = view.attachment.lostAt !== null;
  const name = view.thread?.title ?? `Thread ${view.attachment.threadId.slice(0, 8)}`;
  // A lost thread with a request in flight already says so, with the phrase, in the request status.
  const showTakeover = lost && view.request?.phase.phase !== "thread_lost";
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel>Thread</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="tall"
            {...(view.thread === null
              ? { disabled: true }
              : { render: <a href={view.thread.link} target="_blank" rel="noreferrer" /> })}
            data-thread-link
          >
            <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${lost ? "bg-warning" : "bg-success"}`} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">{name}</span>
              <span className={`text-xs ${lost ? "text-warning" : "text-fg-muted"}`} data-thread={lost ? "lost" : "attached"}>
                {lost ? "Unattached" : "Attached"}
              </span>
            </span>
            {view.thread !== null && <ExternalLink aria-hidden className="mt-0.5 text-fg-muted" />}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {showTakeover && (
        <div className="px-2 pt-1" data-takeover>
          <Callout tone="warning" heading="Not attached to a thread" actions={<CopyPhrase title={view.session.title} />}>
            <p>In a T3 thread on this project, say: {takeoverPhrase(view.session.title)}</p>
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
                  <span className="min-w-0 flex-1 truncate">{block?.title ?? variant}</span>
                  {failed && (
                    <Hint label="This block failed to render">
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

/** Past this many characters the note is cut to three lines, so one long note doesn't push the next slot away. */
const ABOUT_CLAMP = 160;

function About({ source }: { source: string }) {
  const [open, setOpen] = useState(false);
  const long = markdownText(source).length > ABOUT_CLAMP;
  return (
    <div className="grid gap-1.5 px-2 pt-1.5 pb-2 text-xs/relaxed text-fg-muted" data-about>
      {long && !open ? <p className="line-clamp-3">{markdownText(source)}</p> : <Markdown source={source} />}
      {long && (
        <Button variant="ghost" size="xs" className="-ml-2 w-fit" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-about-toggle>
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}
