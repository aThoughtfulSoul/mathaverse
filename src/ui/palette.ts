// Semantic colour roles (VISUAL-DIRECTION "Art direction"). Developed for this prototype; not derived
// from the excluded concept image. Non-colour cues that exist in the scene: input and output are in
// separate titled views; the selected sample is larger and white with a ring and a name label; its exact
// group carries rings and names (u, v, w) in both views; moving outputs carry "Pu"-style labels during
// transitions; the fiber is the only long vertical line and has a caption. Input and output dots are
// both spheres (no shape difference yet) - within a view they are distinguished by colour only. In the
// operation-order comparison every labelled sample keeps one identity colour and its name in all three views,
// and the selected sample also carries an arrow from the origin and a ring.

export const palette = {
  /** Room: deep blue-black, quiet. */
  sky: 0x0b0e15,
  skyHorizon: 0x151a26,
  floor: 0x11151e,
  floorRing: 0x1f2633,
  /** Input samples and the input vector. */
  input: 0x74b9ff,
  /** Outputs Av and the output vector. */
  output: 0xffc95c,
  /** The discarded direction / fiber ("what gets lost"): rose line with a caption. */
  fiber: 0xff6f91,
  /** The image plane patch: teal, translucent, with a solid border and a label. */
  plane: 0x45d0bf,
  /** Selection: white halo + label. */
  selected: 0xffffff,
  /** Source ghost, wireframes, axes. */
  neutral: 0x8a94a8,
  axis: 0x5c6679,
  text: 0xe9edf5,
  /** Raised from 0x9aa3b5 after the Quest 3S legibility report (R6 follow-up F3). */
  textDim: 0xb0b8c8,
  /** Axis letters: brighter than captions so x, y, z read at the 0.8 m distance. */
  axisLabel: 0xc9d1e0,
  /** Spatial controls. */
  control: 0x232b3a,
  controlHover: 0x34405a,
  controlActive: 0x4a5a80,
  preview: 0xb8f7ff,
  /**
   * Operation-order comparison: one colour per labelled sample, in sample order, used for its dot, its name
   * label and its name in readouts in every view (a, b, c, d, then e1 in the prepared square). Names carry
   * identity too, so colour is never the only cue. Unlabelled samples stay neutral.
   */
  identity: [0xff8a73, 0x5fd6c4, 0xb9a2ff, 0xf6c84a, 0xffffff, 0xff9fd2],
  /** Sample outline (the square) in every comparison view. */
  outline: 0xa3adc0,
  /** Leader lines from a displaced label to its point. */
  leader: 0x9aa4b8,
  /** Voice caption states (push-to-talk). */
  voiceRecording: 0xff7f8f,
  voiceError: 0xff5a6e,
} as const

/** Identity colour of comparison sample k (cycles through the six). */
export const identityColor = (k: number): number => palette.identity[((k % palette.identity.length) + palette.identity.length) % palette.identity.length]!

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`
