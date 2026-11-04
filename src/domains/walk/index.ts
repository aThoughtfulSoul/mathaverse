// Proof lesson: the vector-walk scene (PROOF-EXPLORER-SPEC sections 3-5). Public surface for the coordinator's
// registry (src/domains/all.ts: layout 'walk', derive 'deriveWalkScene', scene 'WalkScene').
// deriveWalkScene and the pose timeline are pure (Node and browser); WalkScene needs a DOM (canvas text) and three.js.

export {
  deriveWalkScene,
  benchPoint,
  benchVector,
  chooseView,
  exactSqrt,
  lengthText,
  sub,
  WALK_LAYOUT,
  WALK_TILT,
  type WalkDesc,
  type WalkView,
  type WalkPointDesc,
  type WalkOccurrenceDesc,
  type WitnessDesc,
  type WalkSelection,
  type StageCopy,
  type TextLine,
  type BoundDesc,
  type PeakDesc,
  type P3,
} from './derive'
export { composeStage, blendPose, stageTiming, selectedWitness, walkGeometry, makePose, WALK_COLORS, type Pose, type ArrowPose, type WalkGeometry } from './pose'
export { WalkScene, STAGE_NAMES, classify } from './scene'
