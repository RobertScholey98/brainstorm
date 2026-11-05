import { ChevronLeft, ChevronRight, ExternalLink, Unlink } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { takeoverPhrase } from "../core/machines";
import { blockIdOf, type BlockView, type SessionId, type SessionListing, type SessionView, type SlotId, type SlotView, type VariantKey } from "../core/types";
import { Markdown } from "./Markdown";
import { markdownText } from "./markdownSubset";
import { CopyPhrase } from "./Regenerate";
import { groupByProject } from "./sessionGroups";

/** The sidebar's frame. It holds `HomePanel` until a brainstorm is open, then that brainstorm's `SessionPanel`. */
export function AppSidebar({ children }: { children: ReactNode }) {
  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader className="flex-row items-center gap-2 px-3 pt-2.5 pb-1">
        <span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          B
        </span>
        <span className="text-sm font-semibold">Brainstorm</span>
        <SidebarTrigger className="ml-auto text-muted-foreground" />
      </SidebarHeader>
      {children}
    </Sidebar>
  );
}

export function HomePanel({ sessions, onSession }: { sessions: readonly SessionListing[]; onSession: (id: SessionId) => void }) {
  const groups = useMemo(() => groupByProject(sessions), [sessions]);
  return (
    <SidebarContent className="animate-in fade-in-0 slide-in-from-left-3 duration-200" data-sidebar-panel="home">
      {groups.length === 0 ? (
        <p className="px-4 py-3 text-sm/relaxed text-muted-foreground">No brainstorms yet.</p>
      ) : (
        groups.map((group) => (
          <Collapsible key={group.projectId} defaultOpen render={<SidebarGroup data-project={group.projectId} />}>
            <SidebarGroupLabel
              render={<CollapsibleTrigger />}
              className="group/label w-full cursor-pointer gap-1 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
                      <SidebarMenuButton
                        className="h-auto flex-col items-start gap-0.5 py-1.5"
                        onClick={() => onSession(s.id)}
                        data-session={s.id}
                        data-lost={s.lost || undefined}
                      >
                        <span className="w-full truncate">{s.title}</span>
                        <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="tabular-nums">{s.latest === null ? "No iterations yet" : `Iteration ${s.latest}`}</span>
                          {s.lost && (
                            <span className="flex items-center gap-1" title="The T3 thread this brainstorm was attached to is gone" data-session-lost>
                              <Unlink aria-hidden className="size-3!" />
                              Thread lost
                            </span>
                          )}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        ))
      )}
    </SidebarContent>
  );
}

export function SessionPanel({
  title,
  view,
  onHome,
  selectedSlot,
  onSlot,
  onVariant,
}: {
  title: string;
  view: SessionView | null;
  onHome: () => void;
  selectedSlot: SlotId | null;
  onSlot: (slot: SlotId) => void;
  onVariant: (slot: SlotId, variant: VariantKey) => void;
}) {
  const slots = view?.iteration?.slots ?? [];
  const blocks = view?.iteration?.blocks ?? [];
  return (
    <SidebarContent className="animate-in fade-in-0 slide-in-from-right-3 duration-200" data-sidebar-panel="session">
      <SidebarGroup className="gap-1 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onHome} className="text-muted-foreground" data-back>
              <ChevronLeft aria-hidden />
              <span>All brainstorms</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <h2 className="px-2 pt-1 text-base/snug font-semibold text-balance" data-session-title>
          {title}
        </h2>
      </SidebarGroup>
      {view !== null && <ThreadSection view={view} />}
      {slots.map((slot) => (
        <SlotSection
          key={slot.id}
          slot={slot}
          blocks={blocks}
          selected={slot.id === selectedSlot}
          onSlot={() => onSlot(slot.id)}
          onVariant={(v) => onVariant(slot.id, v)}
        />
      ))}
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
            className="h-auto items-start py-1.5"
            title={view.attachment.threadId}
            {...(view.thread === null
              ? { disabled: true }
              : { render: <a href={view.thread.link} target="_blank" rel="noreferrer" /> })}
            data-thread-link
          >
            <span aria-hidden className={`mt-1.5 size-1.5 shrink-0 rounded-full ${lost ? "bg-warning" : "bg-attached"}`} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate">{name}</span>
              <span className="text-xs text-muted-foreground" data-thread={lost ? "lost" : "attached"}>
                {lost ? "Unattached" : "Attached"}
              </span>
            </span>
            {view.thread !== null && <ExternalLink aria-hidden className="mt-0.5 text-muted-foreground" />}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {showTakeover && (
        <div className="mx-2 mt-1 grid gap-2 rounded-lg bg-warning-surface p-2.5 text-xs/relaxed" data-takeover>
          <p className="text-warning">In a T3 thread on this project, say: {takeoverPhrase(view.session.title)}</p>
          <CopyPhrase title={view.session.title} />
        </div>
      )}
    </SidebarGroup>
  );
}

function SlotSection({
  slot,
  blocks,
  selected,
  onSlot,
  onVariant,
}: {
  slot: SlotView;
  blocks: readonly BlockView[];
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
          className="w-full cursor-pointer gap-2 hover:bg-sidebar-accent data-[selected]:text-sidebar-foreground"
          data-selected={selected || undefined}
          title="Show this slot's controls"
        >
          <span className="truncate">{slot.title}</span>
          <span className="ml-auto shrink-0 font-normal tabular-nums">
            {slot.variants.length} {slot.variants.length === 1 ? "variant" : "variants"}
          </span>
        </SidebarGroupLabel>
        <SidebarMenu role="radiogroup" aria-label={`${slot.title} variant`}>
          {slot.variants.map((variant) => {
            const block = blocks.find((b) => b.id === blockIdOf(slot.id, variant));
            const active = variant === slot.active;
            return (
              <SidebarMenuItem key={variant}>
                <SidebarMenuButton
                  role="radio"
                  aria-checked={active}
                  isActive={active}
                  onClick={() => onVariant(variant)}
                  title={active || !block?.about ? undefined : markdownText(block.about)}
                  data-variant={variant}
                >
                  <span className="min-w-0 flex-1 truncate">{block?.title ?? variant}</span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">{variant}</span>
                </SidebarMenuButton>
                {active && block?.about && (
                  <div className="grid gap-1.5 px-2 pt-1.5 pb-2 text-xs/relaxed text-muted-foreground" data-about>
                    <Markdown source={block.about} />
                  </div>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}
