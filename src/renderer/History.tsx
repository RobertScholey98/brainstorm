import { ChevronLeft, ChevronRight, GitBranch, History as HistoryIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint } from "@/components/ui/tooltip";
import { Truncate } from "@/components/ui/truncate";
import { originText } from "../core/machines";
import type { ForkBranch, HistoryEntry, IterationN, Result, SessionId, SessionPreview, SessionView, SlotId } from "../core/types";
import { IterationStill } from "./Preview";
import { STRIP_GAP, stripFit, stripRest, type StripFit } from "./stripFit";
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
 * Every entry is one width. While they fit they share the strip; once they don't, a whole number of them fill it and
 * the strip rests only on an entry's edge, so it never shows a cut entry, and the shown iteration is always whole.
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
  const list = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = iterations.at(-1)?.n;
  const items: StripItem[] = [
    ...(view.fork === null ? [] : [{ kind: "stub" } as const]),
    ...iterations.flatMap((entry) => [{ kind: "iteration", entry } as const, ...forks.filter((f) => f.from === entry.n).map((fork) => ({ kind: "fork", fork }) as const)]),
  ];
  const shownAt = items.findIndex((i) => i.kind === "iteration" && i.entry.n === showing);

  const [fit, setFit] = useState<StripFit>(() => stripFit(0, items.length));
  const [ends, setEnds] = useState({ start: true, end: true });
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const measure = () => {
      const next = stripFit(box.clientWidth, items.length);
      setFit((prev) => (prev.width === next.width && prev.shown === next.shown && prev.overflows === next.overflows ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [items.length]);

  // The shown entry stays whole in view as Rob steps, as entries land and as the strip resizes. Only the strip scrolls,
  // so the panes around it stay put.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const rest = () => {
      box.scrollTo({ left: stripRest(fit, items.length, Math.max(0, shownAt), box.scrollLeft), behavior: "instant" });
      setEnds({ start: box.scrollLeft <= 1, end: box.scrollLeft >= box.scrollWidth - box.clientWidth - 1 });
    };
    rest();
    const frame = requestAnimationFrame(rest);
    return () => cancelAnimationFrame(frame);
  }, [fit, shownAt, items.length]);

  const page = (by: -1 | 1) => {
    const box = scroller.current;
    if (box !== null) box.scrollBy({ left: by * (fit.width + STRIP_GAP), behavior: "smooth" });
  };
  const onScrollEnd = () => {
    const box = scroller.current;
    if (box !== null) setEnds({ start: box.scrollLeft <= 1, end: box.scrollLeft >= box.scrollWidth - box.clientWidth - 1 });
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
    <section className={STRIP} aria-label="History" data-history data-history-overflows={fit.overflows || undefined}>
      <StripHead
        steps={
          fit.overflows && (
            <>
              <StripStep side="start" disabled={ends.start} onClick={() => page(-1)} />
              <StripStep side="end" disabled={ends.end} onClick={() => page(1)} />
            </>
          )
        }
      >
        <Truncate data-history-count>
          {`${iterations.length} ${iterations.length === 1 ? "iteration" : "iterations"}${forks.length > 0 ? ` · ${forks.length} ${forks.length === 1 ? "fork" : "forks"}` : ""}`}
        </Truncate>
      </StripHead>
      <div ref={scroller} className={STRIP_SCROLL} onScrollEnd={onScrollEnd} data-history-scroll>
        <div
          ref={list}
          role="listbox"
          aria-label="Iterations"
          aria-orientation="horizontal"
          className={STRIP_LIST}
          style={{ "--strip-entry": `${fit.width}px` } as CSSProperties}
          onKeyDown={onKey}
          data-history-list
        >
          {items.map((item) =>
            item.kind === "stub" ? (
              <ForkStub key="stub" view={view} onOpen={onOpen} />
            ) : item.kind === "fork" ? (
              <Offshoot key={item.fork.id} fork={item.fork} onOpen={onOpen} />
            ) : (
              <StillOption
                key={item.entry.n}
                entry={item.entry}
                latest={item.entry.n === latest}
                selected={item.entry.n === showing}
                now={now}
                slot={slot}
                revision={revision}
                loadStill={loadStill}
                onShow={() => onShow(item.entry.n)}
              />
            ),
          )}
        </div>
      </div>
    </section>
  );
}

/** The strip is one row at one height whether or not it has forks or overflows, with its head standing to the left. */
const STRIP = "flex h-strip shrink-0 items-center border-t bg-card";
/** Overflow scrolls sideways and rests on an entry's edge. Its ends fade only over the inset, which at rest holds no entry. */
const STRIP_SCROLL = "scroll-fades-x scrollbar-none flex min-w-0 flex-1 snap-x snap-mandatory scroll-px-4 overflow-x-auto overflow-y-hidden";
const STRIP_LIST = "flex w-max items-center gap-4 px-4";
/** Every entry in the strip takes the one width the fit gives. */
const ENTRY = "w-strip-entry shrink-0 snap-start";

/**
 * The strip's head, one width whatever the count says, so the first entry never moves as iterations land. While the
 * entries overflow, its arrows say so and step through them, which is why the strip draws no scrollbar.
 */
function StripHead({ children, steps }: { children: ReactNode; steps?: ReactNode }) {
  return (
    <div className="flex w-menu shrink-0 flex-col justify-center gap-0.5 pl-4 text-xs text-fg-muted">
      <h2 className="flex items-center gap-1.5 font-medium text-fg">
        <HistoryIcon aria-hidden className="size-3.5" />
        History
      </h2>
      {children}
      {steps && <span className="-ml-1 mt-1 flex gap-1">{steps}</span>}
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
        <Skeleton className="mt-0.5 h-3 w-16" />
      </StripHead>
      <div className={STRIP_SCROLL}>
        <div className={STRIP_LIST}>
          <Skeleton className="h-still w-picker rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function StillOption({
  entry,
  latest,
  selected,
  now,
  slot,
  revision,
  loadStill,
  onShow,
}: {
  entry: HistoryEntry;
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
  return (
    <Hint label={origin} side="top">
      <div
        role="option"
        aria-selected={selected}
        aria-label={`Iteration ${entry.n}${latest ? ", latest" : ""}: ${origin}`}
        tabIndex={selected ? 0 : -1}
        onClick={onShow}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onShow())}
        className={cn(
          ENTRY,
          "flex cursor-pointer items-center gap-2 rounded-lg p-1 outline-none ring-1 ring-border hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-selected ring-border-strong",
        )}
        data-history-n={entry.n}
        data-selected={selected || undefined}
      >
        <IterationStill load={load} revision={revision} />
        <span className="grid min-w-0 flex-1 gap-0.5 pr-1">
          <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
            <span className="shrink-0 font-medium">Iteration {entry.n}</span>
            <Truncate className="text-xs text-fg-muted tabular-nums">{`${latest ? "latest · " : ""}${age(entry.createdAt, now)}`}</Truncate>
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
function Offshoot({ fork, onOpen }: { fork: ForkBranch; onOpen: (id: SessionId) => void }) {
  return (
    <Hint label={`Open the fork ${fork.title}`} side="top">
      <button
        type="button"
        onClick={() => onOpen(fork.id)}
        className={cn(ENTRY, FORK_BOX, "outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring")}
        data-history-fork={fork.id}
        data-history-from={fork.from}
      >
        <ForkLines first={fork.title} second={`Fork of iteration ${fork.from}`} />
      </button>
    </Hint>
  );
}

const FORK_BOX = "flex h-still items-center gap-2 rounded-lg border border-dashed px-3 text-left";

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
function ForkStub({ view, onOpen }: { view: SessionView; onOpen: (id: SessionId) => void }) {
  const fork = view.fork;
  if (fork === null) return null;
  const label = <ForkLines lead="from" first={fork.parent.title} second={fork.parent.state === "gone" ? `iteration ${fork.from} · discarded` : `iteration ${fork.from}`} />;
  return fork.parent.state === "gone" ? (
    <span className={cn(ENTRY, FORK_BOX)} data-fork-stub="gone">
      {label}
    </span>
  ) : (
    <button
      type="button"
      onClick={() => onOpen(fork.parent.id)}
      className={cn(ENTRY, FORK_BOX, "outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring")}
      data-fork-stub={fork.parent.id}
    >
      {label}
    </button>
  );
}

/**
 * One row over the canvas while Rob looks at a past iteration, as the canvas bar is one row: which iteration, the way
 * back, and what he can do from here. Its message gives way before its button in a narrow window.
 */
export function PastBar({ n, onLatest }: { n: IterationN; onLatest: () => void }) {
  return (
    <div role="status" className="flex h-10 shrink-0 items-center gap-2 border-b border-info/40 bg-info-subtle px-4 text-sm" data-past-bar={n}>
      <HistoryIcon aria-hidden className="size-3.5 shrink-0 text-info" />
      <span className="shrink-0 font-medium">Viewing iteration {n}</span>
      <Truncate className="w-0 flex-1 text-fg-muted">Read-only. Pick variants, then fork from here.</Truncate>
      <Kbd>Esc</Kbd>
      <Button variant="outline" onClick={onLatest} data-back-to-latest>
        Back to latest
      </Button>
    </div>
  );
}
