// The math glyph orb: the visual presence of Ask Meta Muse AI on the desktop (assistant panel header) and in XR
// (above the assistant inspector). While the assistant works with the learner's words it moves to a grown stage
// (placement.ts). Its state comes only from the voice and assistant clients (state.ts).

export { ORB_GLYPHS, ORB_GLYPH_COUNT, glyphLayout, type OrbGlyph } from './glyphs'
export { APPLIED_BLOOM_MS, ORB_PHASES, initialMemory, observe, orbPhase, type OrbMemory, type OrbPhase } from './state'
export { ORB_LOOKS, OrbMotion, type OrbLook, type OrbLookState } from './motion'
export { OrbPlacement, STAGE_LINGER_MS, wantsStage, type OrbPlace } from './placement'
export { createOrbSource, type OrbAssistant, type OrbSource, type OrbVoice } from './source'
export { DESKTOP_ORB_CSS_PX, DESKTOP_ORB_STAGE_PX, DesktopOrb, ORB_FLIGHT_MS, ORB_SLOT_SELECTOR, ORB_STAGE_SELECTOR, drawOrb2d } from './desktop'
export { ORB_MESH_NAME, ORB_ROOT_NAME, XR_ORB, XR_ORB_EXTENT, XR_ORB_GLIDE_S, XR_ORB_RENDER_ORDER, XrOrb, setOrbCanvasFactory, type XrOrbPose } from './xr'
