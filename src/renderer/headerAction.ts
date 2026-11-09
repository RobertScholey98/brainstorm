import { useLayoutEffect, type RefObject } from "react";
import { overflows, shows, SLACK } from "@/components/ui/ink";
import type { RequestPhaseAction } from "../core/types";

/**
 * The order the header gives up its words when the breadcrumb runs short, first to last: Regenerate drops its glyph,
 * the request status drops its time, then falls to its short name, then the thread chip folds to its dot, then Export,
 * then the phase actions (see `actionRank`). Each step costs the least where Rob is looking: the chip's word repeats
 * what its dot and the status say, Export matters least while a request is open, and the first phase action is its
 * recovery.
 */
export const COLLAPSE = { glyph: 0, elapsed: 1, status: 2, thread: 3, export: 4, action: 10 } as const;

/**
 * The order the phase actions give way. Open thread goes first, since its glyph reads alone where Withdraw's would read
 * as the withdrawn status; the phase's own step, its recovery, goes last.
 */
const ACTION_RANK: Record<RequestPhaseAction, number> = { open_thread: 0, withdraw: 1, retry: 2, resend: 2, fresh_thread: 2 };

export const actionRank = (action: RequestPhaseAction): number => COLLAPSE.action + ACTION_RANK[action];

/** A header button that gives up its label for its icon, its name kept for screen readers and in its hint. */
export const COMPACT = "data-collapsed:size-7";
export const COMPACT_LABEL = "in-data-collapsed:sr-only";

/** The breadcrumb's floors: the title keeps 160 px or reads whole, and a branch's primary keeps 64 px or reads whole. */
const TITLE_FLOOR = 160;
const ANCESTOR_FLOOR = 64;

function crumbFits(header: HTMLElement): boolean {
  const title = header.querySelector("[data-session-title]");
  return (title === null || shows(title, TITLE_FLOOR)) && [...header.querySelectorAll("[data-breadcrumb-root]")].every((a) => shows(a, ANCESTOR_FLOOR));
}

/**
 * Fits a row to its room, giving way in `data-collapse` rank order until `fits` holds. A mark ranked under `marks`,
 * such as a glyph, comes back once a later label frees its room, so a label that frees 200 px doesn't leave a 20 px
 * glyph gone. It measures the real row before paint, so it holds at any window width, pane width or native-button
 * inset and never shows a state it then corrects.
 */
function useFit(ref: RefObject<HTMLElement | null>, fits: (row: HTMLElement) => boolean, watch: string, marks = 0): void {
  useLayoutEffect(() => {
    const row = ref.current;
    if (row === null) return;
    const fit = () => {
      const steps = [...row.querySelectorAll<HTMLElement>("[data-collapse]")].sort((a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse));
      for (const step of steps) step.removeAttribute("data-collapsed");
      const gone: HTMLElement[] = [];
      for (const step of steps) {
        if (fits(row)) break;
        step.setAttribute("data-collapsed", "");
        gone.push(step);
      }
      for (const step of gone.slice(0, -1).reverse()) {
        if (Number(step.dataset.collapse) >= marks) continue;
        step.removeAttribute("data-collapsed");
        if (!fits(row)) step.setAttribute("data-collapsed", "");
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    for (const watched of row.querySelectorAll(watch)) observer.observe(watched);
    return () => observer.disconnect();
  });
}

/** The header keeps its breadcrumb's floors, giving up its labels in `COLLAPSE` order. */
export const useHeaderFit = (ref: RefObject<HTMLElement | null>): void => useFit(ref, crumbFits, "[data-header-actions], [data-header-thread], [data-header-status], [data-session-title]", COLLAPSE.status);

/** A list row's title outranks its status: what the row says after the title gives way before the title cuts. */
const rowFits = (row: HTMLElement): boolean => {
  const title = row.querySelector("[data-row-title]");
  return title === null || !overflows(title);
};

/**
 * The order the canvas bar's right end gives up its labels when the bar runs short: Hold preview shortens to Hold, then
 * Present goes to its icon, then the preview menu drops "Preview", then Hold goes to its icon. Present is the feature the
 * bar ends on, and its bare glyph would read as full-screening the shared window, so it keeps its word past Hold's. The menu's look and chevron never go: whether a shared
 * window is Clean is what Rob checks before he shares it.
 */
export const BAR_COLLAPSE = { holdSuffix: 0, present: 1, preview: 2, hold: 3 } as const;

/**
 * The bar sets aside the room its longest pick hint needs, picking or not, here or away, so the labels depend on the
 * bar's width alone and nothing in it moves when a pick starts or the canvas leaves for the preview window.
 */
export const PICK_HINTS = { comment: "Click to pin", vary: "Click to vary", graft: "Click to pick" } as const;
let ruler: CanvasRenderingContext2D | null = null;
const barFits = (bar: HTMLElement): boolean => {
  const hint = bar.querySelector("[data-bar-hint]");
  if (hint === null) return true;
  ruler ??= document.createElement("canvas").getContext("2d");
  if (ruler === null) return !overflows(hint);
  ruler.font = getComputedStyle(hint).font;
  const r = ruler;
  // The chip's glyph, padding and close button take room the words can't have.
  const words = hint.querySelector("[data-bar-hint-words]");
  const chip = words?.parentElement;
  const chrome = words == null || chip == null ? 0 : chip.getBoundingClientRect().width - words.getBoundingClientRect().width;
  const room = hint.getBoundingClientRect().width - chrome;
  return room >= Math.max(...Object.values(PICK_HINTS).map((h) => r.measureText(h).width)) - SLACK;
};

/** Fits the canvas bar: its right end's labels give way, in `BAR_COLLAPSE` order, before the pick hint cuts. */
export const useBarFit = (ref: RefObject<HTMLElement | null>): void => useFit(ref, barFits, "[data-bar-hint], [data-present-controls]", BAR_COLLAPSE.hold + 1);

/** Fits a sidebar row: its status drops its time, then its words, then a fork its branch glyph, before its title cuts. */
export const useRowFit = (ref: RefObject<HTMLElement | null>): void => useFit(ref, rowFits, "[data-row-title]");
