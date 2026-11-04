// W5 server-resolved evidence (WORKSPACE-AND-AI W5, PQ-ARCHITECTURE-DECISIONS "Live Muse and W5"). The
// browser sends an EvidenceRef: a typed claim locator, the claim hash it recorded and a receipt ID. The hash
// and ID are lookup keys only. For each reference, in order:
//   1. resolve the locator against the server-rebuilt document (a deleted experiment, branch or sample is
//      unavailable);
//   2. rebuild the exact claim with the shared code (describeClaim -> parseClaimDescriptor -> claimHash);
//   3. a recomputed hash different from the recorded one is unavailable (historical when this server holds
//      a receipt for the recorded hash, otherwise a mismatch);
//   4. look up a server-issued receipt for exactly the recomputed hash (fabricated, evicted, or issued
//      before a restart: unavailable, a new check is needed) and re-audit its provenance;
//   5. only then expose the canonical statement (the Lean template's claim block for that exact claim),
//      display names reconstructed from the CURRENT document and the audited provenance.
// Names never bind a proof: the hash covers mathematical content only, so a rename or a presentation move
// keeps a claim current and undo to identical data makes it current again. Not used in any frame path.

import { describeClaim } from '../../src/workspace/reducer'
import { type ClaimKind, type ClaimRequest, type ExactClaim, claimHash, evaluateExactly, parseClaimDescriptor } from '../../src/workspace/claims'
import type { EvidenceRef } from '../../src/workspace/actions'
import { type Doc, type Experiment, branchSymbol, findBranch, findExperiment, findMap, findRecipe, findSampleSet, findWalkExperiment, walkInputOf } from '../../src/workspace/document'
import { deriveWalk } from '../../src/algebra/walk'
import { comparisonOf } from '../../src/recipes/recipe'
import { format } from '../../src/model/rational'
import { APPROVED_AXIOMS } from './audit'
import type { ReceiptRecord } from './receipts'
import { TOOLCHAIN_ID } from './runner'
import { THEOREM } from './template'
import { generateAny, templateVersionFor } from './templates'

/** Why a reference is not verified evidence for the current inputs. */
export type EvidenceReason =
  /** The locator names an experiment, branch or sample the current document does not have. */
  | 'unresolved_reference'
  /** A receipt this server issued covers the recorded hash, but the current data at the locator differs. */
  | 'historical'
  /** The current data differs from the recorded hash and no receipt covers the recorded hash. */
  | 'hash_mismatch'
  /** The hash matches, but this server session holds no receipt with that ID for it. */
  | 'no_receipt'
  /** A receipt exists but its provenance is not the audited template, theorem, toolchain or axioms. */
  | 'provenance_rejected'
  /** The proof service could not be consulted. */
  | 'checker_unavailable'

export interface BranchName {
  /** `experimentId/branchId`. */
  ref: string
  /** Resolved product in the current labels, right to left ("SR"). */
  symbol: string
  /** Chronological order in words ("R then S"). */
  order: string
  /** The experiment is the one the views show. */
  displayed: boolean
  /** The side of the experiment's bound comparison this branch is shown on, if any. */
  comparisonSide: 'left' | 'right' | null
}

export interface SampleName {
  sampleId: string
  /** Current display label (may be empty). */
  label: string
  coords: string
}

export interface EvidenceNames {
  branches: BranchName[]
  samples: SampleName[]
  /** `e1`, `e2`, `e3` for a difference witness. */
  basis: string | null
  /** The claim in current names, as a statement to check (not an assertion that it holds). */
  claim: string
}

export interface ResolvedProvenance {
  receiptId: string
  issuedAt: string
  templateVersion: string
  toolchain: string
  theorem: string
  axioms: string[]
}

export interface ResolvedEvidence {
  /** Position in the request's evidence list. */
  index: number
  kind: ClaimKind
  /** The locator as submitted (structurally validated). */
  claim: ClaimRequest
  /** `verified` only after steps 1-4 succeeded; everything else is `unavailable`. */
  status: 'verified' | 'unavailable'
  reason: EvidenceReason | null
  /** Plain text for the model and logs (fixed wording; never echoes client text). */
  note: string
  /** Current display names, when the locator resolves in the current document. */
  names: EvidenceNames | null
  /** The exact rational evaluation of the claim on the current data ("computed exactly", never "Lean checked"). */
  computed: { holds: boolean; detail: string } | null
  /** Server-recomputed hash; only when verified. */
  claimHash: string | null
  /** The Lean template's canonical claim block for exactly this claim; only when verified. */
  statement: string | null
  provenance: ResolvedProvenance | null
}

/** A lookup of a server-issued receipt by ID, bound to exactly one claim hash. */
export type ReceiptLookup = (receiptId: string, claimHash: string) => ReceiptRecord | null

const NOTES: Record<EvidenceReason, string> = {
  unresolved_reference: 'Unavailable: the reference names an experiment, branch or sample that the current workspace does not have. Not Lean-checked.',
  historical: 'Unavailable for the current inputs: a receipt from this server covers different exact data than this reference has now. At most historical; it is not evidence about the current inputs.',
  hash_mismatch: 'Unavailable: the current data at this reference does not match the recorded claim, and no receipt covers the recorded claim. Not Lean-checked.',
  no_receipt: 'Unavailable: this server session holds no matching receipt (unknown, evicted, or issued before a restart). A new check is needed.',
  provenance_rejected: 'Unavailable: the receipt does not carry the audited template, theorem, toolchain and axioms. Not Lean-checked.',
  checker_unavailable: 'Unavailable: the proof service could not be consulted. Not Lean-checked.',
}
const VERIFIED_NOTE = 'Verified by the server for the current inputs: this exact claim was rebuilt from the current workspace and a receipt this server issued after a successful audited Lean check covers exactly that data.'

const t = (v: readonly { n: bigint; d: bigint }[]) => `(${v.map(format).join(', ')})`
/** `e_{1}` -> `e1`: plain text for the model. */
const plain = (label: string) => label.replace(/_\{(\d+)\}/g, '$1')

function branchName(doc: Doc, e: Experiment, branchId: string): BranchName {
  const b = findBranch(e, branchId)
  const cmp = e.binding ? comparisonOf(findRecipe(doc, e.binding.recipeId)) : null
  const side = cmp ? (e.binding!.ports[cmp.left] === branchId ? 'left' : e.binding!.ports[cmp.right] === branchId ? 'right' : null) : null
  return {
    ref: `${e.id}/${branchId}`,
    symbol: branchSymbol(doc, e, branchId),
    order: b.mapIds.length ? b.mapIds.map((id) => findMap(doc, id).label).join(' then ') : 'identity',
    displayed: doc.selection.experimentId === e.id,
    comparisonSide: side,
  }
}

/** Display names from the current document. Throws when the locator does not resolve. */
export function namesFor(doc: Doc, c: ClaimRequest): EvidenceNames {
  const brief = (b: BranchName) => `${b.symbol} (${b.ref}, ${b.order})`
  if (c.kind === 'same_image_witness') {
    const e = findExperiment(doc, c.branch.experimentId)
    const set = findSampleSet(doc, e.sampleSetId)
    const sample = (id: string): SampleName => {
      const s = set.samples.find((x) => x.id === id)
      if (!s) throw new Error(`unknown sample ${id}`)
      return { sampleId: s.id, label: s.label, coords: t(s.coords) }
    }
    const [u, v] = [sample(c.u), sample(c.v)]
    const b = branchName(doc, e, c.branch.branchId)
    const nm = (s: SampleName) => `${plain(s.label) || s.sampleId} = ${s.coords}`
    return { branches: [b], samples: [u, v], basis: null, claim: `${nm(u)} and ${nm(v)} are different and have the same image under ${brief(b)}` }
  }
  if (c.kind === 'walk_reorder_instance') {
    const e = findWalkExperiment(doc, c.experimentId)
    const f = deriveWalk(walkInputOf(e))
    return { branches: [], samples: [], basis: null, claim: `the ${f.n}-arrow walk ${e.id} (signs ${f.signs.map((s) => (s === 1 ? '+' : '−')).join(' ')}) returns to its start, has source bound B = ${f.B} and signed bound D = ${f.D}, and every prefix of its positive-forward, negative-reverse order is within (B + D)/2 = ${format(f.R)} (squared norms, this finite example)` }
  }
  const l = branchName(doc, findExperiment(doc, c.left.experimentId), c.left.branchId)
  const r = branchName(doc, findExperiment(doc, c.right.experimentId), c.right.branchId)
  if (c.kind === 'map_equality') return { branches: [l, r], samples: [], basis: null, claim: `${brief(l)} and ${brief(r)} are the same matrix` }
  const basis = `e${c.basisIndex + 1}`
  return { branches: [l, r], samples: [], basis, claim: `${brief(l)} and ${brief(r)} send ${basis} to different vectors, so the maps differ` }
}

type Computed = ResolvedEvidence['computed']

function unavailable(index: number, claim: ClaimRequest, reason: EvidenceReason, names: EvidenceNames | null = null, computed: Computed = null): ResolvedEvidence {
  return { index, kind: claim.kind, claim, status: 'unavailable', reason, note: NOTES[reason], names, computed, claimHash: null, statement: null, provenance: null }
}

/** The receipt's provenance is the audited one this build issues for the claim's kind (template, theorem, toolchain, axioms). */
function auditedProvenance(r: ReceiptRecord, kind: ClaimKind): boolean {
  return r.templateVersion === templateVersionFor(kind) && r.theorem === THEOREM && r.toolchain === TOOLCHAIN_ID && r.axioms.every((a) => APPROVED_AXIOMS.includes(a))
}

/** Resolve one reference against the rebuilt document (steps 1-5 above). Never throws. */
export async function resolveOne(doc: Doc, ref: EvidenceRef, index: number, lookup: ReceiptLookup): Promise<ResolvedEvidence> {
  const claim = ref.claim
  // 1-2. Locator -> exact claim with the shared code -> server hash. Any failure is an unresolved reference.
  let exact: ExactClaim
  let names: EvidenceNames
  let computed: Computed
  let hash: string
  try {
    exact = parseClaimDescriptor(describeClaim(doc, claim))
    names = namesFor(doc, claim)
    computed = evaluateExactly(exact)
    hash = await claimHash(exact)
  } catch {
    return unavailable(index, claim, 'unresolved_reference')
  }
  // 3. The recorded hash is a lookup key only: if the current data differs, nothing about it is current.
  if (hash !== ref.claimHash) return unavailable(index, claim, lookup(ref.receiptId, ref.claimHash) ? 'historical' : 'hash_mismatch', names, computed)
  // 4. A server-issued receipt for exactly the recomputed hash, with the audited provenance.
  const receipt = lookup(ref.receiptId, hash)
  if (!receipt) return unavailable(index, claim, 'no_receipt', names, computed)
  if (receipt.claimHash !== hash || !auditedProvenance(receipt, exact.kind)) return unavailable(index, claim, 'provenance_rejected', names, computed)
  // 5. The canonical statement is regenerated from the exact claim (numbers only; no client text).
  let statement: string
  try {
    statement = generateAny(exact, hash).statement
  } catch {
    return unavailable(index, claim, 'unresolved_reference', names, computed)
  }
  return {
    index, kind: claim.kind, claim, status: 'verified', reason: null, note: VERIFIED_NOTE, names, computed, claimHash: hash, statement,
    provenance: { receiptId: receipt.id, issuedAt: receipt.issuedAt, templateVersion: receipt.templateVersion, toolchain: receipt.toolchain, theorem: receipt.theorem, axioms: [...receipt.axioms] },
  }
}

/** Resolve every reference, in order, against the server-rebuilt document. */
export async function resolveEvidenceWith(doc: Doc, refs: readonly EvidenceRef[], lookup: ReceiptLookup): Promise<ResolvedEvidence[]> {
  const out: ResolvedEvidence[] = []
  for (const [i, ref] of refs.entries()) out.push(await resolveOne(doc, ref, i, lookup))
  return out
}

/** Every reference unavailable for one reason (used when the proof service cannot be consulted). */
export function allUnavailable(refs: readonly EvidenceRef[], reason: EvidenceReason): ResolvedEvidence[] {
  return refs.map((r, i) => unavailable(i, r.claim, reason))
}
