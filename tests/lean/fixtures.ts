// Claim descriptors for the Lean track tests: the P/Q workspace claims through describeClaim, the
// ACCEPTANCE A1 composition-order pair R, S as hand-built exact data, and the 3D operation-order
// comparison built by the prepared demo actions.

import type { ClaimDescriptor, ClaimRequest, MapStepJson } from '../../src/workspace/claims'
import type { QJson } from '../../src/model/rational'
import { demoDocument, findExperiment } from '../../src/workspace/document'
import { Workspace, describeClaim } from '../../src/workspace/reducer'
import { ORDER_IDS, orderDemoActions, reverseRouteActions } from '../../src/demo/order'

const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: 'what-gets-lost', bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]

const P = { experimentId: 'exp-p', branchId: 'main' }
const Q = { experimentId: 'exp-q', branchId: 'main' }

export const r = (n: number, d = 1): QJson => ({ n: String(n), d: String(d) })
export const step = (mapId: string, label: string, rows: QJson[][]): MapStepJson => ({ mapId, label, matrix: rows })

/** P = diag(1,1,0); u = (1,0,1) and v = (1,0,-1) share the image (1,0,0). */
export function pCollision(v = 's(1,0,-1)', u = 's(1,0,1)'): ClaimDescriptor {
  return describeClaim(demoDocument(), { kind: 'same_image_witness', branch: P, u, v })
}

function pqDoc() {
  return new Workspace(demoDocument()).commit({ baseRevision: 0, actions: bindQ }).doc
}

/** P vs Q = diag(0,1,1) at basis index j (j = 0 is a true witness; j = 1 is not). */
export function pVsQ(basisIndex = 0): ClaimDescriptor {
  return describeClaim(pqDoc(), { kind: 'map_difference_witness', left: P, right: Q, basisIndex })
}

/** P then P equals P. */
export function ppEqualsP(): ClaimDescriptor {
  const d = pVsQ()
  if (d.kind !== 'map_difference_witness') throw new Error('unexpected kind')
  return { claimVersion: 1, kind: 'map_equality', dimension: 3, left: [...d.left, ...d.left], right: d.left }
}

/** P equals Q (false). */
export function pEqualsQ(): ClaimDescriptor {
  const d = pVsQ()
  if (d.kind !== 'map_difference_witness') throw new Error('unexpected kind')
  return { claimVersion: 1, kind: 'map_equality', dimension: 3, left: d.left, right: d.right }
}

const R = step('map-r', 'R', [[r(0), r(-1)], [r(1), r(0)]])
const S = step('map-s', 'S', [[r(1), r(0)], [r(0), r(-1)]])

/** A1: "R then S" (= S R) versus "S then R" (= R S), at basis index j. */
export function rsOrder(basisIndex = 0): ClaimDescriptor {
  return { claimVersion: 1, kind: 'map_difference_witness', dimension: 2, left: [R, S], right: [S, R], basisIndex }
}

// ------------------------------------------------------------------ the operation-order demonstration (3D)

/** The comparison's routes: left = [R, S] (R then S, resolving to SR), right = [S, R] (resolving to RS). */
export const ORDER_LEFT = { experimentId: ORDER_IDS.experiment, branchId: 'left' }
export const ORDER_RIGHT = { experimentId: ORDER_IDS.experiment, branchId: 'right' }
export const orderDiffers: ClaimRequest = { kind: 'map_difference_witness', left: ORDER_LEFT, right: ORDER_RIGHT, basisIndex: 0 }
export const orderEqual: ClaimRequest = { kind: 'map_equality', left: ORDER_LEFT, right: ORDER_RIGHT }

/** The demo document with the prepared comparison committed (the same actions the demo entry and Muse use). */
export function orderWorkspace(): Workspace {
  const ws = new Workspace(demoDocument())
  ws.commit({ baseRevision: 0, actions: orderDemoActions(ws.current) })
  return ws
}

/** Reverse the left route, so both routes are [S, R]. */
export function reverseLeft(ws: Workspace): void {
  const e = findExperiment(ws.current, ORDER_IDS.experiment)
  ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(e, 'left') })
}
