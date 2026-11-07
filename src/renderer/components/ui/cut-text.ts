const ELLIPSIS = "…"
/** What a cut never ends on before its ellipsis: a space, or punctuation that would read as the end of a clause. */
const TRAILING = /[\s,.;:·•\-–—/(]+$/u

const SEPARATOR = " · "
/** The fewest characters a cut may leave after a separator: "· b…" reads as a fault, not as the start of a phrase. */
const STUB = 3

/**
 * The longest start of `text` that `fits` with an ellipsis after it, less any space or punctuation it would end on, so
 * "Chore roulette" cuts to "Chore…", never "Chore …", and "spinning, slowly" to "spinning…". A cut that would leave a
 * stub after a middle dot ends before the dot instead. When not even the ellipsis fits, it paints nothing.
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
  const separator = shown.lastIndexOf(SEPARATOR)
  if (separator > 0 && Array.from(shown.slice(separator + SEPARATOR.length)).length < STUB) shown = shown.slice(0, separator)
  return shown.replace(TRAILING, "") + ELLIPSIS
}
