// Kinetic group sculpture (demonstration 1): public surface for the coordinator's registry.
// deriveSculpture is pure (Node and browser); SculptureScene needs a DOM (canvas text) and three.js.

export {
  deriveSculpture,
  stepOf,
  slotsAfter,
  historyWords,
  plainGroupLabel,
  SculptureError,
  type SculptureDesc,
  type SculptureBead,
  type SculptureSlot,
  type SculptureStep,
  type SculptureMove,
  type SculptureMoment,
  type SculptureCard,
  type SculptureOrders,
} from './derive'
export { pathSpecs, evalPath, ringFrame, RING, type PathSpec } from './paths'
export { SculptureScene, BEAD_COLORS, BEAD_SHAPES } from './scene'
