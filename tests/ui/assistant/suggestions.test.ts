// Suggested questions per experiment (UI-REFINEMENT-SPEC section 7, suggestions table): valid only for the
// current state, real "ask" submissions, and, in synthetic mode, phrasings that the synthetic server really
// answers on THIS document: each one matches a prepared fixture whose proposal passes the same validation as
// live output and is not an "unavailable" reply. The fixtures are the server's (server/muse); the replies are
// labelled synthetic examples, not Muse output.

import { describe, expect, it } from 'vitest'
import { suggestionsFor, availableRewrite, phrasingMode } from '../../../src/ui/assistant/suggestions'
import { matchFixture, normalizePrompt } from '../../../server/muse/synthetic'
import { validateProposal } from '../../../server/muse/validate'
import { type Doc, findGroupExperiment } from '../../../src/workspace/document'
import { sculptureRebindActions } from '../../../src/demo/four'
import { rebindTarget } from '../../../src/demo/pq'
import { CAP, SPEECH, docs, panelInput, plan } from './helpers'
import type { DemoKind } from '../../../src/demo/order'
import type { AssistantPanelInput } from '../../../src/ui/model'

type Cap = AssistantPanelInput['capability']
const live: Cap = { assistant: CAP.live, speech: SPEECH }
const texts = (doc: Doc, capability: Cap = { assistant: CAP.synthetic, speech: SPEECH }) => suggestionsFor(panelInput(doc, { capability })).map((s) => s.text)
const ids = (doc: Doc, capability: Cap = { assistant: CAP.synthetic, speech: SPEECH }) => suggestionsFor(panelInput(doc, { capability })).map((s) => s.id)

/** The synthetic server's answer to a suggestion on a document: the fixture, its validated proposal. */
function syntheticReply(doc: Doc, text: string) {
  const f = matchFixture(text)
  if (!f) return { fixture: null, ok: false, explanation: '' }
  const raw = f.build(doc, normalizePrompt(text))
  const v = validateProposal(raw, doc)
  return { fixture: f.name, ok: v.ok, explanation: v.ok ? v.proposal.explanation : (v as { message: string }).message }
}

const D = docs()
const sculptureExp = (doc: Doc) => findGroupExperiment(doc, doc.selection.experimentId)
const states: Record<string, Doc> = {
  ...D,
  'pq without selection': plan(D.pq, [{ kind: 'select', experimentId: 'exp-p', sampleId: null }]),
  'pq with Q created': plan(D.pq, rebindTarget(D.pq).actions),
  'sculpture after one apply': plan(D.sculpture, [{ kind: 'apply_element', experimentId: 'exp-c4', element: 'c1' }]),
  'sculpture, +1 applied, +2 selected': plan(D.sculpture, [{ kind: 'apply_element', experimentId: 'exp-c4', element: 'c1' }, { kind: 'select_item', experimentId: 'exp-c4', item: 'c2' }]),
  'sculpture, +1 applied, nothing selected': plan(D.sculpture, [{ kind: 'apply_element', experimentId: 'exp-c4', element: 'c1' }, { kind: 'select_item', experimentId: 'exp-c4', item: null }]),
  'sculpture without selection': plan(D.sculpture, [{ kind: 'select_item', experimentId: 'exp-c4', item: null }]),
  'sculpture on V4': plan(D.sculpture, sculptureRebindActions(D.sculpture, sculptureExp(D.sculpture))),
  'cube after a rotation': plan(D.cube, [{ kind: 'apply_element', experimentId: 'exp-cube', element: 'r(y,-x,z)' }]),
  'quotient grouped': plan(D.quotient, [{ kind: 'set_observation', experimentId: 'exp-quotient', observation: 'unoriented_axis_lines' }]),
  'quotient grouped, rotation selected': plan(D.quotient, [{ kind: 'set_observation', experimentId: 'exp-quotient', observation: 'unoriented_axis_lines' }, { kind: 'select_item', experimentId: 'exp-quotient', item: 'r(y,-x,z)' }]),
  'quotient with A and B': plan(D.quotient, [{ kind: 'set_observation', experimentId: 'exp-quotient', observation: 'unoriented_axis_lines' }, { kind: 'set_operands', experimentId: 'exp-quotient', operands: ['r(y,-x,z)', 'r(-x,z,y)'] }]),
  'quotient ungrouped with A and B': plan(D.quotient, [{ kind: 'set_operands', experimentId: 'exp-quotient', operands: ['r(y,-x,z)', 'r(x,z,-y)'] }]),
  'braid inverse pair': plan(D.braid, [{ kind: 'set_braid', experimentId: 'exp-braid', target: 'word', word: [1, -1] }, { kind: 'set_braid', experimentId: 'exp-braid', target: 'compare', word: [] }]),
  'braid relation, other side hidden': plan(D.braid, [{ kind: 'set_braid', experimentId: 'exp-braid', target: 'compare', word: [] }]),
}


describe('synthetic mode: every suggestion is answered by a prepared fixture on this document', () => {
  for (const [name, doc] of Object.entries(states)) {
    it(name, () => {
      const list = texts(doc)
      expect(list.length).toBeGreaterThan(0)
      expect(list.length).toBeLessThanOrEqual(3)
      expect(new Set(list).size).toBe(list.length)
      for (const t of list) {
        const r = syntheticReply(doc, t)
        expect(r.fixture, `"${t}" has no fixture`).not.toBeNull()
        expect(r.ok, `"${t}" (${r.fixture}) is refused: ${r.explanation}`).toBe(true)
        expect(r.explanation, `"${t}" (${r.fixture}) is a refusal`).not.toMatch(/^Not (applied|available)/)
      }
    })
  }
})

describe('suggestions are real submissions of their exact text', () => {
  it('each command asks exactly the shown text (never a scene action)', () => {
    for (const doc of Object.values(states)) {
      for (const capability of [{ assistant: CAP.synthetic, speech: SPEECH }, live] as Cap[]) {
        for (const s of suggestionsFor(panelInput(doc, { capability }))) expect(s.command).toEqual({ kind: 'assistant', action: { kind: 'ask', text: s.text } })
      }
    }
  })

  it('synthetic mode uses the spec wording, except "on Q" once Q exists (the fixture would recreate Q)', () => {
    for (const [name, doc] of Object.entries(states)) {
      const syn = texts(doc)
      const liv = texts(doc, live)
      if (name === 'pq with Q created') continue
      expect(syn, name).toEqual(liv)
    }
    const q = states['pq with Q created']!
    expect(texts(q)).toContain('Use this representation on P')
    const backOnP = plan(q, rebindTarget(q).actions)
    expect(texts(backOnP, live)).toContain('Use this representation on Q')
    expect(texts(backOnP)).not.toContain('Use this representation on Q')
  })

  it('no suggestions when the assistant is unavailable; fixture phrasings while the mode is unknown', () => {
    expect(texts(D.sculpture, { assistant: CAP.unavailable, speech: SPEECH })).toEqual([])
    expect(phrasingMode(null)).toBe('synthetic')
    expect(phrasingMode({ assistant: null, speech: null })).toBe('synthetic')
    expect(phrasingMode({ assistant: CAP.live, speech: null })).toBe('live')
  })
})

describe('validity per experiment', () => {
  it('sculpture: the apply suggestion names the actual operation and needs one; the rebind targets the other group', () => {
    expect(texts(D.sculpture, live)).toEqual(['Apply +1', 'Use this representation on V₄', 'Explain this cycle'])
    expect(texts(states['sculpture after one apply']!, live)[0]).toBe('Apply +1 again')
    expect(texts(states['sculpture after one apply']!)[0]).toBe('Apply +1 again')
    // "again" only for the operation that was applied last: +2 was never applied.
    expect(texts(states['sculpture, +1 applied, +2 selected']!, live)[0]).toBe('Apply +2')
    expect(texts(states['sculpture, +1 applied, +2 selected']!)[0]).toBe('Apply +2')
    expect(texts(states['sculpture, +1 applied, nothing selected']!)[0]).toBe('Apply +1 again')
    const v4 = states['sculpture on V4']!
    const v4Applied = plan(v4, [{ kind: 'apply_element', experimentId: 'exp-v4', element: 'v10' }, { kind: 'select_item', experimentId: 'exp-v4', item: 'v01' }])
    expect(texts(v4Applied)[0]).toBe('Apply (0,1)')
    expect(texts(plan(v4Applied, [{ kind: 'select_item', experimentId: 'exp-v4', item: 'v10' }]))[0]).toBe('Apply (1,0) again')
    expect(ids(states['sculpture without selection']!)).not.toContain('sculpture.applyAgain')
    expect(texts(states['sculpture on V4']!, live)).toContain('Use this representation on C₄')
    expect(texts(states['sculpture on V4']!, live)[0]).toBe('Apply (1,0)')
    // The C4 -> V4 phrase only on C4 (the fixture refuses it on V4).
    expect(texts(states['sculpture on V4']!)).not.toContain('Use this representation on V₄')
  })

  it('P/Q: the fiber explanation only with a selected sample; Use on Q only before Q exists (synthetic)', () => {
    expect(texts(D.pq, live)).toContain('Explain the selected fiber')
    expect(texts(states['pq without selection']!, live)).not.toContain('Explain the selected fiber')
    expect(texts(D.pq)).toContain('Use this representation on Q')
    expect(texts(states['pq with Q created']!)).not.toContain('Use this representation on Q')
    expect(texts(states['pq with Q created']!, live)).toContain('Use this representation on P')
  })

  it('order: reverse a route that changes, and explain according to whether the results differ', () => {
    expect(texts(D.order, live)).toEqual(['Reverse the left branch', 'Explain why the results differ'])
    const equal = plan(D.order, [{ kind: 'set_branch', experimentId: 'exp-order', branchId: 'left', mapIds: ['map-s', 'map-r'] }])
    expect(texts(equal, live)).toContain('Explain why the results agree')
  })

  it('cube: the rearrangement explanation only after a rotation', () => {
    expect(ids(D.cube, live)).not.toContain('cube.explainDiagonals')
    expect(ids(states['cube after a rotation']!, live)).toContain('cube.explainDiagonals')
  })

  it('quotient: grouping first; compose only with A and a second rotation; six classes grouped or not', () => {
    expect(ids(D.quotient)).toEqual(['quotient.group', 'quotient.whySix'])
    expect(ids(D.quotient, live)).toEqual(['quotient.group', 'quotient.whySix'])
    expect(ids(states['quotient ungrouped with A and B']!)).toEqual(['quotient.group', 'quotient.compose', 'quotient.whySix'])
    expect(ids(states['quotient with A and B']!)).toContain('quotient.compose')
    expect(ids(states['quotient grouped, rotation selected']!)).not.toContain('quotient.compose')
    expect(texts(states['quotient grouped']!, live)).toContain('Why are there six classes?')
  })

  it('braids: the rewrite suggestion names a currently valid span and rule, or is absent', () => {
    const relation = suggestionsFor(panelInput(D.braid, { capability: live })).find((s) => s.id === 'braid.rewrite')!
    expect(relation.text).toBe('Apply the braid relation at crossings 1–3')
    const pair = suggestionsFor(panelInput(states['braid inverse pair']!, { capability: live })).find((s) => s.id === 'braid.rewrite')!
    expect(pair.text).toBe('Cancel the inverse pair at crossings 1–2')
    expect(suggestionsFor(panelInput(states['braid inverse pair']!)).find((s) => s.id === 'braid.rewrite')!.text).toBe('Cancel the inverse pair at crossings 1–2')
    // A selected crossing where no rule matches: no rewrite suggestion (displayed crossing 2 is index 1).
    const sel = plan(D.braid, [{ kind: 'select_item', experimentId: 'exp-braid', item: 'crossing:1' }])
    expect(ids(sel)).not.toContain('braid.rewrite')
    expect(availableRewrite([1, 2, 1], 1)).toBeNull()
    expect(availableRewrite([2, 1, 2, -2], null)).toEqual({ rule: 'braid_relation', at: 0 })
    expect(availableRewrite([1, 1], null)).toBeNull()
    expect(ids(plan(D.braid, [{ kind: 'set_braid', experimentId: 'exp-braid', target: 'word', word: [1, 1] }]))).not.toContain('braid.rewrite')
  })

  it('every experiment offers at least one usable suggestion by default, in both modes', () => {
    for (const kind of Object.keys(D) as DemoKind[]) {
      expect(texts(D[kind]).length, kind).toBeGreaterThan(0)
      expect(texts(D[kind], live).length, kind).toBeGreaterThan(0)
    }
  })
})
