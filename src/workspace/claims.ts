// The three concrete claim kinds eligible for Lean checking (MATHEMATICAL-CONTRACT M9, WORKSPACE W6).
//
// ClaimRequest  - what an action names: workspace references (experiment, branch, sample IDs).
// ClaimDescriptor - what is sent to POST /api/check: resolved exact data. The checker regenerates the
//   matrices from this ordered step list; it never reads rendered coordinates.
// The claim hash covers mathematical content only (dimension, step matrices in order, witness
// coordinates, basis index). Display labels and IDs are carried for the readable statement but are
// excluded from the hash, so renaming or moving a display never invalidates a result (M9).
//
// Pure module: imported by the browser and by the Node server.

import { type Dim, type Mat, type Vec, apply, compose, matEq, vecEq } from '../model/linear'
import { type QJson, fromJson as qFromJson, toJson as qToJson, format } from '../model/rational'
import { HASH_VERSION, versionedHash } from './canonical'
import { type ExactWalkClaim, type WalkClaimDescriptor, WALK_CLAIM_KIND, WalkClaimError, evaluateWalkExactly, parseWalkClaimDescriptor, walkClaimHashPayload } from './walkClaim'

export class ClaimError extends Error {
  override name = 'ClaimError'
}

/** The proof lesson adds `walk_reorder_instance` (src/workspace/walkClaim.ts, PROOF-EXPLORER-MATH section 8). */
export const CLAIM_KINDS = ['same_image_witness', 'map_equality', 'map_difference_witness', 'walk_reorder_instance'] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]

export interface BranchRef {
  experimentId: string
  branchId: string
}

export type ClaimRequest =
  | { kind: 'same_image_witness'; branch: BranchRef; u: string; v: string }
  | { kind: 'map_equality'; left: BranchRef; right: BranchRef }
  | { kind: 'map_difference_witness'; left: BranchRef; right: BranchRef; basisIndex: number }
  /** The proof lesson: the current data of a vector-walk experiment (every prefix; not the selected endpoint). */
  | { kind: 'walk_reorder_instance'; experimentId: string }

/** One map of an ordered sequence, as exact data. `label` and `mapId` are display/identity only. */
export interface MapStepJson {
  mapId: string
  label: string
  matrix: QJson[][]
}

export interface WitnessJson {
  sampleId: string
  label: string
  coords: QJson[]
}

export type ClaimDescriptor =
  | { claimVersion: 1; kind: 'same_image_witness'; dimension: Dim; sequence: MapStepJson[]; u: WitnessJson; v: WitnessJson }
  | { claimVersion: 1; kind: 'map_equality'; dimension: Dim; left: MapStepJson[]; right: MapStepJson[] }
  | { claimVersion: 1; kind: 'map_difference_witness'; dimension: Dim; left: MapStepJson[]; right: MapStepJson[]; basisIndex: number }
  | WalkClaimDescriptor

// ------------------------------------------------------------------ parsing

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function closed(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new ClaimError(`${where}: unknown field "${k}"`)
  for (const k of allowed) if (!(k in o)) throw new ClaimError(`${where}: missing field "${k}"`)
}

const ID_RE = /^\$?[A-Za-z0-9][A-Za-z0-9_.:()\-,]{0,63}$/

function str(x: unknown, where: string): string {
  if (typeof x !== 'string' || !ID_RE.test(x)) throw new ClaimError(`${where}: invalid ID`)
  return x
}

function branchRef(x: unknown, where: string): BranchRef {
  if (!isObj(x)) throw new ClaimError(`${where}: expected an object`)
  closed(x, ['experimentId', 'branchId'], where)
  return { experimentId: str(x.experimentId, `${where}.experimentId`), branchId: str(x.branchId, `${where}.branchId`) }
}

export function parseClaimRequest(x: unknown, where = 'claim'): ClaimRequest {
  if (!isObj(x)) throw new ClaimError(`${where}: expected an object`)
  switch (x.kind) {
    case 'same_image_witness':
      closed(x, ['kind', 'branch', 'u', 'v'], where)
      return { kind: x.kind, branch: branchRef(x.branch, `${where}.branch`), u: str(x.u, `${where}.u`), v: str(x.v, `${where}.v`) }
    case 'map_equality':
      closed(x, ['kind', 'left', 'right'], where)
      return { kind: x.kind, left: branchRef(x.left, `${where}.left`), right: branchRef(x.right, `${where}.right`) }
    case 'map_difference_witness': {
      closed(x, ['kind', 'left', 'right', 'basisIndex'], where)
      const j = x.basisIndex
      if (typeof j !== 'number' || !Number.isInteger(j) || j < 0 || j > 2) throw new ClaimError(`${where}.basisIndex: 0, 1 or 2`)
      return { kind: x.kind, left: branchRef(x.left, `${where}.left`), right: branchRef(x.right, `${where}.right`), basisIndex: j }
    }
    case 'walk_reorder_instance':
      closed(x, ['kind', 'experimentId'], where)
      return { kind: x.kind, experimentId: str(x.experimentId, `${where}.experimentId`) }
    default:
      throw new ClaimError(`${where}: unknown claim kind ${JSON.stringify(x.kind)}`)
  }
}

function dim(x: unknown, where: string): Dim {
  if (x !== 2 && x !== 3) throw new ClaimError(`${where}: dimension must be 2 or 3`)
  return x
}

function exactVec(x: unknown, d: Dim, where: string): Vec {
  if (!Array.isArray(x) || x.length !== d) throw new ClaimError(`${where}: expected ${d} rationals`)
  return x.map((c, i) => {
    try {
      return qFromJson(c)
    } catch (e) {
      throw new ClaimError(`${where}[${i}]: ${(e as Error).message}`)
    }
  })
}

function steps(x: unknown, d: Dim, where: string): Mat[] {
  if (!Array.isArray(x) || x.length > 6) throw new ClaimError(`${where}: at most six maps`)
  return x.map((s, i) => {
    const w = `${where}[${i}]`
    if (!isObj(s)) throw new ClaimError(`${w}: expected an object`)
    closed(s, ['mapId', 'label', 'matrix'], w)
    str(s.mapId, `${w}.mapId`)
    if (typeof s.label !== 'string' || s.label.length > 16) throw new ClaimError(`${w}.label: short display text`)
    if (!Array.isArray(s.matrix) || s.matrix.length !== d) throw new ClaimError(`${w}.matrix: expected ${d} rows`)
    return s.matrix.map((row, r) => exactVec(row, d, `${w}.matrix[${r}]`))
  })
}

function witness(x: unknown, d: Dim, where: string): Vec {
  if (!isObj(x)) throw new ClaimError(`${where}: expected an object`)
  closed(x, ['sampleId', 'label', 'coords'], where)
  str(x.sampleId, `${where}.sampleId`)
  if (typeof x.label !== 'string' || x.label.length > 16) throw new ClaimError(`${where}.label: short display text`)
  return exactVec(x.coords, d, `${where}.coords`)
}

/** Parsed exact form of a descriptor (what a checker and the local evaluator work from). */
export type ExactClaim =
  | { kind: 'same_image_witness'; dimension: Dim; sequence: Mat[]; u: Vec; v: Vec }
  | { kind: 'map_equality'; dimension: Dim; left: Mat[]; right: Mat[] }
  | { kind: 'map_difference_witness'; dimension: Dim; left: Mat[]; right: Mat[]; basisIndex: number }
  | ExactWalkClaim

/** Strict validation of a descriptor received at the server boundary (closed fields, exact rationals). */
export function parseClaimDescriptor(x: unknown): ExactClaim {
  if (!isObj(x)) throw new ClaimError('claim: expected an object')
  if (x.kind === WALK_CLAIM_KIND) {
    try {
      return parseWalkClaimDescriptor(x)
    } catch (e) {
      if (e instanceof WalkClaimError) throw new ClaimError(e.message)
      throw e
    }
  }
  if (x.claimVersion !== 1) throw new ClaimError('claim.claimVersion: must be 1')
  const d = dim(x.dimension, 'claim.dimension')
  switch (x.kind) {
    case 'same_image_witness':
      closed(x, ['claimVersion', 'kind', 'dimension', 'sequence', 'u', 'v'], 'claim')
      return { kind: x.kind, dimension: d, sequence: steps(x.sequence, d, 'claim.sequence'), u: witness(x.u, d, 'claim.u'), v: witness(x.v, d, 'claim.v') }
    case 'map_equality':
      closed(x, ['claimVersion', 'kind', 'dimension', 'left', 'right'], 'claim')
      return { kind: x.kind, dimension: d, left: steps(x.left, d, 'claim.left'), right: steps(x.right, d, 'claim.right') }
    case 'map_difference_witness': {
      closed(x, ['claimVersion', 'kind', 'dimension', 'left', 'right', 'basisIndex'], 'claim')
      const j = x.basisIndex
      if (typeof j !== 'number' || !Number.isInteger(j) || j < 0 || j >= d) throw new ClaimError(`claim.basisIndex: 0..${d - 1}`)
      return { kind: x.kind, dimension: d, left: steps(x.left, d, 'claim.left'), right: steps(x.right, d, 'claim.right'), basisIndex: j }
    }
    default:
      throw new ClaimError(`claim: unknown kind ${JSON.stringify(x.kind)}`)
  }
}

// ------------------------------------------------------------------ hashing and local evaluation

const matJson = (m: Mat): QJson[][] => m.map((r) => r.map(qToJson))
const vecJson = (v: Vec): QJson[] => v.map(qToJson)

/** The mathematical content that the claim hash covers (labels/IDs excluded). */
export function claimHashPayload(c: ExactClaim): unknown {
  switch (c.kind) {
    case 'same_image_witness':
      return { kind: c.kind, dimension: c.dimension, sequence: c.sequence.map(matJson), u: vecJson(c.u), v: vecJson(c.v) }
    case 'map_equality':
      return { kind: c.kind, dimension: c.dimension, left: c.left.map(matJson), right: c.right.map(matJson) }
    case 'map_difference_witness':
      return { kind: c.kind, dimension: c.dimension, left: c.left.map(matJson), right: c.right.map(matJson), basisIndex: c.basisIndex }
    case 'walk_reorder_instance':
      return walkClaimHashPayload(c)
  }
}

/** Claim hash: SHA-256 of the versioned canonical mathematical payload. Client and server use this. */
export function claimHash(c: ExactClaim): Promise<string> {
  return versionedHash(HASH_VERSION.claim, claimHashPayload(c))
}

export interface LocalEvaluation {
  /** Whether the exact rational computation says the claim holds ("Computed exactly", never "Lean checked"). */
  holds: boolean
  /** Short plain-text account of the computation. */
  detail: string
}

/** M8/M9 local exact evaluation of a claim. */
export function evaluateExactly(c: ExactClaim): LocalEvaluation {
  const t = (v: Vec) => `(${v.map(format).join(', ')})`
  switch (c.kind) {
    case 'same_image_witness': {
      const a = compose(c.dimension, c.sequence)
      const au = apply(a, c.u)
      const av = apply(a, c.v)
      const distinct = !vecEq(c.u, c.v)
      const same = vecEq(au, av)
      return { holds: distinct && same, detail: !distinct ? 'the two inputs are equal' : same ? `both map to ${t(au)}` : `outputs differ: ${t(au)} and ${t(av)}` }
    }
    case 'map_equality': {
      const l = compose(c.dimension, c.left)
      const r = compose(c.dimension, c.right)
      return { holds: matEq(l, r), detail: matEq(l, r) ? 'every entry is equal' : 'some entry differs' }
    }
    case 'map_difference_witness': {
      const e = Array.from({ length: c.dimension }, (_, i) => ({ n: i === c.basisIndex ? 1n : 0n, d: 1n }))
      const l = apply(compose(c.dimension, c.left), e)
      const r = apply(compose(c.dimension, c.right), e)
      const differ = !vecEq(l, r)
      return { holds: differ, detail: differ ? `images of e${c.basisIndex + 1}: ${t(l)} and ${t(r)}` : `both send e${c.basisIndex + 1} to ${t(l)}` }
    }
    case 'walk_reorder_instance':
      return evaluateWalkExactly(c)
  }
}

// ------------------------------------------------------------------ check endpoint (W6)

export interface CheckRequest {
  requestId: string
  claim: ClaimDescriptor
}

export type CheckStatus = 'checked' | 'not_established' | 'error'

/** Proof provenance, present only after a successful audit. */
export interface Provenance {
  templateVersion: string
  toolchain: string
  theorem: string
  /** Axioms the audited theorem depends on (must be a subset of the approved set). */
  axioms: string[]
  /** Must equal the claim hash recomputed by the server. */
  inputHash: string
}

export interface CheckResponse {
  requestId: string
  claimHash: string
  /** Canonical human-readable statement that was (or would have been) checked. */
  statement: string
  status: CheckStatus
  provenance: Provenance | null
  receipt: { id: string; issuedAt: string } | null
  /** Why the status is not "checked" (compile failure, timeout, false claim, audit rejection...). */
  reason: string | null
  timing: { ms: number }
}
