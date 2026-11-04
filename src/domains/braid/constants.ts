// Presentation constants of the braid scene (FOUR-DEMOS-PARALLEL-HANDOFF section 8). Exact words live in
// src/algebra/braid.ts; everything here is derived presentation: strand identity colours and shapes, and the
// metric parameters of the strand geometry (docs/BRAIDS.md lists and justifies them).
//
// Braid-local frame (one braid): +x right, +y up, +z toward the viewer. The longitudinal direction is
// top -> bottom: a strand at longitudinal parameter u (metres from the first endpoint frame) is at y = -u.
// "Over" means nearer the viewer (+z). Position p (0-based, left to right) is at x = (p - 1) * spacing.

import { identityColor } from '../../ui/palette'

export type StrandId = 'a' | 'b' | 'c'
export const STRAND_NAMES: readonly StrandId[] = ['a', 'b', 'c']

/** Identity colour of strand s (by starting position), from the shared identity palette. */
export const strandColor = (s: number): number => identityColor(s)

/** Secondary identity cue: the end-cap shape of each strand (with its letter at both endpoint frames). */
export const STRAND_SHAPES = ['sphere', 'cube', 'octahedron'] as const

/** Upper bound on crossings handled by the geometry (MAX_BRAID_LENGTH plus an inserted pair). */
export const MAX_UNITS = 26

export const GEOMETRY = {
  /** Horizontal distance between neighbouring positions (m). */
  spacing: 0.046,
  /** Longitudinal distance between the two endpoint frames (m). */
  length: 0.33,
  /** Straight lead collar below the first endpoint frame (m); the braid is top-anchored. */
  lead: 0.035,
  /** Shortest lead while a motif's collars are opened (m). */
  leadMin: 0.012,
  /** Minimum straight tail above the second endpoint frame (m). */
  tailMin: 0.03,
  /** Longitudinal length of one crossing unit when the word is short (m); longer words compress. */
  pitchMax: 0.085,
  /** Fraction of a unit, at each end, where horizontal positions are constant (the step's shoulders). */
  shoulder: 0.1,
  /** Target length of a motif's straight collars (m): the depth ramp there bends with radius >= c^2 / (4 h). */
  collar: 0.034,
  /** Tube radius (m) for uncompressed words; compressed words use min(radius, radiusPerPitch * pitch). */
  radius: 0.0058,
  radiusPerPitch: 0.2,
  /** Generic crossing: over strand at +crossDepth, under at -crossDepth at the crossing (m). */
  crossDepth: 0.015,
  /** Canonical relation motif depth step h: depths +h, 0, -h by entry position (m). */
  motifDepth: 0.022,
  /** Inverse-cancellation motif: constant depths +eta (over) and -eta (under) (m). */
  cancelDepth: 0.016,
  /** Centerline samples per strand (uniform in u over the whole length). */
  samples: 400,
  /** Tube vertices around each ring. */
  radial: 10,
} as const

export type Geometry = typeof GEOMETRY

/** Horizontal coordinate of position p (0, 1, 2). */
export const slotX = (p: number, spacing: number = GEOMETRY.spacing): number => (p - 1) * spacing
