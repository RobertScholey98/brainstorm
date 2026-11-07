const ELLIPSIS = "…"
/** What a cut never ends on before its ellipsis: a space, or punctuation that would read as the end of a clause. */
const TRAILING = /[\s,.;:·•\-–—/(]+$/u

const SEPARATOR = " · "
/** The fewest characters a cut may leave after a separator: "· b…" reads as a fault, not as the start of a phrase. */
const STUB = 3
/** A count reads with its noun, so a cut never lands inside one: "Spin button ×3" never ends "Spin button ×…". */
const COUNT = /\s×\d+/gu

/**
 * The longest start of `text` that `fits` with an ellipsis after it, less any space or punctuation it would end on, so
 * "Chore roulette" cuts to "Chore…", never "Chore …", and "spinning, slowly" to "spinning…". A cut that would leave a
 * stub after a middle dot ends before the dot instead, and one inside a count such as " ×3" ends before the count. When
 * not even the ellipsis fits, it paints nothing.
 */
export function cutText(text: string, fits: (shown: string) => boolean): string {
  if (!fits(ELLIPSIS)) return ""
  const chars = Array.from(text)
  let [lo, hi] = [0, chars.length - 1]
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(chars.slice(0, mid).join("") + ELLIPSIS)) lo = mid
    else hi = mid - 1
  }
  let shown = chars.slice(0, lo).join("")
  for (const count of text.matchAll(COUNT)) if (count.index < shown.length && shown.length < count.index + count[0].length) shown = shown.slice(0, count.index)
  const separator = shown.lastIndexOf(SEPARATOR)
  if (separator > 0 && Array.from(shown.slice(separator + SEPARATOR.length)).length < STUB) shown = shown.slice(0, separator)
  return shown.replace(TRAILING, "") + ELLIPSIS
}
