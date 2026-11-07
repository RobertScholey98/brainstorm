import { useLayoutEffect, type RefObject } from "react";

/**
 * The order the header gives up its words when the breadcrumb runs short, first to last: the request status falls to
 * its short name, then Export, then Fork, then the phase actions from the last one in. Each step costs the least
 * where Rob is looking: Export matters least while a request is open, and the first phase action is its recovery.
 */
export const COLLAPSE = { status: 1, export: 2, fork: 3, action: 10 } as const;

/** The rank of the phase action at `index` of `count`: the last one gives way first. */
export const actionRank = (index: number, count: number): number => COLLAPSE.action + (count - 1 - index);

/** A header button that gives up its label for its icon, its name kept for screen readers and in its hint. */
export const COMPACT = "data-collapsed:size-7";
export const COMPACT_LABEL = "in-data-collapsed:sr-only";

/** The breadcrumb's floors: the title keeps 160 px or reads whole, and an ancestor keeps 64 px or reads whole. */
const TITLE_FLOOR = 160;
const ANCESTOR_FLOOR = 64;

function crumbFits(header: HTMLElement): boolean {
  const roomy = (el: Element, floor: number) => el.clientWidth >= Math.min(el.scrollWidth, floor);
  const title = header.querySelector("[data-session-title]");
  return (title === null || roomy(title, TITLE_FLOOR)) && [...header.querySelectorAll("[data-lineage]")].every((a) => roomy(a, ANCESTOR_FLOOR));
}

/**
 * Fits the header to its room. Every element marked `data-collapse` keeps its words until the breadcrumb would fall
 * under its floors; then they give way one at a time in rank order, and no more than the breadcrumb needs. It measures
 * the real row, so it holds at any window width, pane width or native-button inset, and runs before paint, so the
 * header never shows a state it then corrects.
 */
export function useHeaderFit(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const header = ref.current;
    if (header === null) return;
    const fit = () => {
      const steps = [...header.querySelectorAll<HTMLElement>("[data-collapse]")].sort((a, b) => Number(a.dataset.collapse) - Number(b.dataset.collapse));
      for (const step of steps) step.removeAttribute("data-collapsed");
      for (const step of steps) {
        if (crumbFits(header)) break;
        step.setAttribute("data-collapsed", "");
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(header);
    for (const watched of header.querySelectorAll("[data-header-actions], [data-session-title]")) observer.observe(watched);
    return () => observer.disconnect();
  });
}
