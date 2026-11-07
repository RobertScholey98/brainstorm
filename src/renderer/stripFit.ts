/** The history strip's spacing: its inset at either end and the gap between entries. */
export const STRIP_INSET = 16;
export const STRIP_GAP = 16;
/** An entry's width: wide enough for a still and a short origin, and no wider than a popover, however much room. */
const ENTRY_MIN = 180;
const ENTRY_MAX = 380;

/** What an entry's lines take: `need` for every line whole, `floor` for the lines that never cut. */
export type EntryNeed = { readonly need: number; readonly floor: number };

export type StripFit = {
  /** Each entry's width, in order. */
  readonly widths: readonly number[];
  /**
   * Null while the entries fit. Once they overflow, the index each page starts at, oldest first. A page is the entries
   * the strip shows whole at one rest, and it fills the strip exactly, so the strip rests only on a page's start.
   */
  readonly pages: readonly number[] | null;
};

const sum = (ws: readonly number[]) => ws.reduce((total, w) => total + w, 0);
const cents = (w: number) => Math.round(w * 100) / 100;

/**
 * How the strip lays out `entries` in `room`, its scroller's width. Each entry takes what its lines need and no more;
 * short of room, an entry that needs less than an even share keeps what it needs and the rest share what is left, none
 * below its floor. While the floors fit, every entry shows and the rest of the strip stays empty.
 *
 * Once they don't, the entries split into pages from the newest back, each holding as many as its floors allow, and
 * each page shares the strip by need the same way. A page whose entries need less than the strip grows them evenly
 * from the narrowest, so it still ends where the strip does. Only the oldest page keeps its entries at their need: at
 * its rest the next page starts in the room it leaves, and the strip hides whichever entry it can't show whole.
 */
export function stripFit(room: number, entries: readonly EntryNeed[]): StripFit {
  const count = entries.length;
  const inner = room - 2 * STRIP_INSET;
  const floors = entries.map((e) => Math.min(ENTRY_MAX, Math.max(ENTRY_MIN, e.floor)));
  const wants = entries.map((e, i) => Math.min(ENTRY_MAX, Math.max(floors[i]!, e.need)));
  if (sum(floors) + (count - 1) * STRIP_GAP <= inner) return { widths: share(inner - (count - 1) * STRIP_GAP, wants, floors), pages: null };
  const widths: number[] = [];
  const pages: number[] = [];
  for (let end = count; end > 0; ) {
    let start = end - 1;
    let used = floors[start]!;
    while (start > 0 && used + STRIP_GAP + floors[start - 1]! <= inner) used += STRIP_GAP + floors[--start]!;
    const free = inner - (end - start - 1) * STRIP_GAP;
    const page = share(free, wants.slice(start, end), floors.slice(start, end)).map((w) => Math.min(w, free));
    widths.unshift(...(start === 0 ? page : grow(free, page)));
    pages.unshift(start);
    end = start;
  }
  return { widths, pages };
}

/**
 * Shares `room` among entries that want `wants`, none below its floor. With room for every want, each gets its want.
 * Short of room, the ones wanting more than a level are cut to it; the bisection finds the level that fills the room.
 */
function share(room: number, wants: readonly number[], floors: readonly number[]): number[] {
  if (sum(wants) <= room) return [...wants];
  const at = (level: number) => wants.map((w, i) => Math.max(floors[i]!, Math.min(w, level)));
  return at(level(room, at)).map(cents);
}

/** Widens `widths` to fill `room`, the narrowest first, by raising every width under a level to it. */
function grow(room: number, widths: readonly number[]): number[] {
  if (sum(widths) >= room) return [...widths];
  const to = level(room, (l) => widths.map((w) => Math.max(w, l)));
  return widths.map((w) => cents(Math.max(w, to)));
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
  return cents(sum(fit.widths.slice(0, fit.pages[p]).map((w) => w + STRIP_GAP)));
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
