import { ChevronLeft, ChevronRight, GitBranch, History as HistoryIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { originText } from "../core/machines";
import type { ForkBranch, HistoryEntry, IterationN, Result, SessionId, SessionPreview, SessionView, SlotId } from "../core/types";
import { IterationStill, STILL_BOX } from "./Preview";
import { pageAt, pageOf, pageRest, stripFit, type EntryNeed, type StripFit } from "./stripFit";
import { age, useNow } from "./time";

export type LoadIterationStill = (at: { readonly n: IterationN; readonly slot: SlotId | null }) => Promise<Result<SessionPreview | null>>;

/** One place in the strip, in the order it shows: the stub back to a fork's parent, then each iteration and its forks. */
type StripItem = { readonly kind: "stub" } | { readonly kind: "iteration"; readonly entry: HistoryEntry } | { readonly kind: "fork"; readonly fork: ForkBranch };

/**
 * The brainstorm's history along the bottom of the canvas: a still per iteration, oldest first, each with what made it
 * and its age, and the forks made from an iteration after its still. Inside a fork the strip starts with a stub back to
 * the iteration it came from. It is one listbox: Left and Right step through it, Home and End jump, and the option Rob
 * lands on is what the canvas shows.
 *
 * While the entries fit they share the strip by what their lines need. Once they don't, they fill it a page at a time,
 * still by need, and the strip rests only on a page's start and hides any entry it can't show whole there, so at rest
 * it never shows a cut entry, and the shown iteration is always whole.
 */
export function Filmstrip({
  view,
  showing,
  slot,
  revision,
  loadStill,
  onShow,
  onOpen,
}: {
  view: SessionView;
  /** The iteration on the canvas. */
  showing: IterationN;
  /** The slot the stills show, so they match the stage. */
  slot: SlotId | null;
  revision: number;
  loadStill: LoadIterationStill;
  onShow: (n: IterationN) => void;
  onOpen: (id: SessionId) => void;
}) {
  const now = useNow();
  const { iterations, forks } = view.history;
  const section = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const steps = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = iterations.at(-1)?.n;
  const items: StripItem[] = [
    ...(view.fork === null ? [] : [{ kind: "stub" } as const]),
    ...iterations.flatMap((entry) => [{ kind: "iteration", entry } as const, ...forks.filter((f) => f.from === entry.n).map((fork) => ({ kind: "fork", fork }) as const)]),
  ];
  const shownAt = items.findIndex((i) => i.kind === "iteration" && i.entry.n === showing);

  const [fit, setFit] = useState<StripFit>(() => stripFit(0, items.map(() => ({ need: 0, floor: 0 }))));
  const overflows = fit.pages !== null;
  const [ends, setEnds] = useState({ start: true, end: true });
  useLayoutEffect(() => {
    const [strip, top, arrows, entries] = [section.current, head.current, steps.current, list.current];
    if (strip === null || top === null || arrows === null || entries === null) return;
    // The room is judged with the head at its words first. Arrows only take room, so entries that overflow without
    // them overflow with them too, and the strip never flips between the two.
    const measure = () => {
      const lines = needs(entries);
      const shown = arrows.style.display;
      arrows.style.display = "none";
      const plain = top.getBoundingClientRect().width;
      arrows.style.removeProperty("display");
      const stepped = top.getBoundingClientRect().width;
      arrows.style.display = shown;
      const loose = stripFit(strip.clientWidth - plain, lines);
      const next = loose.pages === null ? loose : stripFit(strip.clientWidth - stepped, lines);
      setFit((prev) => (String(prev.pages) === String(next.pages) && prev.widths.join() === next.widths.join() ? prev : next));
    };
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(strip);
    // An entry's lines change as its age ticks and as an origin lands.
    const lines = new MutationObserver(measure);
    lines.observe(entries, { subtree: true, childList: true, characterData: true });
    void document.fonts.ready.then(measure);
    return () => {
      sizes.disconnect();
      lines.disconnect();
    };
  }, [items.length]);

  // At rest the strip shows only whole entries. Past the oldest page, the next page's first entry can sit cut at the
  // end, so it stays out of sight until the strip moves.
  const settle = useCallback(() => {
    const box = scroller.current;
    if (box === null) return;
    setEnds({ start: box.scrollLeft <= 1, end: box.scrollLeft >= box.scrollWidth - box.clientWidth - 1 });
    const room = box.getBoundingClientRect();
    for (const entry of list.current?.children ?? []) {
      if (!(entry instanceof HTMLElement)) continue;
      const r = entry.getBoundingClientRect();
      if (r.left >= room.left - 0.5 && r.right <= room.right + 0.5) delete entry.dataset.off;
      else entry.dataset.off = "";
    }
  }, []);

  // The shown entry stays whole in view as Rob steps, as entries land and as the strip resizes. Only the strip scrolls,
  // so the panes around it stay put.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const rest = () => {
      box.scrollTo({ left: pageRest(fit, pageOf(fit, Math.max(0, shownAt))), behavior: "instant" });
      settle();
    };
    rest();
    const frame = requestAnimationFrame(rest);
    return () => cancelAnimationFrame(frame);
  }, [fit, shownAt, items.length, settle]);

  const page = (by: -1 | 1) => {
    const box = scroller.current;
    if (box === null || fit.pages === null) return;
    const to = Math.max(0, Math.min(fit.pages.length - 1, pageAt(fit, box.scrollLeft) + by));
    box.scrollTo({ left: pageRest(fit, to), behavior: "smooth" });
  };
  const onScroll = () => {
    for (const entry of list.current?.querySelectorAll<HTMLElement>("[data-off]") ?? []) delete entry.dataset.off;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = iterations.findIndex((i) => i.n === showing);
    const to =
      e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : e.key === "End" ? iterations.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = iterations[Math.max(0, Math.min(iterations.length - 1, to))];
    if (next === undefined) return;
    onShow(next.n);
    list.current?.querySelector<HTMLElement>(`[data-history-n="${next.n}"]`)?.focus({ preventScroll: true });
  };

  return (
    <section ref={section} className={STRIP} aria-label="History" data-history data-history-overflows={overflows || undefined}>
      <StripHead
        ref={head}
        steps={
          <span ref={steps} className="flex gap-0.5" style={overflows ? undefined : { display: "none" }} data-history-steps>
            <StripStep side="start" disabled={ends.start} onClick={() => page(-1)} />
            <StripStep side="end" disabled={ends.end} onClick={() => page(1)} />
          </span>
        }
      >
        <span className="whitespace-nowrap" data-history-count>
          {`${iterations.length} ${iterations.length === 1 ? "iteration" : "iterations"}${forks.length > 0 ? ` · ${forks.length} ${forks.length === 1 ? "fork" : "forks"}` : ""}`}
        </span>
      </StripHead>
      <div className="relative flex min-w-0 flex-1 self-stretch">
        <EdgeCue side="start" shown={overflows && !ends.start} />
        <EdgeCue side="end" shown={overflows && !ends.end} />
        <div ref={scroller} className={STRIP_SCROLL} onScroll={onScroll} onScrollEnd={settle} data-history-scroll>
        <div
          ref={list}
          role="listbox"
          aria-label="Iterations"
          aria-orientation="horizontal"
          className={STRIP_LIST}
          style={{ "--strip-columns": fit.widths.map((w) => `${w}px`).join(" ") } as CSSProperties}
          onKeyDown={onKey}
          data-history-list
        >
          {items.map((item, i) => {
            const snap = fit.pages?.includes(i) === true;
            return item.kind === "stub" ? (
              <ForkStub key="stub" view={view} snap={snap} onOpen={onOpen} />
            ) : item.kind === "fork" ? (
              <Offshoot key={item.fork.id} fork={item.fork} snap={snap} onOpen={onOpen} />
            ) : (
              <StillOption
                key={item.entry.n}
                snap={snap}
                entry={item.entry}
                latest={item.entry.n === latest}
                selected={item.entry.n === showing}
                now={now}
                slot={slot}
                revision={revision}
                loadStill={loadStill}
                onShow={() => onShow(item.entry.n)}
              />
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * A shadow at an end with more that way, over the inset, which at rest holds no entry. It runs the strip's full height
 * in `shade`, dark in both themes, so it reads as the strip's edge and never as an entry.
 */
function EdgeCue({ side, shown }: { side: "start" | "end"; shown: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 z-raised w-4 from-shade via-shade/40 via-25% to-transparent transition-opacity",
        side === "start" ? "left-0 bg-linear-to-r" : "right-0 bg-linear-to-l",
        shown ? "opacity-100" : "opacity-0",
      )}
      data-history-cue={side}
      data-shown={shown || undefined}
    />
  );
}

/** The strip is one row at one height whether or not it has forks or overflows, with its head standing to the left. */
const STRIP = "flex h-strip shrink-0 items-center border-t bg-card";
/** Overflow scrolls sideways and rests on a page's start. Its ends fade only over the inset, which at rest holds no entry. */
const STRIP_SCROLL = "scroll-fades-x scrollbar-none flex min-w-0 flex-1 snap-x snap-mandatory scroll-px-4 overflow-x-auto overflow-y-hidden";
const STRIP_LIST = "grid w-max grid-flow-col grid-cols-strip items-center gap-4 px-4";
/** Every entry in the strip takes the width the fit gives it, its column's, and goes out of sight while the strip rests with it cut. */
const ENTRY = "min-w-0 transition-opacity data-off:pointer-events-none data-off:opacity-0";
/** A page's first entry, the only place the strip rests. */
const SNAP = "snap-start";
/** An iteration's entry: its still, then its lines, inside a 1 px edge that holds on the card in both themes. */
const ENTRY_BOX = "flex items-center gap-2 rounded-lg p-1 ring-1";

/**
 * What each entry needs: its width at max-content for every line to read whole, and its width with only its number
 * and its age, the words that never give way.
 */
function needs(list: HTMLElement): EntryNeed[] {
  return [...list.children].map((entry) => {
    if (!(entry instanceof HTMLElement)) return { need: 0, floor: 0 };
    entry.style.width = "max-content";
    const need = entry.getBoundingClientRect().width;
    const optional = [...entry.querySelectorAll<HTMLElement>("[data-history-origin], [data-history-latest]")];
    let floor = 0;
    if (optional.length > 0) {
      for (const el of optional) el.style.display = "none";
      floor = entry.getBoundingClientRect().width;
      for (const el of optional) el.style.removeProperty("display");
    }
    entry.style.removeProperty("width");
    return { need, floor };
  });
}

/**
 * The strip's head, as wide as its words. While the entries overflow, its arrows follow the heading on its first line,
 * which always has their height, so the heading keeps one place whether or not they show. They step through the
 * entries, which is why the strip draws no scrollbar.
 */
function StripHead({ children, steps, ref }: { children: ReactNode; steps?: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="flex w-max shrink-0 flex-col justify-center gap-0.5 pl-4 text-xs text-fg-muted" data-history-head>
      <span className="flex h-6 items-center gap-2">
        <h2 className="flex items-center gap-1.5 font-medium text-fg">
          <HistoryIcon aria-hidden className="size-3.5" />
          History
        </h2>
        {steps}
      </span>
      {children}
    </div>
  );
}

function StripStep({ side, disabled, onClick }: { side: "start" | "end"; disabled: boolean; onClick: () => void }) {
  const label = side === "start" ? "Earlier in the history" : "Later in the history";
  return (
    <Hint label={label} side="top">
      <Button variant="ghost" size="icon-xs" aria-label={label} disabled={disabled} onClick={onClick} data-history-step={side}>
        {side === "start" ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
      </Button>
    </Hint>
  );
}

/** The strip while the brainstorm loads, at its own height, so the stage doesn't move when it lands. */
export function FilmstripSkeleton() {
  return (
    <div aria-hidden className={STRIP} data-history-loading>
      <StripHead>
        <Skeleton className="w-max text-transparent">1 iteration</Skeleton>
      </StripHead>
      <div className={STRIP_SCROLL}>
        <div className={STRIP_LIST}>
          {/* A first iteration's entry, its words hidden in the bars, in the landed entry's frame, edge and still. */}
          <div className={cn(ENTRY_BOX, "ring-border-strong")} data-history-skeleton-entry>
            <Skeleton className={STILL_BOX} data-history-skeleton-still />
            <span className="grid gap-0.5 pr-1">
              <span className="flex h-4.5 items-baseline gap-x-1.5 text-sm">
                <Skeleton className="font-medium text-transparent">Iteration 1</Skeleton>
                <Skeleton className="text-xs text-transparent">·</Skeleton>
                <Skeleton className="text-xs text-transparent">now</Skeleton>
                <Skeleton className="text-xs text-transparent">· latest</Skeleton>
              </span>
              <Skeleton className="text-xs text-transparent">{originText({ kind: "brief" })}</Skeleton>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StillOption({
  entry,
  snap,
  latest,
  selected,
  now,
  slot,
  revision,
  loadStill,
  onShow,
}: {
  entry: HistoryEntry;
  snap: boolean;
  latest: boolean;
  selected: boolean;
  now: number;
  slot: SlotId | null;
  revision: number;
  loadStill: LoadIterationStill;
  onShow: () => void;
}) {
  const load = useCallback(() => loadStill({ n: entry.n, slot }), [loadStill, entry.n, slot]);
  const origin = originText(entry.origin);
  const when = `${age(entry.createdAt, now)}${latest ? " · latest" : ""}`;
  return (
    <Hint name={`Iteration ${entry.n}`} label={`${when} · ${origin}`} side="top">
      <div
        role="option"
        aria-selected={selected}
        aria-label={`Iteration ${entry.n}, ${when.replace(" · ", ", ")}: ${origin}`}
        tabIndex={selected ? 0 : -1}
        onClick={onShow}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onShow())}
        className={cn(ENTRY, snap && SNAP, ENTRY_BOX, "cursor-pointer outline-none ring-border-strong hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring", selected && "bg-selected")}
        data-history-n={entry.n}
        data-selected={selected || undefined}
      >
        <IterationStill load={load} revision={revision} />
        <span className="grid min-w-0 flex-1 gap-0.5 pr-1">
          {/* One line that never cuts: "latest" comes last and wraps out of sight, whole, when it doesn't fit. */}
          <span className="flex h-4.5 min-w-0 flex-wrap items-baseline gap-x-1.5 overflow-hidden text-sm">
            <span className="font-medium">Iteration {entry.n}</span>
            <span className="text-xs text-fg-muted">·</span>
            <span className="text-xs text-fg-muted tabular-nums" data-history-age>
              {age(entry.createdAt, now)}
            </span>
            {latest && (
              <span className="text-xs text-fg-muted" data-history-latest>
                · latest
              </span>
            )}
          </span>
          <Truncate className="text-xs" data-history-origin>
            {origin}
          </Truncate>
        </span>
      </div>
    </Hint>
  );
}

/** A fork made from the iteration before it, as wide as a still and dashed as the fork's own stub, so it never reads as one more iteration. */
function Offshoot({ fork, snap, onOpen }: { fork: ForkBranch; snap: boolean; onOpen: (id: SessionId) => void }) {
  return (
    <Hint label={`Open the fork ${fork.title}`} side="top">
      <button
        type="button"
        onClick={() => onOpen(fork.id)}
        className={cn(ENTRY, snap && SNAP, FORK_BOX, "outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring")}
        data-history-fork={fork.id}
        data-history-from={fork.from}
      >
        <ForkLines first={fork.title} second={`Fork of iteration ${fork.from}`} />
      </button>
    </Hint>
  );
}

/** Dashed in the entries' strong edge, so a link off the strip holds its shape as an entry does. */
const FORK_BOX = "flex h-still items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 text-left";

function ForkLines({ first, second, lead }: { first: string; second: string; lead?: string }) {
  return (
    <>
      <GitBranch aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
      <span className="grid min-w-0 flex-1 gap-0.5 text-xs">
        <span className="flex min-w-0 gap-1">
          {lead !== undefined && <span className="shrink-0">{lead}</span>}
          <Truncate className="font-medium">{first}</Truncate>
        </span>
        <span className="text-fg-muted">{second}</span>
      </span>
    </>
  );
}

/** Where a fork came from, first in its strip: a link back to that iteration's brainstorm, unless it is gone. */
function ForkStub({ view, snap, onOpen }: { view: SessionView; snap: boolean; onOpen: (id: SessionId) => void }) {
  const fork = view.fork;
  if (fork === null) return null;
  const label = <ForkLines lead="from" first={fork.parent.title} second={fork.parent.state === "gone" ? `iteration ${fork.from} · discarded` : `iteration ${fork.from}`} />;
  return fork.parent.state === "gone" ? (
    <span className={cn(ENTRY, snap && SNAP, FORK_BOX)} data-fork-stub="gone">
      {label}
    </span>
  ) : (
    <button
      type="button"
      onClick={() => onOpen(fork.parent.id)}
      className={cn(ENTRY, snap && SNAP, FORK_BOX, "outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring")}
      data-fork-stub={fork.parent.id}
    >
      {label}
    </button>
  );
}

/**
 * One row over the canvas while Rob looks at a past iteration, as the canvas bar is one row: which iteration, the way
 * back, and what he can do from here. Its message gives way before its button in a narrow window. Its text starts 16 px
 * in, and its button ends 8 px in, where the canvas bar's view switch ends.
 */
export function PastBar({ n, onLatest }: { n: IterationN; onLatest: () => void }) {
  return (
    <div role="status" className="flex h-10 shrink-0 items-center gap-2 border-b border-info/40 bg-info-subtle pr-2 pl-4 text-sm" data-past-bar={n}>
      <HistoryIcon aria-hidden className="size-3.5 shrink-0 text-info" />
      <span className="shrink-0 font-medium">Viewing iteration {n}</span>
      <Truncate className="w-0 flex-1 text-fg-muted">Pick variants, then fork from here.</Truncate>
      <Kbd>Esc</Kbd>
      <Button variant="outline" onClick={onLatest} data-back-to-latest>
        Back to latest
      </Button>
    </div>
  );
}
