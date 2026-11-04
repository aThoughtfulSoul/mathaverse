// The concrete finite claim of the proof lesson, `walk_reorder_instance` (PROOF-EXPLORER-MATH section 8).
// It is resolved from the current vector-walk experiment: exact vectors and signs in source order plus the
// bound convention. The hash covers exactly that content (occurrence IDs, selection and presentation are
// excluded), so selecting another endpoint keeps a receipt current and a sign or data change invalidates it.
//
// What a successful check means: Lean recomputed, from these exact numbers, every source / signed /
// reordered prefix and the output order, and confirmed a conjunction of true finite facts (zero total, the
// integer bounds B and D, the permutation, every prefix identity, every reordered squared norm at most
// ((B + D)/2)^2). It checks this one example: not the general lemma, the research theorem, the renderer or
// any explanation. With a nonzero total there is nothing to certify: the claim is refused with its arithmetic.
//
// Pure module: imported by the browser and by the Node server.

import { type QJson, fromJson as qFromJson, toJson as qToJson, format, mul } from '../model/rational'
import type { Dim, Vec } from '../model/linear'
import { type Sign, type WalkInput, BOUND_CONVENTION, OCCURRENCE_ID_RE, WALK_LIMITS, WalkError, checkWalk, deriveWalk, signsInSourceOrder, vectorsInSourceOrder, vtext } from '../algebra/walk'

export const WALK_CLAIM_KIND = 'walk_reorder_instance'

export class WalkClaimError extends Error {
  override name = 'WalkClaimError'
}

/** What the browser sends to POST /api/check: exact data in source order (IDs for display only). */
export interface WalkClaimDescriptor {
  claimVersion: 1
  kind: typeof WALK_CLAIM_KIND
  dimension: Dim
  vectors: { id: string; coords: QJson[] }[]
  signs: Sign[]
  convention: typeof BOUND_CONVENTION
}

/** Parsed exact form. */
export interface ExactWalkClaim {
  kind: typeof WALK_CLAIM_KIND
  dimension: Dim
  ids: string[]
  vectors: Vec[]
  signs: Sign[]
  convention: typeof BOUND_CONVENTION
}

/** The descriptor of a walk's current data. */
export function describeWalkClaim(w: WalkInput): WalkClaimDescriptor {
  checkWalk(w)
  const vs = vectorsInSourceOrder(w)
  return { claimVersion: 1, kind: WALK_CLAIM_KIND, dimension: w.dimension, vectors: w.order.map((id, i) => ({ id, coords: vs[i]!.map(qToJson) })), signs: signsInSourceOrder(w), convention: BOUND_CONVENTION }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function closed(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new WalkClaimError(`${where}: unknown field "${k}"`)
  for (const k of allowed) if (!(k in o)) throw new WalkClaimError(`${where}: missing field "${k}"`)
}

/** Strict validation at the server boundary (closed fields, exact rationals, walk bounds). */
export function parseWalkClaimDescriptor(x: unknown): ExactWalkClaim {
  if (!isObj(x)) throw new WalkClaimError('claim: expected an object')
  closed(x, ['claimVersion', 'kind', 'dimension', 'vectors', 'signs', 'convention'], 'claim')
  if (x.claimVersion !== 1) throw new WalkClaimError('claim.claimVersion: must be 1')
  if (x.kind !== WALK_CLAIM_KIND) throw new WalkClaimError(`claim.kind: expected ${WALK_CLAIM_KIND}`)
  if (x.dimension !== 2 && x.dimension !== 3) throw new WalkClaimError('claim.dimension: 2 or 3')
  if (x.convention !== BOUND_CONVENTION) throw new WalkClaimError(`claim.convention: expected ${BOUND_CONVENTION}`)
  const d = x.dimension
  if (!Array.isArray(x.vectors) || x.vectors.length < WALK_LIMITS.minVectors || x.vectors.length > WALK_LIMITS.maxVectors) throw new WalkClaimError(`claim.vectors: ${WALK_LIMITS.minVectors} to ${WALK_LIMITS.maxVectors} vectors`)
  const ids: string[] = []
  const vectors = x.vectors.map((v, i) => {
    const w = `claim.vectors[${i}]`
    if (!isObj(v)) throw new WalkClaimError(`${w}: expected an object`)
    closed(v, ['id', 'coords'], w)
    if (typeof v.id !== 'string' || !OCCURRENCE_ID_RE.test(v.id)) throw new WalkClaimError(`${w}.id: invalid occurrence ID`)
    ids.push(v.id)
    if (!Array.isArray(v.coords) || v.coords.length !== d) throw new WalkClaimError(`${w}.coords: expected ${d} rationals`)
    return v.coords.map((c, k) => {
      try {
        return qFromJson(c)
      } catch (e) {
        throw new WalkClaimError(`${w}.coords[${k}]: ${(e as Error).message}`)
      }
    })
  })
  if (!Array.isArray(x.signs) || x.signs.length !== vectors.length || !x.signs.every((s) => s === 1 || s === -1)) throw new WalkClaimError('claim.signs: one sign (1 or -1) per vector')
  const claim: ExactWalkClaim = { kind: WALK_CLAIM_KIND, dimension: d, ids, vectors, signs: [...(x.signs as Sign[])], convention: BOUND_CONVENTION }
  try {
    checkWalk(walkOf(claim))
  } catch (e) {
    throw new WalkClaimError(`claim: ${(e as WalkError).message}`)
  }
  return claim
}

/** The walk a parsed claim describes (source order = stored order). */
export function walkOf(c: ExactWalkClaim): WalkInput {
  return { dimension: c.dimension, vectors: c.vectors.map((coords, i) => ({ id: c.ids[i]!, coords })), order: [...c.ids], signs: [...c.signs] }
}

/** The mathematical content the claim hash covers (IDs excluded). */
export function walkClaimHashPayload(c: ExactWalkClaim): unknown {
  return { kind: c.kind, dimension: c.dimension, vectors: c.vectors.map((v) => v.map(qToJson)), signs: c.signs, convention: c.convention }
}

/** Exact local evaluation: whether every conjunct the Lean statement asserts holds ("computed exactly"). */
export function evaluateWalkExactly(c: ExactWalkClaim): { holds: boolean; detail: string } {
  const f = deriveWalk(walkOf(c))
  const R = format(f.R)
  if (!f.zeroSum) {
    const k = f.firstFailure
    const fails = k === null ? 'here the bound happens to hold, but nothing guarantees it' : `here W_${k} = ${vtext(f.W[k]!)} has |W_${k}|^2 = ${format(f.wNorm2[k]!)} > ${format(mul(f.R, f.R))} = (${R})^2`
    return { holds: false, detail: `the walk does not return to its start (total ${vtext(f.total)}), so the reordering lemma does not apply; ${fails}` }
  }
  // With T = 0 every conjunct is a theorem (signedOrder_prefix_bound); evaluated anyway, never assumed.
  const ok = f.boundHolds && f.witnesses.every((w) => w.zeroSumFormHolds)
  return { holds: ok, detail: ok ? `total zero; B = ${f.B}, D = ${f.D}; every reordered prefix has |W_k|^2 <= (${R})^2 (peak ${format(f.reorderedPeak2)})` : 'an exact prefix check failed' }
}
