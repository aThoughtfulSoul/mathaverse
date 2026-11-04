// Which Lean template a claim kind uses. The linear claims share `mw-lean-claims-1` (template.ts); the proof
// lesson's walk claim has its own fixed definitions and version `mw-lean-walk-1` (walkTemplate.ts). A receipt
// records the version that produced it, and W5 resolution accepts a receipt only with its kind's version.

import type { ClaimKind, ExactClaim } from '../../src/workspace/claims'
import { type GeneratedClaim, TEMPLATE_VERSION, generateClaim } from './template'
import { WALK_TEMPLATE_VERSION, generateWalkClaim } from './walkTemplate'

export function templateVersionFor(kind: ClaimKind): string {
  return kind === 'walk_reorder_instance' ? WALK_TEMPLATE_VERSION : TEMPLATE_VERSION
}

/** Every template version this build issues receipts for. */
export const TEMPLATE_VERSIONS = [TEMPLATE_VERSION, WALK_TEMPLATE_VERSION] as const

export function generateAny(c: ExactClaim, hash: string): GeneratedClaim {
  return c.kind === 'walk_reorder_instance' ? generateWalkClaim(c, hash) : generateClaim(c, hash)
}
