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
  /** How many entries show whole at once. */
  readonly shown: number;
  /** Set once the entries overflow, when they all take this one width, so a scroll steps by it. */
  readonly step: number | null;
};

/**
 * How the strip lays out `entries` in `room`, its scroller's width. While they fit, each takes what its lines need and
 * no more, so a young brainstorm's entry holds no empty fill. Short of that, an entry that needs less than an even share
 * keeps what it needs and the rest share what is left, none below its floor. Once even the floors don't fit, as many as
 * fit at the widest floor share the room exactly, so a scroll that rests on an entry's edge shows only whole entries.
 */
export function stripFit(room: number, entries: readonly EntryNeed[]): StripFit {
  const count = entries.length;
  const inner = room - 2 * STRIP_INSET;
  const floors = entries.map((e) => Math.min(ENTRY_MAX, Math.max(ENTRY_MIN, e.floor)));
  const wants = entries.map((e, i) => Math.min(ENTRY_MAX, Math.max(floors[i]!, e.need)));
  const free = inner - (count - 1) * STRIP_GAP;
  if (floors.reduce((sum, f) => sum + f, 0) <= free) return { widths: share(free, wants, floors), shown: count, step: null };
  const widest = Math.max(...floors);
  const shown = Math.max(1, Math.floor((inner + STRIP_GAP) / (widest + STRIP_GAP)));
  const width = (inner - (shown - 1) * STRIP_GAP) / shown;
  return { widths: entries.map(() => width), shown, step: width };
}

/**
 * Shares `room` among entries that want `wants`, none below its floor. With room for every want, each gets its want.
 * Short of room, the ones wanting more than a level are cut to it; the bisection finds the level that fills the room.
 */
function share(room: number, wants: readonly number[], floors: readonly number[]): number[] {
  if (wants.reduce((sum, w) => sum + w, 0) <= room) return [...wants];
  const at = (level: number) => wants.map((w, i) => Math.max(floors[i]!, Math.min(w, level)));
  let [low, high] = [0, ENTRY_MAX];
  for (let i = 0; i < 32; i++) {
    const level = (low + high) / 2;
    if (at(level).reduce((sum, w) => sum + w, 0) > room) high = level;
    else low = level;
  }
  return at(low).map((w) => Math.round(w * 100) / 100);
}

/**
 * Where the strip rests to show entry `index`: it stays put while the entry is whole in view, and otherwise moves the
 * least that brings it in, always landing on an entry's edge.
 */
export function stripRest(fit: StripFit, count: number, index: number, scrollLeft: number): number {
  if (fit.step === null) return 0;
  const step = fit.step + STRIP_GAP;
  const last = count - fit.shown;
  const first = Math.min(last, Math.max(0, Math.round(scrollLeft / step)));
  const to = index < first ? index : index >= first + fit.shown ? index - fit.shown + 1 : first;
  return Math.min(last, Math.max(0, to)) * step;
}
