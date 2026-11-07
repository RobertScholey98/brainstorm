/** The history strip's spacing: its inset at either end and the gap between entries. */
export const STRIP_INSET = 16;
export const STRIP_GAP = 16;
/** An entry's width: wide enough for a still and a short origin, and no wider than a popover, however much room. */
const ENTRY_MIN = 180;
const ENTRY_MAX = 380;

export type StripFit = {
  /** Each entry's width, in order. */
  readonly widths: readonly number[];
  /** How many entries show whole at once. */
  readonly shown: number;
  /** Set once the entries overflow, when they all take this one width, so a scroll steps by it. */
  readonly step: number | null;
};

/**
 * How the strip lays out entries whose lines need `needs` px each, in `room`, its scroller's width. While they fit,
 * they share the room by need: an entry that needs less than an even share keeps what it needs and gives the rest to
 * those that need more, and room past every need is shared evenly, up to the widest entry. Once even the narrowest
 * don't fit, as many as fit at the narrowest share the room exactly, so a scroll that rests on an entry's edge shows
 * only whole entries and never a cut one.
 */
export function stripFit(room: number, needs: readonly number[]): StripFit {
  const count = needs.length;
  const inner = room - 2 * STRIP_INSET;
  if (count * ENTRY_MIN + (count - 1) * STRIP_GAP <= inner) {
    return { widths: share(inner - (count - 1) * STRIP_GAP, needs.map((n) => Math.min(ENTRY_MAX, Math.max(ENTRY_MIN, n)))), shown: count, step: null };
  }
  const shown = Math.max(1, Math.floor((inner + STRIP_GAP) / (ENTRY_MIN + STRIP_GAP)));
  const width = (inner - (shown - 1) * STRIP_GAP) / shown;
  return { widths: needs.map(() => width), shown, step: width };
}

/**
 * Shares `room` among entries that want `wants`. Short of room, the ones wanting more than a level are cut to it. With
 * room to spare, the ones wanting less are grown to it. The bisection finds the level that fills the room.
 */
function share(room: number, wants: readonly number[]): number[] {
  const short = wants.reduce((sum, w) => sum + w, 0) > room;
  const at = (level: number) => wants.map((w) => (short ? Math.min(w, level) : Math.min(ENTRY_MAX, Math.max(w, level))));
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
