/**
 * The fit rules (ADR 002). A frame lays out at its declared width, always, and is only ever zoomed, so neither view
 * scrolls sideways. On the stage, a frame wider than the room is zoomed down to it. On the board, every frame takes one
 * zoom so the whole row fits, however small that makes it: the board is the flow at a glance, and the stage is where a
 * frame is read. A frame's `gutter` is chrome beside its body that no zoom scales, such as the scrollbar of a frame with
 * a declared height.
 */
export const CANVAS_PAD = 24;
export const GAP = 24;

export function fitFrames(
  frames: readonly { readonly slot: string; readonly width: number; readonly gutter?: number }[],
  room: number,
  stage: string | null,
): ReadonlyMap<string, number> {
  const zooms = new Map<string, number>();
  if (stage !== null) {
    for (const f of frames) if (f.slot === stage) zooms.set(f.slot, Math.min(1, Math.max(room - (f.gutter ?? 0), 1) / f.width));
  } else if (frames.length > 0) {
    const widths = frames.reduce((sum, f) => sum + f.width, 0);
    const fixed = frames.reduce((sum, f) => sum + (f.gutter ?? 0), GAP * (frames.length - 1));
    const row = Math.min(1, Math.max(room - fixed, 1) / widths);
    for (const f of frames) zooms.set(f.slot, row);
  }
  for (const [slot, zoom] of zooms) if (zoom >= 1) zooms.delete(slot);
  return zooms;
}
