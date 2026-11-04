// Derived, bounded rendering projection of committed state (RUNTIME-ADAPTER R3 `viewDescription`).
// Produced by the recipe interpreter (src/recipes/derive.ts) whenever the document changes; the adapter
// only sees these plain records (stable IDs, roles, float display coordinates, display text and glyph
// tokens). Coordinates are mathematical; the adapter places them through the view's embedding.

import { type Vec } from '../model/linear'
import { tex, format } from '../model/rational'

export type Role = 'input' | 'output' | 'fiber' | 'plane' | 'neutral' | 'selected'
/** `output2` exists only in a branch comparison: `output` shows the left route, `output2` the right. */
export type ViewRole = 'input' | 'output' | 'output2'

export type Emphasis = 'focus' | 'group' | 'dim' | 'normal'
export interface PointDesc {
  kind: 'point'; id: string; sourceId: string; view: ViewRole; at: number[]; role: Role; label: string | null; interaction: 'handle' | 'select' | null
  /** focus = selected; group = shares the selected sample's exact output; dim = unrelated while something is selected. */
  emphasis: Emphasis
  /** Comparison only: identity colour index of a labelled sample (the same sample has the same colour in every view). */
  ident?: number
}
export interface VectorDesc { kind: 'vector'; id: string; sourceId: string; view: ViewRole; from: number[]; to: number[]; role: Role; label: string | null; ident?: number }
export interface SegmentDesc { kind: 'segment'; id: string; view: ViewRole; from: number[]; to: number[]; role: Role; label: string | null }
export interface PlaneDesc { kind: 'plane'; id: string; view: ViewRole; /** Coordinate held at zero by the plane (2 = z). */ normalAxis: number; halfExtent: number; role: Role; label: string }
export interface CubeDesc { kind: 'cube'; id: string; view: ViewRole; corners: number[][]; edges: [number, number][]; role: Role }
/** One prebuilt glyph token of a readout (review C1): TeX, colour role and TeX spacing class. */
export interface GlyphToken { tex: string; role?: Role; space?: 'ord' | 'rel' | 'punct' | 'open' | 'close' | 'word'; /** Identity colour index (wins over role). */ ident?: number }

export interface EquationDesc {
  kind: 'equation'
  id: string
  view: ViewRole | 'bench'
  /** TeX parts, each optionally coloured by role (typeset as one equation). */
  parts: { tex: string; role?: Role }[]
  /** When present, the readout is laid out from prebuilt glyph tokens instead (synchronous, no MathJax). */
  tokens?: GlyphToken[]
  /** Plain-text rendering of the same content: the fallback while pending or after a typesetting error. */
  plain: string
  /** TeX caption under the equation ('' for none), and its plain-text fallback. */
  captionTex: string
  captionPlain: string
  /** Prebuilt-token form of the caption (phrases + counts), when it can change during interaction. */
  captionTokens?: GlyphToken[]
  /** Shows uncommitted drag-preview values (rendered with a distinct plate). */
  preview: boolean
}

/** A label riding on an output location: one per exact group holding a named sample ("Qa = Qb"). */
export interface LabelDesc { kind: 'label'; id: string; view: ViewRole; /** Follows this sample's live dot. */ anchorSourceId: string; tokens: GlyphToken[]; plain: string; emphasis: 'focus' | 'normal' }

/** A closed outline through samples (recipe operation `sample_outline`), in one view through that view's map.
 * `vertexIds` name the samples, so presentation can follow their live dots; `points` are the committed places. */
export interface OutlineDesc { kind: 'outline'; id: string; view: ViewRole; vertexIds: string[]; points: number[][]; role: Role }

export type Primitive = PointDesc | VectorDesc | SegmentDesc | PlaneDesc | CubeDesc | EquationDesc | LabelDesc | OutlineDesc

/**
 * How presentation moves samples during one comparison step, chosen from the step's exact matrix (never its
 * name): a quarter-turn rotation about a coordinate axis follows a true angular path; any other map is a
 * straight-line transition to it (its intermediate frames are not that map); the identity moves nothing.
 */
export type StepMotion =
  | { kind: 'rotation'; /** Mathematical axis (2 = z; 2D maps rotate about the implicit z). */ axis: 0 | 1 | 2; /** Radians, right-hand rule. */ angle: number }
  | { kind: 'straight' }
  | { kind: 'none' }

/** One chronological step of a route: the state after its k-th map. */
export interface RouteStage {
  mapId: string
  /** The step's own map label ("R"). */
  label: string
  /** Product so far, read right to left ("SR" after R then S). */
  symbol: string
  /** What this map does, in words, from its exact matrix ("rotate 90° about z"). */
  verb: string
  motion: StepMotion
  /** Display floats of every sample after this step (presentation copies of exact values). */
  at: Record<string, number[]>
  /** Exact: this map leaves the selected sample where the previous step put it (false without a selection). */
  selectedFixed: boolean
}

/** One route of a branch comparison (app-facing summary; the geometry is in the primitives). */
export interface RouteDesc {
  branchId: string
  view: 'output' | 'output2'
  /** Resolved product read right to left ("SR" for R then S). */
  symbol: string
  /** Chronological order in words ("R then S"). */
  order: string
  /** Number of maps applied in order (the playback shows input, then one step per map). */
  steps: number
  /** The `steps` stages in chronological order (stage k-1 is the state after the k-th map). */
  stages: RouteStage[]
}

/** Present when the bound recipe lays out a branch comparison (recipe operation `branch_comparison`). */
export interface ComparisonDesc {
  left: RouteDesc
  right: RouteDesc
  /** Exact: the two resolved matrices are equal. */
  mapsEqual: boolean
  /** Workbench status line as prebuilt glyph tokens and its plain fallback (shown by the app as-is). */
  statusTokens: GlyphToken[]
  statusPlain: string
}

export interface ViewDescription {
  /** Branch comparison layout, or null for linked views. In a comparison, mapSymbol/matrix describe the left
   * route, and fiberAvailable is false. */
  comparison: ComparisonDesc | null
  mathRevision: number
  revision: number
  /** The displayed experiment (stable ID). */
  experimentId: string
  /** Display symbol of the bound map ("P", "Q", "QP"); text only, identity is the experiment/map IDs. */
  mapSymbol: string
  mapName: string
  /** Row-major display floats of the committed matrix (presentation only; the model keeps exact values). */
  matrix: number[][]
  primitives: Primitive[]
  /** Output groups of size > 1, by sample IDs (exact). */
  collisions: string[][]
  fiberAvailable: boolean
  fiberAxis: number | null
  /** Set by the interaction layer while a drag preview is shown (display only). */
  previewSample: string | null
  /** Truthful explanations of representations the recipe asked for but this map does not support. */
  notes: string[]
  /** Every glyph token this description and its interactions (drags, playback) can need. */
  tokenSet: string[]
}

export function vecTex(v: Vec): string {
  return `\\left(${v.map(tex).join(',\\ ')}\\right)`
}

export function vecText(v: Vec): string {
  return `(${v.map(format).join(', ')})`
}

/** Tokens for a coordinate tuple: ( a , b , c ). */
export function vecTokens(v: Vec): GlyphToken[] {
  const out: GlyphToken[] = [{ tex: '(', space: 'open' }]
  v.forEach((x, i) => {
    if (i > 0) out.push({ tex: ',', space: 'punct' })
    out.push({ tex: tex(x) })
  })
  out.push({ tex: ')', space: 'close' })
  return out
}

/** Plain-text form of a display name: w_{2} -> w2. */
export function plainName(name: string): string {
  return name.replace(/_\{(.*?)\}/g, '$1').replace(/\\/g, '')
}

/** The cube [-1, 1]^3 wireframe (fixed edge incidence), as corner coordinates. */
export const CUBE_CORNERS: number[][] = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])))
export const CUBE_EDGES: [number, number][] = (() => {
  const e: [number, number][] = []
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const diff = CUBE_CORNERS[i]!.filter((c, k) => c !== CUBE_CORNERS[j]![k]).length
    if (diff === 1) e.push([i, j])
  }
  return e
})()

