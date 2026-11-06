/**
 * The fit rules (ADR 002). A frame lays out at its declared width, always, and is only ever zoomed, so neither view
 * scrolls sideways. On the stage, a frame wider than the room is zoomed down to it. On the board, every frame takes one
 * zoom so the whole row fits, down to `BOARD_FLOOR`; below that the frames wrap into rows at their own size, each zoomed
 * only if it alone is wider than the room. A frame's `gutter` is chrome beside its body that no zoom scales, such as
 * the scrollbar of a frame with a declared height.
 */
export const CANVAS_PAD = 24;
export const GAP = 24;
export const BOARD_FLOOR = 0.5;

export type Fit = {
  /** Each slot zoomed below 1, keyed by slot. */
  readonly zooms: ReadonlyMap<string, number>;
  readonly wrap: boolean;
};

export function fitFrames(
  frames: readonly { readonly slot: string; readonly width: number; readonly gutter?: number }[],
  room: number,
  stage: string | null,
): Fit {
  const own = (f: { readonly width: number; readonly gutter?: number }) => Math.min(1, Math.max(room - (f.gutter ?? 0), 1) / f.width);
  const zooms = new Map<string, number>();
  let wrap = false;
  if (stage !== null) {
    for (const f of frames) if (f.slot === stage) zooms.set(f.slot, own(f));
  } else if (frames.length > 0) {
    const widths = frames.reduce((sum, f) => sum + f.width, 0);
    const gutters = frames.reduce((sum, f) => sum + (f.gutter ?? 0), 0);
    const row = Math.min(1, (room - GAP * (frames.length - 1) - gutters) / widths);
    wrap = row < BOARD_FLOOR;
    for (const f of frames) zooms.set(f.slot, wrap ? own(f) : row);
  }
  for (const [slot, zoom] of zooms) if (zoom >= 1) zooms.delete(slot);
  return { zooms, wrap };
}
