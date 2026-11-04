// Worker C: bounded three-strand braids (FOUR-DEMOS-PARALLEL-HANDOFF section 8; docs/BRAIDS.md).
// deriveBraid turns the exact scene input into a plain description; BraidScene shows it (layout 'braid').
// Exact words and checks: src/algebra/braid.ts (coordinator core). Geometry modules:
//   plan.ts      word layout and the strand evaluator (generic crossings, motif embedding)
//   relation.ts  the canonical intersection-free family for sigma1 sigma2 sigma1 <-> sigma2 sigma1 sigma2
//   cancel.ts    the inverse-cancellation family
//   clearance.ts sampled centerline distances and crossing events
//   animator.ts  presentation clips and playback; tubes.ts / view.ts / scene.ts draw them

export { deriveBraid, describeWord, rewriteOptions, statusLines, CONVENTION } from './derive'
export type { BraidDesc, BraidWordDesc, BraidCrossingDesc, BraidOptionDesc } from './derive'
export { BraidScene } from './scene'
export { GEOMETRY } from './constants'
