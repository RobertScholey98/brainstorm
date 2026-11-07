/** Layout lands on 1/64 px, so anything past this is a real overflow and anything under it is rounding. */
const SLACK = 0.01

/**
 * An element's text and the room its box gives it, in fractional px. `scrollWidth` and `clientWidth` both round, so
 * a line 0.6 px too long reads as fitting while the browser's own ellipsis cuts it.
 */
export function inkAndRoom(el: Element): { ink: number; room: number } {
  const range = document.createRange()
  range.selectNodeContents(el)
  const s = getComputedStyle(el)
  const edges = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth)
  return { ink: range.getBoundingClientRect().width, room: el.getBoundingClientRect().width - edges }
}

/** Whether `el`'s text runs past its room by any part of a pixel. */
export function overflows(el: Element): boolean {
  const { ink, room } = inkAndRoom(el)
  return ink > room + SLACK
}

/** Whether `el` shows `floor` px of its text, or all of it when it is shorter. */
export function shows(el: Element, floor: number): boolean {
  const { ink, room } = inkAndRoom(el)
  return room >= Math.min(ink, floor) - SLACK
}
