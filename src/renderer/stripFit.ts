/** The history strip's spacing: its inset at either end and the gap between entries. */
export const STRIP_INSET = 16;
export const STRIP_GAP = 16;
/** An entry's width: wide enough for a still and a short origin, and no wider than a popover, however much room. */
const ENTRY_MIN = 180;
const ENTRY_MAX = 380;

export type StripFit = {
  /** Each entry's width, the same for a still, a fork link and the stub. */
  readonly width: number;
  /** How many entries show whole at once. */
  readonly shown: number;
  readonly overflows: boolean;
};

/**
 * How the strip lays out `count` entries in `room`, its scroller's width. While they fit, they share the room up to the
 * widest entry. Once they don't, as many as fit at the narrowest share the room exactly, so a scroll that rests on an
 * entry's edge shows only whole entries and never a cut one.
 */
export function stripFit(room: number, count: number): StripFit {
  const inner = room - 2 * STRIP_INSET;
  const span = (n: number, width: number) => n * width + (n - 1) * STRIP_GAP;
  if (count === 0 || span(count, ENTRY_MIN) <= inner) {
    const width = count === 0 ? ENTRY_MAX : Math.min(ENTRY_MAX, (inner - (count - 1) * STRIP_GAP) / count);
    return { width, shown: count, overflows: false };
  }
  const shown = Math.max(1, Math.floor((inner + STRIP_GAP) / (ENTRY_MIN + STRIP_GAP)));
  return { width: (inner - (shown - 1) * STRIP_GAP) / shown, shown, overflows: true };
}

/**
 * Where the strip rests to show entry `index`: it stays put while the entry is whole in view, and otherwise moves the
 * least that brings it in, always landing on an entry's edge.
 */
export function stripRest(fit: StripFit, count: number, index: number, scrollLeft: number): number {
  if (!fit.overflows) return 0;
  const step = fit.width + STRIP_GAP;
  const last = count - fit.shown;
  const first = Math.min(last, Math.max(0, Math.round(scrollLeft / step)));
  const to = index < first ? index : index >= first + fit.shown ? index - fit.shown + 1 : first;
  return Math.min(last, Math.max(0, to)) * step;
}
