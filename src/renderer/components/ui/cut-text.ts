const ELLIPSIS = "…"
/** What a cut never ends on before its ellipsis: a space, or punctuation that would read as the end of a clause. */
const TRAILING = /[\s,.;:·•\-–—/(]+$/u

/**
 * The longest start of `text` that `fits` with an ellipsis after it, less any space or punctuation it would end on, so
 * "Chore roulette" cuts to "Chore…", never "Chore …", and "spinning, slowly" to "spinning…".
 */
export function cutText(text: string, fits: (shown: string) => boolean): string {
  const chars = Array.from(text)
  let [lo, hi] = [0, chars.length - 1]
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(chars.slice(0, mid).join("") + ELLIPSIS)) lo = mid
    else hi = mid - 1
  }
  return chars.slice(0, lo).join("").replace(TRAILING, "") + ELLIPSIS
}
