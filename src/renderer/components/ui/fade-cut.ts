/** How far a scroller moves before either fade reaches its full depth. */
const FADE_SCROLL = 32
/** At full depth, a fade hides at least this much of its edge outright, then ramps back over `RAMP`. */
const HIDE = 16
const RAMP = 24

/** A text line or small control, by its top and bottom in the scroller's content, which scrolling doesn't move. */
export type Unit = readonly [top: number, bottom: number]

/** Each edge's fade, in px from that edge: what it hides outright, then its ramp back to full strength. */
export type Fades = { readonly top: number; readonly topRamp: number; readonly bottom: number; readonly bottomRamp: number }

/**
 * Where a scroller's fades cut. Each fade comes in over its first 32 px of travel, and only while there is more that
 * way. Its hidden band then reaches past any line or control it would cut, so each one shows whole or not at all, and
 * the ramp after it starts part-strength, so nothing in it reads as gone.
 */
export function fadeCuts(units: readonly Unit[], scrollTop: number, height: number, scrollHeight: number): Fades {
  const before = Math.min(1, Math.max(0, scrollTop) / FADE_SCROLL)
  const after = Math.min(1, Math.max(0, scrollHeight - height - scrollTop) / FADE_SCROLL)
  let top = before === 0 ? 0 : HIDE * before
  let line = after === 0 ? height : height - HIDE * after
  for (let moved = true; moved; ) {
    moved = false
    for (const [t, b] of units) {
      const [from, to] = [t - scrollTop, b - scrollTop]
      if (top > 0 && from < top && to > top) [top, moved] = [to, true]
      if (line < height && from < line && to > line) [line, moved] = [from, true]
    }
  }
  return {
    top: Math.ceil(Math.min(top, height / 3)),
    topRamp: RAMP * before,
    bottom: Math.ceil(Math.min(height - line, height / 3)),
    bottomRamp: RAMP * after,
  }
}
