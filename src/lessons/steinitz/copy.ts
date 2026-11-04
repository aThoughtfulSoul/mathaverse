// Authored lesson text of the proof lesson (PROOF-EXPLORER-SPEC section 3, STORYBOARD). Kept apart from the
// domain mathematics (src/algebra/walk.ts) and from the source provenance (source.ts). Numbers never appear
// here: presenters and scenes fill them in from the exact derivation, so the words stay true for every case.

import type { WalkStage } from '../../domains/inputs'

export const LESSON_QUESTION = 'How does rearranging these steps keep us closer to home?'
export const LESSON_SUBTITLE = 'Inside a published proof · Steinitz–Bergström'

export interface StageCopy {
  /** Step strip label. */
  label: string
  /** One or two sentences: what the learner is looking at and why it matters. */
  lead: string
}

export const STAGE_COPY: Record<WalkStage, StageCopy> = {
  walk: {
    label: 'Walk',
    lead: 'These arrows bring you home. Returning home does not stop the walk from wandering far away along the way.',
  },
  signs: {
    label: 'Signs',
    lead: 'Label every arrow + or −. A separate signed walk adds the + arrows and subtracts the − arrows; the original arrows do not flip.',
  },
  reorder: {
    label: 'Reorder',
    lead: 'Rearrange the same arrows: + arrows in their original order, then − arrows in reverse. No arrow is turned, flipped or resized.',
  },
  why: {
    /** Four characters: the shell renders labels of three or fewer as mathematical symbols. */
    label: 'Why?',
    lead: 'Pick a point of the new walk. When the walk returns home, two half-sized arrows built from one earlier point of each old walk reach it exactly, so its distance is at most half the two bounds combined.',
  },
  assumptions: {
    label: 'Assumptions',
    lead: 'The argument uses three hypotheses. Remove the first, and a leftover total stays in the formula.',
  },
}

/** Why-step wording for each branch (j and k are filled in by the caller). */
export const WHY_BRANCH = {
  positive: 'The first k arrows of the new order are exactly the + arrows among the first j original steps.',
  negative: 'The − arrows not yet used are exactly the − arrows among the first j original steps; the walk returns home, so the new point is minus their sum.',
} as const

/** The negative-branch wording when the walk does NOT return home (the residual T stays; j is filled in). */
export const WHY_NEGATIVE_OPEN = 'The − arrows not yet used are exactly the − arrows among the first j original steps; the walk does not return home, so the new point is the leftover total T minus their sum, and T cannot be dropped.'

/**
 * One plain-language sentence that leads a Why explanation, before any formula (no numbers: the caller adds
 * them). Chosen from the selected endpoint's actual branch and the walk's actual total, never assumed.
 */
export const WHY_LEAD = {
  start: 'This is the start of the new walk, so it is inside every bound.',
  inside: 'Two half-sized arrows, one from each old walk, land exactly on this point, so it is no farther from home than half the two bounds combined.',
  positiveOpen: 'Two half-sized arrows, one from each old walk, still land exactly on this point, so it is within the proposed bound even though the walk does not return home.',
  negativeOpen: 'The walk does not return home, so a leftover total stays in the formula for this point: the two half-sized arrows alone do not reach it.',
} as const

export const COUNTEREXAMPLE_COPY = 'The return-to-start assumption is missing. This lemma does not apply.'
export const NO_IMPROVEMENT_COPY = 'Valid bound · no improvement from these signs.'
export const BOUND_NOTE = 'Bounds are whole numbers chosen to contain every point; they are not the measured largest distances.'
