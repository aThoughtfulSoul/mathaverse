// Shared exact helpers of the two linear presenters (P/Q and the operation-order comparison). Values come from
// the document (exact rationals) and the derived ViewDescription's own data (sample display names, exact
// collisions); nothing is parsed from rendered text.

import { type Doc, type LinearExperiment, findAnyExperiment, findRecipe, findSampleSet } from '../../workspace/document'
import { comparisonOf } from '../../recipes/recipe'
import { type Mat, type Vec } from '../../model/linear'
import { format, tex, isZero, eq, ONE, NEG_ONE } from '../../model/rational'
import { plainName } from '../../rendering/viewDescription'
import type { DetailItem, DetailSection, EvidenceItem, Label, PresenterInput, StatusView } from '../model'
import { L } from './common'

export const AXES = ['x', 'y', 'z'] as const

export function linearExperiment(input: PresenterInput): LinearExperiment | null {
  try {
    const e = findAnyExperiment(input.doc, input.experimentId)
    return e.domain === 'linear' ? e : null
  } catch {
    return null
  }
}

/** The branch a linked-views recipe reads (its linear_branch port), or the experiment's first branch. */
export function boundBranch(doc: Doc, e: LinearExperiment): string {
  const r = e.binding ? findRecipe(doc, e.binding.recipeId) : null
  const port = r ? Object.entries(r.inputs).find(([, s]) => s.type === 'linear_branch')?.[0] : undefined
  return (port && e.binding?.ports[port]) || e.branches[0]!.id
}

/** The two compared branches of a comparison experiment (left, right), or null. */
export function comparedBranches(doc: Doc, e: LinearExperiment): { left: string; right: string } | null {
  const r = e.binding ? findRecipe(doc, e.binding.recipeId) : null
  const cmp = r ? comparisonOf(r) : null
  if (!cmp || !e.binding) return null
  const left = e.binding.ports[cmp.left]
  const right = e.binding.ports[cmp.right]
  return left && right ? { left, right } : null
}

/** A sample's display name: the scene's own label (description data), its stored label, or exact coordinates. */
export function sampleName(input: PresenterInput, e: LinearExperiment, id: string): string {
  const p = input.linear?.primitives.find((x) => x.kind === 'point' && x.view === 'input' && x.sourceId === id)
  if (p && p.kind === 'point' && p.label) return plainName(p.label)
  const s = findSampleSet(input.doc, e.sampleSetId).samples.find((x) => x.id === id)
  if (!s) return id
  return s.label ? plainName(s.label) : vecText(s.coords)
}

export function sampleCoords(input: PresenterInput, e: LinearExperiment, id: string): Vec | null {
  return findSampleSet(input.doc, e.sampleSetId).samples.find((x) => x.id === id)?.coords ?? null
}

export const vecText = (v: Vec): string => `(${v.map(format).join(', ')})`
export const vecTex = (v: Vec): string => `\\left(${v.map((x) => tex(x)).join(',\\ ')}\\right)`
export const matRows = (a: Mat): string[][] => a.map((r) => r.map(format))

/** The map as a formula of x, y, z from its exact matrix: P(x, y, z) = (x, y, 0). */
export function mapFormula(symbol: string, a: Mat): Label {
  const vars = AXES.slice(0, a.length)
  const entry = (row: readonly { n: bigint; d: bigint }[], asTex: boolean): string => {
    const terms: string[] = []
    row.forEach((c, j) => {
      if (isZero(c)) return
      const v = vars[j]!
      const sign = c.n < 0n ? '-' : '+'
      const mag = eq(c, ONE) || eq(c, NEG_ONE) ? '' : asTex ? tex({ n: c.n < 0n ? -c.n : c.n, d: c.d }) : format({ n: c.n < 0n ? -c.n : c.n, d: c.d })
      terms.push(`${terms.length ? ` ${sign} ` : sign === '-' ? '-' : ''}${mag}${v}`)
    })
    return terms.length ? terms.join('') : '0'
  }
  const args = vars.join(', ')
  return L(`${symbol}(${args}) = (${a.map((r) => entry(r, false)).join(', ')})`, `${symbol}(${args}) = \\left(${a.map((r) => entry(r, true)).join(',\\ ')}\\right)`)
}

/** The drag status (spec section 4: the toolbar's Undo reads Cancel drag while a drag is uncommitted). */
export function dragStatus(input: PresenterInput, e: LinearExperiment): StatusView | null {
  const d = input.drag
  if (!d) return null
  if (d.lost) return { phase: 'paused', text: 'Controller tracking lost: the preview is frozen; releasing now cancels', tone: 'warning' }
  const n = sampleName(input, e, d.sampleId)
  const where = d.preview ? ` to ${d.preview}` : ''
  return d.mode === 'fiber'
    ? { phase: 'ready', text: `Preview: sliding ${n} along its fiber${where} · release commits, Cancel drag cancels`, tone: 'normal' }
    : { phase: 'ready', text: `Preview: moving ${n}${where} · release commits, Cancel drag cancels`, tone: 'normal' }
}

/** The experiments a claim is about. */
function claimExperiments(c: NonNullable<EvidenceItem['claim']>): string[] {
  return c.kind === 'same_image_witness' ? [c.branch.experimentId] : c.kind === 'walk_reorder_instance' ? [c.experimentId] : [c.left.experimentId, c.right.experimentId]
}

/** The evidence a view lists: with `experimentIds`, only the checks about those experiments (an entry without its claim is kept). */
function listedEvidence(all: EvidenceItem[], experimentIds?: Iterable<string>): EvidenceItem[] {
  const ids = experimentIds ? new Set(experimentIds) : null
  return ids ? all.filter((e) => !e.claim || claimExperiments(e.claim).some((id) => ids.has(id))) : all
}

/**
 * Evidence items with an honest empty state (claim-specific; never a universal badge). With `experimentIds`,
 * only the checks about those experiments are listed (an entry without its claim is kept).
 */
export function evidenceItems(all: EvidenceItem[], experimentIds?: Iterable<string>): DetailItem[] {
  const items = listedEvidence(all, experimentIds)
  return items.length
    ? [{ kind: 'evidence', items }]
    : [{ kind: 'text', text: 'No checks requested yet. A Lean receipt is claim-specific: it names the checked statement, its parameters and its provenance.' }]
}

/**
 * The provenance of a checks section: "Lean receipt" only when a listed entry is one (a server `checked`
 * response, current or historical). Check buttons, local results, refusals and errors claim no receipt.
 */
export function receiptProvenance(all: EvidenceItem[], experimentIds?: Iterable<string>): Pick<DetailSection, 'provenance'> {
  return listedEvidence(all, experimentIds).some((e) => e.status === 'checked') ? { provenance: 'Lean receipt' } : {}
}
