// Claim-specific evidence in the mathematics detail: a view lists only the checks about its own experiments.

import { describe, expect, it } from 'vitest'
import { evidenceItems } from '../../src/ui/presenters/linear'
import type { EvidenceItem } from '../../src/ui/model'

const item = (id: number, claim: EvidenceItem['claim']): EvidenceItem => ({ id, claim, label: `claim ${id}`, status: 'checked', current: true, statement: null, provenance: null, message: null })
const same = item(1, { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 'a', v: 'b' })
const pq = item(2, { kind: 'map_difference_witness', left: { experimentId: 'exp-p', branchId: 'main' }, right: { experimentId: 'exp-q', branchId: 'main' }, basisIndex: 0 })
const order = item(3, { kind: 'map_equality', left: { experimentId: 'exp-order', branchId: 'left' }, right: { experimentId: 'exp-order', branchId: 'right' } })
const listed = (d: ReturnType<typeof evidenceItems>) => d.flatMap((x) => (x.kind === 'evidence' ? x.items.map((i) => i.id) : []))

describe('evidence detail filter', () => {
  it('keeps only the claims about the given experiments', () => {
    expect(listed(evidenceItems([same, pq, order], ['exp-p', 'exp-q']))).toEqual([1, 2])
    expect(listed(evidenceItems([same, pq, order], ['exp-order']))).toEqual([3])
  })
  it('shows the honest empty state when nothing matches, and everything without a filter', () => {
    expect(evidenceItems([order], ['exp-p'])).toEqual([expect.objectContaining({ kind: 'text' })])
    expect(listed(evidenceItems([same, pq, order]))).toEqual([1, 2, 3])
  })
})
