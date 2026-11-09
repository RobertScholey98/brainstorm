import { ChevronLeft, ChevronRight, CircleAlert, CornerDownRight, Plus, ThumbsUp, Trash2, Undo2, X } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, type ReactNode, type Ref, type RefObject } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Count } from "@/components/ui/count";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuMark,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { approval, mainOf, shownVariants, trashRefusal } from "../core/main";
import { partLabel } from "../core/part";
import {
  blockIdOf,
  type BlockView,
  type ContentHash,
  type IterationN,
  type Marks,
  type Pin,
  type SessionId,
  type SessionView,
  type SlotId,
  type SlotView,
  type StoredGraft,
  type VariantKey,
} from "../core/types";
import { keyEchoesTitle } from "../core/vary";
import { arrowFocus } from "./Sidebar";

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
  onMakePrimary,
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
  onMakePrimary: () => void;
  /** Held while the marks can't change (a confirm is open); the reason shows on the buttons. */
  marking: Marking;
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
          <SlotPicker slots={slots} slot={slot} marks={marks} onSlot={onSlot} onAddSlot={onAddSlot} canAdd={past === null} />
          {view.session.id !== view.tree.primary && <BranchLine view={view} onOpen={onOpen} onMakePrimary={onMakePrimary} />}
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
  marks,
  onSlot,
  onAddSlot,
  canAdd,
}: {
  slots: readonly SlotView[];
  slot: SlotView;
  /** A trashed variant has left the list, so the counts leave it out too. */
  marks: Marks;
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
              {shownVariants(slot, marks).length} {shownVariants(slot, marks).length === 1 ? "variant" : "variants"}
            </Count>
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {slots.map((s) => (
              <SelectItem key={s.id} value={s.id} data-slot-option={s.id}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Truncate>{s.title}</Truncate>
                  <span className="ml-auto text-xs text-fg-muted tabular-nums">{shownVariants(s, marks).length}</span>
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

/**
 * A branch that isn't the primary, the first line included once another took its place: where it left from, which opens
 * that line, and Make primary.
 */
function BranchLine({ view, onOpen, onMakePrimary }: { view: SessionView; onOpen: (id: SessionId) => void; onMakePrimary: () => void }) {
  const back =
    view.branchOf === null
      ? { text: "The first line, now an offshoot", hint: "Open the main line", to: view.tree.primary }
      : { text: `Branch from iteration ${view.branchOf.from}`, hint: `Open ${view.branchOf.parent.title}, the line this branch left`, to: view.branchOf.parent.id };
  return (
    <SidebarGroup className="py-1" data-branch-line={view.session.id}>
      <div className="flex min-h-8 items-center gap-1 rounded-md bg-muted py-1 pr-1 pl-0.5 text-xs text-fg-muted">
        <Hint label={back.hint} side="right">
          {/* The back chevron "All brainstorms" leads with, so the line reads as the way back to where it left, not a label. */}
          <Button variant="ghost" size="xs" className="mr-auto min-w-0" onClick={() => onOpen(back.to)} data-branch-back={back.to}>
            <ChevronLeft data-icon="inline-start" aria-hidden />
            <Truncate>{back.text}</Truncate>
          </Button>
        </Hint>
        <Hint label="Make this branch the brainstorm's main line" side="right">
          <Button variant="outline" size="xs" onClick={onMakePrimary} data-make-primary>
            Make primary
          </Button>
        </Hint>
      </div>
    </SidebarGroup>
  );
}

/** What a mark can do: the handlers while marking is open, or why it is held. */
export type Marking = (MarkHandlers & { blocked: null }) | { blocked: string };

/** What an element on its way into Main is called: its part, or the whole block's title. */
const elementName = (pin: Pin, source: BlockView | undefined) => (pin.part === null ? (source?.title ?? pin.blockId) : partLabel(pin.part));

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
  marking: Marking;
}) {
  const main = mainOf(slot, marks);
  const shown = shownVariants(slot, marks);
  const options = shown.filter((v) => v !== main);
  const trashed = slot.variants.filter((v) => !shown.includes(v));
  const grafts = marks.grafts.filter((g) => g.into === slot.id);
  // The variant whose focused 👍 just moved its row, until the row mounts in its other list and takes focus back.
  const refocus = useRef<VariantKey | null>(null);
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
        refocus={refocus}
      />
    );
  };
  // Up and down move across both lists as one, Main's row then the options', while each list is its own radio group so
  // a screen reader meets only radios in it; the grafts and the trashed fold are lists of their own.
  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        const next = arrowFocus(e, "[data-variant]")?.dataset.variant;
        if (next !== undefined) onVariant(next as VariantKey);
      }}
      data-slot-id={slot.id}
    >
      <SidebarGroup data-main-group>
        <SidebarGroupLabel>Main</SidebarGroupLabel>
        {main === null ? (
          <p className="px-2 py-1.5 text-xs text-fg-muted" data-main-empty>
            Give a design a <ThumbsUp aria-label="thumbs up" className="inline size-3 align-text-bottom" /> to make it Main
          </p>
        ) : (
          <SidebarMenu role="radiogroup" aria-label={`${slot.title}'s Main`}>
            {row(main, "main")}
          </SidebarMenu>
        )}
        {grafts.length > 0 && (
          <SidebarMenu aria-label="Going into Main">
            {grafts.map((g) => (
              <GraftRow key={g.id} graft={g} source={blocks.get(g.from.blockId)} marking={marking} />
            ))}
          </SidebarMenu>
        )}
      </SidebarGroup>
      {options.length > 0 && (
        <SidebarGroup data-options-group>
          <SidebarGroupLabel className="gap-2">
            Options
            <Count className="ml-auto">{options.length}</Count>
          </SidebarGroupLabel>
          <SidebarMenu role="radiogroup" aria-label={`${slot.title}'s options`}>
            {options.map((v) => row(v, "option"))}
          </SidebarMenu>
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
  refocus,
}: {
  slot: SlotView;
  variant: VariantKey;
  block: BlockView | undefined;
  failed: boolean;
  role: "main" | "option";
  marks: Marks;
  onVariant: (variant: VariantKey) => void;
  marking: Marking;
  /** The slot list's note of which row's 👍 should take focus back once the row mounts in its other list. */
  refocus: RefObject<VariantKey | null>;
}) {
  const active = variant === slot.active;
  const title = block?.title ?? variant;
  // The only variant left is Main without a 👍: its thumb shows, held and unfilled, so it doesn't read as a choice Rob
  // made, and its name says why there is nothing to press.
  const implicit = role === "main" && marks.mains[slot.id] === undefined;
  const verdict = block === undefined ? null : approval(slot, block, marks);
  const trashBlock = trashRefusal(slot, variant, marks);
  const approveLabel = implicit
    ? "Main, as the only variant left"
    : verdict === null
      ? ""
      : verdict.kind === "main"
        ? "Make this Main"
        : verdict.kind === "unmain"
          ? "Stop keeping this as Main"
          : verdict.kind === "graft"
            ? `Bring ${elementName(verdict.from, block)} into Main`
            : `Take ${elementName(verdict.graft.from, block)} back out of Main`;
  const pressed = verdict?.kind === "unmain" || verdict?.kind === "ungraft";
  const blocked = marking.blocked;
  // A 👍 moves its row between Main and the options, which mounts it anew in the other list; the 👍 that had focus
  // takes it back there, so the keyboard isn't dropped to the page.
  const thumb = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (refocus.current !== variant) return;
    refocus.current = null;
    thumb.current?.focus();
  }, [refocus, variant]);
  return (
    <SidebarMenuItem data-variant-row={variant} data-variant-role={role}>
      <SidebarMenuButton
        role="radio"
        aria-checked={active}
        tabIndex={active ? 0 : -1}
        isActive={active}
        onClick={() => onVariant(variant)}
        // The two 24 px marks' room, 48 px, so the title and key give way to them rather than run under them.
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
          // The key shows whole or not at all: a cut key ("ca…") names nothing. Beside a zero-width first item it either
          // fits on the one line the row shows, or wraps onto a second line that the box clips.
          <span className="flex h-4 min-w-0 flex-1 flex-wrap justify-end overflow-hidden">
            <span aria-hidden className="h-4" />
            <span className="text-xs font-normal whitespace-nowrap text-fg-muted" data-variant-key>
              {variant}
            </span>
          </span>
        )}
      </SidebarMenuButton>
      <div
        className={cn(
          "absolute top-1 right-0 flex transition-opacity md:opacity-0 group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100",
          (active || pressed || implicit) && "md:opacity-100",
        )}
        data-marks
      >
        {verdict !== null && (
          <RowMark
            label={approveLabel}
            reason={blocked}
            blocked={blocked !== null || implicit}
            pressed={pressed}
            onClick={() => {
              if (blocked !== null || implicit || block === undefined) return;
              if (thumb.current === document.activeElement) refocus.current = variant;
              marking.onApprove(block);
            }}
            ref={thumb}
            data-approve={variant}
            data-approve-kind={verdict.kind}
          >
            <ThumbsUp aria-hidden className={cn(pressed && "fill-current")} />
          </RowMark>
        )}
        {role === "option" && (
          <RowMark
            label="Trash this option"
            reason={blocked ?? trashBlock}
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

/**
 * A row's 24 px icon action. Its name is always what it does, so a screen reader tells 👍 from 🗑 even while they are
 * held; when it can't act, the hint shows why and the reason is its description.
 */
function RowMark({
  label,
  reason = null,
  blocked,
  pressed,
  onClick,
  ref,
  children,
  ...data
}: {
  label: string;
  reason?: string | null;
  blocked: boolean;
  pressed?: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Hint label={reason ?? label} side="right">
      <Button
        ref={ref}
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        aria-description={reason ?? undefined}
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
function GraftRow({ graft, source, marking }: { graft: StoredGraft; source: BlockView | undefined; marking: Marking }) {
  const what = elementName(graft.from, source);
  const from = source?.title ?? graft.from.blockId;
  return (
    <SidebarMenuItem data-graft={graft.id}>
      <div className="flex min-h-8 items-start gap-2 py-1.5 pr-8 pl-2 text-sm">
        <CornerDownRight aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span className="flex min-w-0 flex-col">
          <Truncate>{what}</Truncate>
          <Truncate className="text-xs text-fg-muted">{`from ${from}`}</Truncate>
          {/* Rob's words for where it goes are what the agent reads, so they wrap and read whole. */}
          {graft.instruction !== null && (
            <span className="text-xs break-words text-fg-muted" data-graft-instruction-text>
              “{graft.instruction}”
            </span>
          )}
        </span>
      </div>
      <div className="absolute top-1 right-1">
        <RowMark
          label={`Leave ${what} out of Main`}
          reason={marking.blocked}
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
  marking: Marking;
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
                      label={`Bring ${title} back`}
                      reason={marking.blocked}
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
