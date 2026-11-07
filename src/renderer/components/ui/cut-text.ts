const ELLIPSIS = "…"
/** What a cut never ends on before its ellipsis: a space, or punctuation that would read as the end of a clause. */
const TRAILING = /[\s,.;:·•\-–—/(]+$/u

const SEPARATOR = " · "
/** The fewest characters a cut may leave after a separator or of a word: "· b…" and "into t…" read as a fault, not as a start. */
const STUB = 3
const WORD_STUB = new RegExp(`\\s\\S{1,${STUB - 1}}$`, "u")
/** A count reads with its noun, so a cut never lands inside one: "Spin button ×3" never ends "Spin button ×…". */
const COUNT = /\s×\d+/gu

/**
 * The longest start of `text` that `fits` with an ellipsis after it, less any space or punctuation it would end on, so
 * "Chore roulette" cuts to "Chore…", never "Chore …", and "spinning, slowly" to "spinning…". A cut that would leave a
 * stub after a middle dot ends before the dot instead, one inside a count such as " ×3" ends before the count, and one
 * that leaves a word's first letter or two ends after the word before. When not even the ellipsis fits, it paints nothing.
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
  const stub = WORD_STUB.exec(shown)
  if (stub !== null && /\S/u.test(text.charAt(shown.length))) shown = shown.slice(0, stub.index)
  return shown.replace(TRAILING, "") + ELLIPSIS
}
