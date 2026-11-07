/**
 * The one chip recipe: a card fill inside a strong edge. The edge carries the chip on a card or a popover, and the fill
 * carries it on the window and the canvas, so a badge, a code span or a key reads on every surface in both themes.
 * `npm run lint:design` fails a code or key element that paints its own fill.
 */
export const chip = "bg-card text-fg-muted inset-ring inset-ring-border-strong"
