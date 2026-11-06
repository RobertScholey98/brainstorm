import { GitBranch, History as HistoryIcon } from "lucide-react";
import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Hint } from "@/components/ui/tooltip";
import { originText } from "../core/machines";
import type { ForkBranch, HistoryEntry, IterationN, Result, SessionId, SessionPreview, SessionView, SlotId } from "../core/types";
import { IterationStill } from "./Preview";
import { age, useNow } from "./time";

export type LoadIterationStill = (at: { readonly n: IterationN; readonly slot: SlotId | null }) => Promise<Result<SessionPreview | null>>;

/**
 * The brainstorm's history along the bottom of the canvas: a still per iteration, oldest first, each with what made it
 * and its age, and the forks made from an iteration branching under its still. Inside a fork the strip starts with a
 * stub back to the iteration it came from. It is one listbox: Left and Right step through it, Home and End jump, and
 * the option Rob lands on is what the canvas shows.
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
  const latest = iterations.at(-1)?.n;

  const scroller = useRef<HTMLDivElement>(null);
  // The option on the canvas stays in view as Rob steps and as the window resizes, so the strip opens at its newest
  // end. Only the strip scrolls: scrollIntoView would move the panes around it too.
  useEffect(() => {
    const box = scroller.current;
    if (box === null) return;
    const reveal = () => {
      const option = box.querySelector<HTMLElement>(`[data-history-n="${showing}"]`);
      if (option === null) return;
      const [edge, at] = [box.getBoundingClientRect(), option.getBoundingClientRect()];
      if (at.right > edge.right) box.scrollLeft += at.right - edge.right;
      else if (at.left < edge.left) box.scrollLeft -= edge.left - at.left;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(box);
    return () => observer.disconnect();
  }, [showing, iterations.length]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = iterations.findIndex((i) => i.n === showing);
    const to =
      e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : e.key === "End" ? iterations.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = iterations[Math.max(0, Math.min(iterations.length - 1, to))];
    if (next === undefined) return;
    onShow(next.n);
    list.current?.querySelector<HTMLElement>(`[data-history-n="${next.n}"]`)?.focus();
  };

  return (
    <section className="flex shrink-0 flex-col gap-2 border-t bg-card px-4 pt-2 pb-3" aria-label="History" data-history>
      <h2 className="flex items-center gap-1.5 text-xs text-fg-muted">
        <HistoryIcon aria-hidden className="size-3.5" />
        <span className="font-medium text-fg">History</span>
        <span>
          {iterations.length} {iterations.length === 1 ? "iteration" : "iterations"}
          {forks.length > 0 && ` · ${forks.length} ${forks.length === 1 ? "fork" : "forks"}`}
        </span>
      </h2>
      <div ref={scroller} className="flex min-w-0 items-start gap-2 overflow-x-auto pb-1" data-history-scroll>
        {view.fork !== null && <ForkStub view={view} onOpen={onOpen} />}
        <div
          ref={list}
          role="listbox"
          aria-label="Iterations"
          aria-orientation="horizontal"
          className="flex items-start gap-2"
          onKeyDown={onKey}
          data-history-list
        >
          {iterations.map((entry, i) => (
            <div key={entry.n} className="flex items-start gap-2">
              {i > 0 && <span aria-hidden className="mt-8 h-px w-3 shrink-0 bg-border-strong" />}
              <div className="flex flex-col items-start gap-1">
                <StillOption
                  entry={entry}
                  latest={entry.n === latest}
                  selected={entry.n === showing}
                  now={now}
                  slot={slot}
                  revision={revision}
                  loadStill={loadStill}
                  onShow={() => onShow(entry.n)}
                />
                <Offshoots forks={forks.filter((f) => f.from === entry.n)} onOpen={onOpen} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
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
          "flex w-picker cursor-pointer items-start gap-2 rounded-lg p-1.5 outline-none ring-1 ring-border hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-selected ring-border-strong",
        )}
        data-history-n={entry.n}
        data-selected={selected || undefined}
      >
        <IterationStill load={load} revision={revision} />
        <span className="grid min-w-0 gap-0.5 pt-0.5">
          <span className="text-sm font-medium">Iteration {entry.n}</span>
          <span className="text-xs text-fg-muted tabular-nums">
            {latest ? "latest · " : ""}
            {age(entry.createdAt, now)}
          </span>
          <span className="truncate text-xs" data-history-origin>
            {origin}
          </span>
        </span>
      </div>
    </Hint>
  );
}

/** The forks made from one iteration, each a link to its brainstorm, hanging under the still they branch from. */
function Offshoots({ forks, onOpen }: { forks: readonly ForkBranch[]; onOpen: (id: SessionId) => void }) {
  if (forks.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 pl-3" aria-label="Forks from this iteration">
      {forks.map((f) => (
        <li key={f.id} className="flex items-center gap-1">
          <span aria-hidden className="h-3 w-2 shrink-0 rounded-bl-sm border-b border-l border-border-strong" />
          <Button variant="ghost" onClick={() => onOpen(f.id)} data-history-fork={f.id}>
            <GitBranch data-icon="inline-start" aria-hidden />
            <span className="max-w-menu truncate">{f.title}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Where a fork came from, first in its strip: a link back to that iteration's brainstorm, unless it is gone. */
function ForkStub({ view, onOpen }: { view: SessionView; onOpen: (id: SessionId) => void }) {
  const fork = view.fork;
  if (fork === null) return null;
  const label = (
    <>
      <GitBranch aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
      <span className="grid min-w-0 gap-0.5 text-left">
        <span className="truncate text-xs">
          from <span className="font-medium">{fork.parent.title}</span>
        </span>
        <span className="text-xs text-fg-muted">{fork.parent.state === "gone" ? `iteration ${fork.from} · discarded` : `iteration ${fork.from}`}</span>
      </span>
    </>
  );
  return (
    <div className="flex shrink-0 items-start gap-2">
      {fork.parent.state === "gone" ? (
        <span className="flex w-menu items-start gap-1.5 rounded-lg border border-dashed p-2" data-fork-stub="gone">
          {label}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(fork.parent.id)}
          className="flex w-menu items-start gap-1.5 rounded-lg border border-dashed p-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
          data-fork-stub={fork.parent.id}
        >
          {label}
        </button>
      )}
      <span aria-hidden className="mt-8 h-px w-3 shrink-0 border-t border-dashed border-border-strong" />
    </div>
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
      <span className="w-0 flex-1 truncate text-fg-muted">Read-only. Pick variants, then fork from here.</span>
      <Kbd>Esc</Kbd>
      <Button variant="outline" onClick={onLatest} data-back-to-latest>
        Back to latest
      </Button>
    </div>
  );
}
