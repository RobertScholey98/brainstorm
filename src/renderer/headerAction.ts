import { useLayoutEffect, type RefObject } from "react";
import { overflows, shows } from "@/components/ui/ink";
import type { RequestPhaseAction } from "../core/types";

/**
 * The order the header gives up its words when the breadcrumb runs short, first to last: Regenerate drops its glyph,
 * the request status drops its time, then falls to its short name, then Export, then Fork, then the phase actions (see
 * `actionRank`). Each step costs the least where Rob is looking: Export matters least while a request is open, and the
 * first phase action is its recovery.
 */
export const COLLAPSE = { glyph: 0, elapsed: 1, status: 2, export: 3, fork: 4, action: 10 } as const;

/**
 * The rank of `action`, the phase action at `index` of `count`. Open thread gives way first, since its glyph reads alone
 * where Withdraw's would read as the withdrawn status; then the last one in, so the first, the recovery, goes last.
 */
export const actionRank = (action: RequestPhaseAction, index: number, count: number): number => COLLAPSE.action + (action === "open_thread" ? 0 : count - index);

/** A header button that gives up its label for its icon, its name kept for screen readers and in its hint. */
export const COMPACT = "data-collapsed:size-7";
export const COMPACT_LABEL = "in-data-collapsed:sr-only";

/** The breadcrumb's floors: the title keeps 160 px or reads whole, and an ancestor keeps 64 px or reads whole. */
const TITLE_FLOOR = 160;
const ANCESTOR_FLOOR = 64;

function crumbFits(header: HTMLElement): boolean {
  const title = header.querySelector("[data-session-title]");
  return (title === null || shows(title, TITLE_FLOOR)) && [...header.querySelectorAll("[data-lineage]")].every((a) => shows(a, ANCESTOR_FLOOR));
}

/**
 * Fits a row to its room. Every element in it marked `data-collapse` keeps its words until `fits` says the row's
 * main text has dropped under its floor; then they give way one at a time in rank order, and no more than it needs.
 * A mark ranked under `marks`, such as a glyph, can come back once a later label has freed its room, so a label that
 * frees 200 px doesn't leave a 20 px glyph gone. Labels never do, so they always give way in rank order. It measures
 * the real row, so it holds at any window width, pane width or native-button inset, and runs before paint, so the row
 * never shows a state it then corrects.
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
export const useHeaderFit = (ref: RefObject<HTMLElement | null>): void => useFit(ref, crumbFits, "[data-header-actions], [data-header-status], [data-session-title]", COLLAPSE.status);

/** A list row's title outranks its status: what the row says after the title gives way before the title cuts. */
const rowFits = (row: HTMLElement): boolean => {
  const title = row.querySelector("[data-row-title]");
  return title === null || !overflows(title);
};

/** Fits a sidebar row: its status drops its time, then its words, then a fork its branch glyph, before its title cuts. */
export const useRowFit = (ref: RefObject<HTMLElement | null>): void => useFit(ref, rowFits, "[data-row-title]");
