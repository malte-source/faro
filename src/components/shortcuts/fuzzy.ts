/**
 * Small fuzzy matcher for the command palette — no dependency.
 *
 * Accent- and case-insensitive subsequence match with a score: consecutive
 * letters, matches at the start of a word and an early first match score higher;
 * a plain substring always beats a scattered subsequence.
 */

export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Score of `query` inside `text`; 0 means "no match". Higher is better. */
export function fuzzyScore(query: string, text: string): number {
  const q = fold(query).replace(/\s+/g, '')
  const t = fold(text)
  if (!q) return 1
  if (!t) return 0

  const at = t.indexOf(q)
  if (at !== -1) {
    // Whole-query substring: strong, better at the start of the text or of a word.
    const wordStart = at === 0 || /[\s\-_/·]/.test(t[at - 1])
    return 1000 + (wordStart ? 200 : 0) - at
  }

  let score = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return 0
    const wordStart = found === 0 || /[\s\-_/·]/.test(t[found - 1])
    streak = found === ti ? streak + 1 : 0
    score += 10 + streak * 6 + (wordStart ? 8 : 0) - Math.min(found - ti, 8)
    ti = found + 1
  }
  return Math.max(1, score)
}

/** Best score across several fields of one item (label counts double). */
export function fuzzyScoreAny(query: string, fields: Array<string | undefined>, labelIndex = 0): number {
  let best = 0
  fields.forEach((f, i) => {
    if (!f) return
    const s = fuzzyScore(query, f) * (i === labelIndex ? 2 : 1)
    if (s > best) best = s
  })
  return best
}
