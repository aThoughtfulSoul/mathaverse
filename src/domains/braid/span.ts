// Which rewrite the workspace offers first at the selected crossing, and the crossings it affects. Shared by
// the braid scene (it highlights that exact span before the rewrite) and the braid presenter (its button names
// that rule), so both always point at the same span. Pure presentation choice over the derived options
// (derive.ts rewriteOptions, each already checked with applyRewrite); no mathematics is decided here.

import type { BraidOptionDesc } from './derive'

/** The crossings a rewrite replaces: [at, at + length). Insertion replaces none (length 0, before `at`). */
export function rewriteSpan(o: Pick<BraidOptionDesc, 'rule' | 'at'>): { at: number; length: number } {
  return { at: o.at, length: o.rule === 'braid_relation' ? 3 : o.rule === 'cancel_pair' ? 2 : 0 }
}

/** The rewrite of an existing span offered first: the braid relation, else an inverse-pair cancellation. */
export function primaryRewrite(options: readonly BraidOptionDesc[]): BraidOptionDesc | null {
  return options.find((o) => o.rule === 'braid_relation') ?? options.find((o) => o.rule === 'cancel_pair') ?? null
}
