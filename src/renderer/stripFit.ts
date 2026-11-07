/** The history strip's spacing: its inset at either end and the gap between entries. */
export const STRIP_INSET = 16;
export const STRIP_GAP = 16;
/** An entry's width: wide enough for a still and a short origin, and no wider than a popover, however much room. */
const ENTRY_MIN = 180;
const ENTRY_MAX = 380;

/**
 * What an entry's lines take: `need` for every line whole, `floor` for the lines that never cut. A `link`, a fork's
 * tile or stub, keeps its own floor rather than an entry's and gives up its room first; the `shown` iteration takes
 * its room first.
 */
export type EntryNeed = { readonly need: number; readonly floor: number; readonly link?: boolean; readonly shown?: boolean };

/** Who takes room first when an entry's lines can't all read whole: the shown iteration, the other iterations, then links. */
const tierOf = (e: EntryNeed): number => (e.shown === true ? 0 : e.link === true ? 2 : 1);

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
/**
 * Layout keeps widths on a 1/64 px grid and lays a width between steps out at the step below. A measured need sits on
 * the grid already, so a width snaps down to it here: rounded to cents, a need of 233.8125 became 233.81, laid out at
 * 233.797, and cut its line. The epsilon keeps a bisected 342.4999… at 342.5.
 */
const snap = (w: number) => Math.floor(w * 64 + 1e-6) / 64;

/**
 * How the strip lays out `entries` in `room`, its scroller's width. Each entry takes what its lines need and no more;
 * short of room, the shown iteration takes what it needs first, then the other iterations share by need, then links,
 * none below its floor. While the floors fit, every entry shows and the rest of the strip stays empty.
 *
 * Once they don't, the entries split into pages from the newest back, each holding only as many as read whole, a link
 * counted at its floor since it gives way first, and never on a page alone. A page whose entries need less than the
 * strip grows its iterations evenly from the narrowest, so it still ends where the strip does. Only the oldest page
 * keeps its entries at their need: at its rest the next page starts in the room it leaves, and the strip hides
 * whichever entry it can't show whole.
 */
export function stripFit(room: number, entries: readonly EntryNeed[]): StripFit {
  const count = entries.length;
  const inner = room - 2 * STRIP_INSET;
  const floors = entries.map((e) => Math.min(ENTRY_MAX, e.link === true ? e.floor : Math.max(ENTRY_MIN, e.floor)));
  const wants = entries.map((e, i) => Math.min(ENTRY_MAX, Math.max(floors[i]!, e.need)));
  const tiers = entries.map(tierOf);
  if (sum(floors) + (count - 1) * STRIP_GAP <= inner) return { widths: share(inner - (count - 1) * STRIP_GAP, wants, floors, tiers), pages: null };
  const cost = (i: number) => (tiers[i] === 2 ? floors[i]! : wants[i]!);
  const widths: number[] = [];
  const pages: number[] = [];
  for (let end = count; end > 0; ) {
    let start = end - 1;
    let used = cost(start);
    while (start > 0 && used + STRIP_GAP + cost(start - 1) <= inner) used += STRIP_GAP + cost(--start);
    // A fork's tile never takes a page alone, where it would grow to an entry's width: it joins the iteration it hangs off.
    if (end - start === 1 && tiers[start] === 2 && start > 0) start -= 1;
    const free = inner - (end - start - 1) * STRIP_GAP;
    const page = share(free, wants.slice(start, end), floors.slice(start, end), tiers.slice(start, end)).map((w) => Math.min(w, free));
    widths.unshift(...(start === 0 ? page : grow(free, page, tiers.slice(start, end))));
    pages.unshift(start);
    end = start;
  }
  return { widths, pages };
}

/**
 * Shares `room` among entries that want `wants`, none below its floor. With room for every want, each gets its want.
 * Short of room, each tier in turn takes what it wants from what is left; in the tier that runs out, the ones wanting
 * more than a level are cut to it, and the bisection finds the level that fills the room.
 */
function share(room: number, wants: readonly number[], floors: readonly number[], tiers: readonly number[]): number[] {
  if (sum(wants) <= room) return [...wants];
  const widths = [...floors];
  let left = room - sum(floors);
  for (const tier of [0, 1, 2]) {
    const members = tiers.flatMap((t, i) => (t === tier ? [i] : []));
    const more = sum(members.map((i) => wants[i]! - widths[i]!));
    if (more <= left) {
      for (const i of members) widths[i] = wants[i]!;
      left -= more;
      continue;
    }
    const at = (l: number) => members.map((i) => Math.max(floors[i]!, Math.min(wants[i]!, l)));
    const raised = at(level(sum(members.map((i) => floors[i]!)) + left, at));
    members.forEach((i, k) => (widths[i] = raised[k]!));
    break;
  }
  return widths.map(snap);
}

/**
 * Widens `widths` to fill `room`, the narrowest first, by raising every width under a level to it. A link keeps its
 * width, so a fork's tile never grows to an entry's.
 */
function grow(room: number, widths: readonly number[], tiers: readonly number[]): number[] {
  if (sum(widths) >= room) return [...widths];
  const raise = (l: number) => widths.map((w, i) => (tiers[i] === 2 ? w : Math.max(w, l)));
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
