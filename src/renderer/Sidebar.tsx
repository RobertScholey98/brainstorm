import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Component, CornerDownRight, GitBranch, LayoutGrid, Plus, ThumbsUp, Trash2, Undo2, X } from "lucide-react";
import { createContext, useContext, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import { cn } from "cn";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { Count } from "@/components/ui/count";
import { blockIdOf, type BlockView, type ContentHash, type IterationN, type Marks, type SessionId, type SessionListing, type SessionView, type SlotId, type SlotView, type StoredGraft, type VariantKey } from "../core/types";
import { approval, mainOf, shownVariants, trashRefusal } from "../core/main";
import { partLabel } from "../core/part";
import { keyEchoesTitle } from "../core/fork";
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

export type MarkHandlers = {
  onApprove: (block: BlockView) => void;
  onTrash: (block: BlockView) => void;
  onRestore: (block: BlockView) => void;
  onRemoveGraft: (graft: StoredGraft) => void;
};

/**
 * One brainstorm's sidebar (ADR 009): the slot picker, then the picked slot's Main and its options, each option with a
 * 👍 and a 🗑, and the trashed fold. Confirm sits at its foot. A branch that isn't the primary says so above Main.
 */
export function SessionPanel({
  view,
  slots,
  blocks,
  blockErrors,
  marks,
  past,
  onHome,
  onOpen,
  selectedSlot,
  onSlot,
  onVariant,
  onAddSlot,
  marking,
  confirm,
}: {
  view: SessionView | null;
  slots: readonly SlotView[];
  blocks: readonly BlockView[];
  blockErrors: ReadonlyMap<ContentHash, string>;
  /** The marks on the iteration showing: the stored ones at the latest, the window's own in the past. */
  marks: Marks;
  /** The past iteration on the canvas, or null at the latest. */
  past: IterationN | null;
  onHome: () => void;
  /** Opens another branch of the brainstorm: the primary, or the one this branch left. */
  onOpen: (id: SessionId) => void;
  selectedSlot: SlotId | null;
  onSlot: (slot: SlotId) => void;
  onVariant: (slot: SlotId, variant: VariantKey) => void;
  onAddSlot: () => void;
  /** Null while the marks can't change: a confirm is open. The reason shows on the buttons. */
  marking: (MarkHandlers & { blocked: null }) | { blocked: string };
  /** Confirm, at the panel's foot. */
  confirm: ReactNode;
}) {
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);
  const slot = slots.find((s) => s.id === selectedSlot) ?? slots[0] ?? null;
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
      {view === null || slot === null ? (
        <div data-session-loading>
          <SidebarGroup className="py-1">
            {/* The slot picker, then Main and the options. */}
            <Skeleton className="mx-2 h-7" />
          </SidebarGroup>
          <SidebarGroup>
            <div className="flex h-8 items-center px-2">
              <Skeleton className="h-3 w-12" />
            </div>
            <SidebarMenu>
              {(["w-1/2", "w-2/3", "w-1/2"] as const).map((width, i) => (
                <SidebarMenuItem key={i}>
                  <SidebarMenuSkeleton width={width} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </div>
      ) : (
        <>
          <SlotPicker slots={slots} slot={slot} onSlot={onSlot} onAddSlot={onAddSlot} canAdd={past === null} />
          {view.session.id !== view.tree.primary && <BranchLine view={view} />}
          <SlotMarks
            key={slot.id}
            slot={slot}
            blocks={byId}
            blockErrors={blockErrors}
            marks={marks}
            onVariant={(v) => onVariant(slot.id, v)}
            marking={marking}
          />
        </>
      )}
      {view !== null && slot !== null && <div className="sticky bottom-0 mt-auto bg-app px-2 pt-2 pb-2">{confirm}</div>}
    </SidebarContent>
  );
}

const ADD_SLOT = "__add_slot";

/** Which slot the panel shows, where the thread used to be. Add slot opens its dialog; adding needs the latest. */
function SlotPicker({
  slots,
  slot,
  onSlot,
  onAddSlot,
  canAdd,
}: {
  slots: readonly SlotView[];
  slot: SlotView;
  onSlot: (slot: SlotId) => void;
  onAddSlot: () => void;
  canAdd: boolean;
}) {
  const items = [...slots.map((s) => ({ value: s.id as string, label: s.title })), ...(canAdd ? [{ value: ADD_SLOT, label: "Add slot…" }] : [])];
  return (
    <SidebarGroup className="py-1">
      <Select
        items={items}
        value={slot.id as string}
        onValueChange={(v) => {
          if (v === ADD_SLOT) onAddSlot();
          else if (v !== null) onSlot(v as SlotId);
        }}
      >
        <SelectTrigger aria-label="Slot" className="w-full justify-between" data-slot-picker={slot.id}>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <Truncate className="font-medium">{slot.title}</Truncate>
            <Count className="ml-auto" data-slot-count>
              {slot.variants.length} {slot.variants.length === 1 ? "variant" : "variants"}
            </Count>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {slots.map((s) => (
              <SelectItem key={s.id} value={s.id} data-slot-option={s.id}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Truncate>{s.title}</Truncate>
                  <span className="ml-auto text-xs text-fg-muted tabular-nums">{s.variants.length}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
          {canAdd && (
            <>
              <SelectSeparator />
              <SelectItem value={ADD_SLOT} data-add-slot>
                <Plus aria-hidden className="size-3.5" />
                Add slot…
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
    </SidebarGroup>
  );
}

/** A branch that isn't the primary, the first line included once another took its place: what it is, and Make primary. */
function BranchLine({ view }: { view: SessionView }) {
  return (
    <SidebarGroup className="py-1" data-branch-line={view.session.id}>
      <div className="flex min-h-8 items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-fg-muted">
        <GitBranch aria-hidden className="size-3.5 shrink-0" />
        <Truncate className="flex-1">{view.fork === null ? "The first line, now an offshoot" : `Branch from iteration ${view.fork.from}`}</Truncate>
        <MakePrimary />
      </div>
    </SidebarGroup>
  );
}

/** Make primary is the session's own action, sent through the panel's context so the line needs no handler threading. */
function MakePrimary() {
  const act = useContext(PanelActions);
  return (
    <Hint label="Make this branch the brainstorm's main line" side="right">
      <Button variant="outline" size="xs" onClick={act.onMakePrimary} data-make-primary>
        Make primary
      </Button>
    </Hint>
  );
}

export const PanelActions = createContext<{ onMakePrimary: () => void }>({ onMakePrimary: () => {} });

/**
 * The picked slot: Main and what goes into it, then the other variants as options, then the ones Rob trashed. Up and
 * down move between the variant rows, Main's and the options', as one list.
 */
function SlotMarks({
  slot,
  blocks,
  blockErrors,
  marks,
  onVariant,
  marking,
}: {
  slot: SlotView;
  blocks: ReadonlyMap<string, BlockView>;
  blockErrors: ReadonlyMap<ContentHash, string>;
  marks: Marks;
  onVariant: (variant: VariantKey) => void;
  marking: (MarkHandlers & { blocked: null }) | { blocked: string };
}) {
  const main = mainOf(slot, marks);
  const shown = shownVariants(slot, marks);
  const options = shown.filter((v) => v !== main);
  const trashed = slot.variants.filter((v) => !shown.includes(v));
  const grafts = marks.grafts.filter((g) => g.into === slot.id);
  const row = (variant: VariantKey, role: "main" | "option") => {
    const block = blocks.get(blockIdOf(slot.id, variant));
    return (
      <VariantRow
        key={variant}
        slot={slot}
        variant={variant}
        block={block}
        failed={block !== undefined && blockErrors.has(block.hash)}
        role={role}
        marks={marks}
        onVariant={onVariant}
        marking={marking}
      />
    );
  };
  return (
    <div
      role="radiogroup"
      aria-label={`${slot.title} variant`}
      className="flex flex-col"
      onKeyDown={(e) => {
        const next = arrowFocus(e, "[data-variant]")?.dataset.variant;
        if (next !== undefined) onVariant(next as VariantKey);
      }}
      data-slot-id={slot.id}
    >
      <SidebarGroup data-main-group>
        <SidebarGroupLabel>Main</SidebarGroupLabel>
        <SidebarMenu>
          {main === null ? (
            <li className="px-2 py-1.5 text-xs text-fg-muted" data-main-empty>
              Give a design a <ThumbsUp aria-label="thumbs up" className="inline size-3 align-text-bottom" /> to make it Main
            </li>
          ) : (
            row(main, "main")
          )}
          {grafts.map((g) => (
            <GraftRow key={g.id} graft={g} source={blocks.get(g.from.blockId)} marking={marking} />
          ))}
        </SidebarMenu>
      </SidebarGroup>
      {options.length > 0 && (
        <SidebarGroup data-options-group>
          <SidebarGroupLabel className="gap-2">
            Options
            <Count className="ml-auto">{options.length}</Count>
          </SidebarGroupLabel>
          <SidebarMenu>{options.map((v) => row(v, "option"))}</SidebarMenu>
        </SidebarGroup>
      )}
      {trashed.length > 0 && <TrashedFold slot={slot} variants={trashed} blocks={blocks} marking={marking} />}
    </div>
  );
}

/** A variant: picking it shows it; its 👍 and 🗑 sit at the right, on hover, on focus and on the showing row. */
function VariantRow({
  slot,
  variant,
  block,
  failed,
  role,
  marks,
  onVariant,
  marking,
}: {
  slot: SlotView;
  variant: VariantKey;
  block: BlockView | undefined;
  failed: boolean;
  role: "main" | "option";
  marks: Marks;
  onVariant: (variant: VariantKey) => void;
  marking: (MarkHandlers & { blocked: null }) | { blocked: string };
}) {
  const active = variant === slot.active;
  const title = block?.title ?? variant;
  const verdict = block === undefined ? null : approval(slot, block, marks);
  const trashBlock = trashRefusal(slot, variant, marks);
  const approveLabel =
    verdict === null
      ? ""
      : verdict.kind === "main"
        ? "Make this Main"
        : verdict.kind === "unmain"
          ? "Stop keeping this as Main"
          : verdict.kind === "graft"
            ? `Bring ${partLabel(verdict.from.part!)} into Main`
            : `Take ${partLabel(verdict.graft.from.part!)} back out of Main`;
  const pressed = verdict?.kind === "unmain" || verdict?.kind === "ungraft";
  const blocked = marking.blocked;
  return (
    <SidebarMenuItem data-variant-row={variant} data-variant-role={role}>
      <SidebarMenuButton
        role="radio"
        aria-checked={active}
        tabIndex={active ? 0 : -1}
        isActive={active}
        onClick={() => onVariant(variant)}
        // The two marks' room, so the title gives way to them rather than run under them.
        className="pr-12"
        data-variant={variant}
        data-showing={active || undefined}
      >
        <SidebarMenuMark className={cn(active && "bg-fg-muted", block?.isNew === true && "outline-2 outline-offset-1 outline-accent")} />
        {block?.isNew === true && (
          <span className="sr-only" data-variant-new>
            new
          </span>
        )}
        <Truncate className="max-w-full shrink-0" data-variant-title>
          {title}
        </Truncate>
        {failed && (
          <Hint label="This block failed to render" side="left">
            <CircleAlert aria-label="Failed to render" className="text-danger" data-variant-error />
          </Hint>
        )}
        {!keyEchoesTitle(variant, title) && (
          <Truncate className="flex-1 text-right text-xs font-normal text-fg-muted" data-variant-key>
            {variant}
          </Truncate>
        )}
      </SidebarMenuButton>
      <div
        className={cn(
          "absolute top-1 right-1 flex gap-0.5 transition-opacity md:opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100",
          (active || pressed) && "md:opacity-100",
        )}
        data-marks
      >
        {verdict !== null && (
          <RowMark
            label={blocked ?? approveLabel}
            blocked={blocked !== null}
            pressed={pressed}
            onClick={() => blocked === null && block !== undefined && marking.onApprove(block)}
            data-approve={variant}
            data-approve-kind={verdict.kind}
          >
            <ThumbsUp aria-hidden className={cn(pressed && "fill-current")} />
          </RowMark>
        )}
        {role === "option" && (
          <RowMark
            label={blocked ?? trashBlock ?? "Trash this option"}
            blocked={blocked !== null || trashBlock !== null}
            onClick={() => blocked === null && trashBlock === null && block !== undefined && marking.onTrash(block)}
            data-trash={variant}
          >
            <Trash2 aria-hidden />
          </RowMark>
        )}
      </div>
    </SidebarMenuItem>
  );
}

/** A row's 24 px icon action, named by its hint, which says why when it can't act. */
function RowMark({
  label,
  blocked,
  pressed,
  onClick,
  children,
  ...data
}: {
  label: string;
  blocked: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Hint label={label} side="right">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={blocked || undefined}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        {...data}
      >
        {children}
      </Button>
    </Hint>
  );
}

/** An element on its way into Main: what it is and where it comes from, with its removal. */
function GraftRow({ graft, source, marking }: { graft: StoredGraft; source: BlockView | undefined; marking: (MarkHandlers & { blocked: null }) | { blocked: string } }) {
  const what = graft.from.part === null ? (source?.title ?? graft.from.blockId) : partLabel(graft.from.part);
  const from = source?.title ?? graft.from.blockId;
  return (
    <SidebarMenuItem data-graft={graft.id}>
      <div className="flex min-h-8 items-start gap-2 py-1.5 pr-8 pl-2 text-sm">
        <CornerDownRight aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span className="flex min-w-0 flex-col">
          <Truncate>{what}</Truncate>
          <Truncate className="text-xs text-fg-muted">{graft.instruction === null ? `from ${from}` : `from ${from} · ${graft.instruction}`}</Truncate>
        </span>
      </div>
      <div className="absolute top-1 right-1">
        <RowMark
          label={marking.blocked ?? `Leave ${what} out of Main`}
          blocked={marking.blocked !== null}
          onClick={() => marking.blocked === null && marking.onRemoveGraft(graft)}
          data-remove-graft={String(graft.id)}
        >
          <X aria-hidden />
        </RowMark>
      </div>
    </SidebarMenuItem>
  );
}

/** The slot's trashed variants, shut by default with their count. Each comes back with its restore. */
function TrashedFold({
  slot,
  variants,
  blocks,
  marking,
}: {
  slot: SlotView;
  variants: readonly VariantKey[];
  blocks: ReadonlyMap<string, BlockView>;
  marking: (MarkHandlers & { blocked: null }) | { blocked: string };
}) {
  return (
    <Collapsible className="group/trashed" data-trashed-fold={variants.length}>
      <SidebarGroup className="pt-0">
        <SidebarGroupLabel render={<CollapsibleTrigger />} className="w-full cursor-pointer gap-2 hover:bg-hover hover:text-fg" data-trashed-toggle>
          <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[open]/trashed:rotate-90" />
          {variants.length} trashed
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarMenu>
            {variants.map((v) => {
              const block = blocks.get(blockIdOf(slot.id, v));
              const title = block?.title ?? v;
              return (
                <SidebarMenuItem key={v} data-trashed={v}>
                  <div className="flex h-8 items-center gap-2 pr-8 pl-2 text-sm text-fg-muted line-through decoration-fg-muted/60">
                    <Truncate>{title}</Truncate>
                  </div>
                  <div className="absolute top-1 right-1">
                    <RowMark
                      label={marking.blocked ?? `Bring ${title} back`}
                      blocked={marking.blocked !== null}
                      onClick={() => marking.blocked === null && block !== undefined && marking.onRestore(block)}
                      data-restore={v}
                    >
                      <Undo2 aria-hidden />
                    </RowMark>
                  </div>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
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

