/** The history strip's spacing: its inset at either end and the gap between entries. */
export const STRIP_INSET = 16;
export const STRIP_GAP = 16;
/** An entry's width: wide enough for a still and a short origin, and no wider than a popover, however much room. */
const ENTRY_MIN = 180;
const ENTRY_MAX = 380;

/** What an entry's lines take: `need` for every line whole, `floor` for the lines that never cut. A `link` is a branch's tile or stub. */
export type EntryNeed = { readonly need: number; readonly floor: number; readonly link?: boolean };

/** Who takes room first when an entry's lines can't all read whole, in order. */
const TIER = ["shown", "iteration", "link"] as const;
type Slot = { readonly want: number; readonly floor: number; readonly tier: (typeof TIER)[number] };

export type StripFit = {
  /** Each entry's width, in order. */
  readonly widths: readonly number[];
  /** Null while the entries fit. Once they overflow, the index each page starts at, oldest first. The strip rests only on a page's start. */
  readonly pages: readonly number[] | null;
};

const sum = (ws: readonly number[]) => ws.reduce((total, w) => total + w, 0);
/**
 * Layout keeps widths on a 1/64 px grid and lays a width between steps out at the step below. A measured need sits on
 * the grid already, so a width snaps down to it here: rounded to cents, a need of 233.8125 became 233.81, laid out at
 * 233.797, and cut its line. The epsilon keeps a bisected 342.4999… at 342.5.
 */
const snap = (w: number) => Math.floor(w * 64 + 1e-6) / 64;

/**
 * How the strip lays out `entries` in `room`, its scroller's width, with entry `shown` on the canvas. Each entry takes
 * what its lines need, by tier, none below its floor. Once the floors overflow, the entries split into pages from the
 * newest back, each holding only as many as read whole, and every page but the oldest fills the strip.
 */
export function stripFit(room: number, entries: readonly EntryNeed[], shown?: number): StripFit {
  const count = entries.length;
  const inner = room - 2 * STRIP_INSET;
  const slots = entries.map((e, i): Slot => {
    const floor = Math.min(ENTRY_MAX, e.link === true ? e.floor : Math.max(ENTRY_MIN, e.floor));
    return { floor, want: Math.min(ENTRY_MAX, Math.max(floor, e.need)), tier: i === shown ? "shown" : e.link === true ? "link" : "iteration" };
  });
  if (sum(slots.map((s) => s.floor)) + (count - 1) * STRIP_GAP <= inner) return { widths: share(inner - (count - 1) * STRIP_GAP, slots), pages: null };
  // A link counts at its floor, since it gives way first.
  const cost = (i: number) => (slots[i]!.tier === "link" ? slots[i]!.floor : slots[i]!.want);
  const widths: number[] = [];
  const pages: number[] = [];
  for (let end = count; end > 0; ) {
    let start = end - 1;
    let used = cost(start);
    while (start > 0 && used + STRIP_GAP + cost(start - 1) <= inner) used += STRIP_GAP + cost(--start);
    // A branch's tile never takes a page alone, where it would grow to an entry's width: it joins the iteration it hangs off.
    if (end - start === 1 && slots[start]!.tier === "link" && start > 0) start -= 1;
    const free = inner - (end - start - 1) * STRIP_GAP;
    const page = slots.slice(start, end);
    const shared = share(free, page).map((w) => Math.min(w, free));
    // The oldest page keeps its need, so at its rest the next page starts in the room it leaves.
    widths.unshift(...(start === 0 ? shared : grow(free, shared, page)));
    pages.unshift(start);
    end = start;
  }
  return { widths, pages };
}

/** Shares `room` among `slots`, each tier in turn taking what it wants from what is left, none below its floor. */
function share(room: number, slots: readonly Slot[]): number[] {
  const wants = slots.map((s) => s.want);
  if (sum(wants) <= room) return wants;
  const widths = slots.map((s) => s.floor);
  let left = room - sum(widths);
  for (const tier of TIER) {
    const members = slots.flatMap((s, i) => (s.tier === tier ? [i] : []));
    const more = sum(members.map((i) => wants[i]! - widths[i]!));
    if (more <= left) {
      for (const i of members) widths[i] = wants[i]!;
      left -= more;
      continue;
    }
    const at = (l: number) => members.map((i) => Math.max(slots[i]!.floor, Math.min(wants[i]!, l)));
    const raised = at(level(sum(members.map((i) => slots[i]!.floor)) + left, at));
    members.forEach((i, k) => (widths[i] = raised[k]!));
    break;
  }
  return widths.map(snap);
}

/** Widens `widths` to fill `room`, the narrowest first. A link keeps its width, so a branch's tile never grows to an entry's. */
function grow(room: number, widths: readonly number[], slots: readonly Slot[]): number[] {
  if (sum(widths) >= room) return [...widths];
  const raise = (l: number) => widths.map((w, i) => (slots[i]!.tier === "link" ? w : Math.max(w, l)));
  return raise(level(room, raise)).map(snap);
}

/** The highest level at which `at(level)` still sums to `room` or less. */
function level(room: number, at: (level: number) => readonly number[]): number {
  let [low, high] = [0, room];
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (sum(at(mid)) > room) high = mid;
    else low = mid;
  }
  return low;
}

/** Where the strip rests to show page `p`: its first entry's edge, less the inset. */
export function pageRest(fit: StripFit, p: number): number {
  if (fit.pages === null || p <= 0) return 0;
  return snap(sum(fit.widths.slice(0, fit.pages[p]).map((w) => w + STRIP_GAP)));
}

/** The page that holds entry `index`. */
export function pageOf(fit: StripFit, index: number): number {
  return fit.pages === null ? 0 : fit.pages.findLastIndex((start) => start <= index);
}

/** The page the strip rests nearest to at `scrollLeft`. */
export function pageAt(fit: StripFit, scrollLeft: number): number {
  if (fit.pages === null) return 0;
  const rests = fit.pages.map((_, p) => Math.abs(pageRest(fit, p) - scrollLeft));
  return rests.indexOf(Math.min(...rests));
}
