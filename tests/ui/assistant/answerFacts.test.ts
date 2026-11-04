// The application-computed facts block beside an Ask Meta Muse AI answer about a reordered walk endpoint
// (LOCAL-SUBMISSION-META-STT-HANDOFF section 2, "Squared lengths"). Pure module tests plus the view, the XR
// layout and the desktop DOM. Every assistant state here is SYNTHETIC test data; every number in the block is
// recomputed by the app from the walk inputs the answer was scoped to.

import { describe, expect, it } from 'vitest'
import { type AnswerScope, type AssistantState, scopeSnapshot } from '../../../src/assistant/client'
import { answerFacts, factsForScope, reorderedEndpoint } from '../../../src/ui/assistant/answerFacts'
import { createAssistantDomContent } from '../../../src/ui/assistant/dom'
import { PANEL, layoutSpatial } from '../../../src/ui/assistant/spatialLayout'
import { assistantView } from '../../../src/ui/assistant/view'
import { caseActions, endpointActions, flipSignActions, lessonExperiment } from '../../../src/demo/proof'
import type { Doc, VectorWalkExperiment } from '../../../src/workspace/document'
import { FakeDoc } from './fakeDom'
import { docs, panelInput, plan, response } from './helpers'

const lesson = (d: Doc): VectorWalkExperiment => lessonExperiment(d)!
const proof = () => docs().proof
const at = (d: Doc, k: number) => plan(d, endpointActions(lesson(d), k))
const openTwo = (k: number) => {
  const d = plan(proof(), caseActions(lesson(proof()), 'open-two'))
  return at(d, k)
}

const scoped = (request: Doc, committed: Doc | null = null): AnswerScope => ({ request: scopeSnapshot(request), committed: committed && scopeSnapshot(committed) })
const answered = (scope: AnswerScope | undefined): AssistantState => ({ kind: 'answered', requestId: 'r1', prompt: 'Why is this endpoint inside?', response: response('meta'), ...(scope ? { scope } : {}) })
const applied = (scope: AnswerScope): AssistantState => ({ kind: 'applied', requestId: 'r1', prompt: 'Show W9', response: response('meta', 1), summary: ['Selected W₉'], sceneChangeMs: 30, scope })

const texts = (f: ReturnType<typeof factsForScope>) => f!.rows.map((r) => `${r.label}: ${r.text}`)

describe('answer facts (pure)', () => {
  it('hero W₉: the squared length is compared with R², the approximate length with R, and the bound is stated', () => {
    const d = at(proof(), 9)
    const f = factsForScope(scopeSnapshot(d), d)!
    expect(f).toMatchObject({ endpoint: 'W₉', k: 9, current: true, note: null, within: true, label: 'Computed by the app' })
    expect(f.detail).toMatch(/not from Meta Muse AI/)
    const [exact, length, bound] = f.rows
    expect(exact).toMatchObject({ label: 'Exact' })
    expect(exact!.text).toMatch(/^\|W₉\|² = 147\/25 ≤ 9 = R²$/)
    expect(length!.label).toBe('Length (approx.)')
    expect(length!.text).toMatch(/^\|W₉\| = √147\/5 ≈ 2\.425 ≤ 3 = R$/)
    expect(bound).toEqual({ label: 'Bound', text: 'R = (B + D)/2 = (5 + 1)/2 = 3' })
    // The squared value is never set against the length bound 3.
    expect(texts(f).join(' ')).not.toMatch(/147\/25 [≤>] 3\b/)
  })

  it('hero W₃: the positive-branch endpoint, same exact comparison', () => {
    const d = at(proof(), 3)
    const f = factsForScope(scopeSnapshot(d), d)!
    expect(f).toMatchObject({ endpoint: 'W₃', current: true, within: true })
    expect(f.rows[0]!.text).toMatch(/^\|W₃\|² = 147\/25 ≤ 9 = R²$/)
    expect(f.rows[1]!.text).toMatch(/^\|W₃\| = √147\/5 ≈ 2\.425 ≤ 3 = R$/)
  })

  it('open-two W₂ is outside: > in both comparisons, an exact length, and a proposed (not lemma) bound', () => {
    const d = openTwo(2)
    const f = factsForScope(scopeSnapshot(d), d)!
    expect(f).toMatchObject({ endpoint: 'W₂', current: true, within: false })
    expect(f.rows).toEqual([
      { label: 'Exact', text: expect.stringMatching(/^\|W₂\|² = 4 > 9\/4 = R²$/) },
      { label: 'Length', text: expect.stringMatching(/^\|W₂\| = 2 > 1\.5 = R$/) },
      { label: 'Proposed bound', text: 'R = (B + D)/2 = (2 + 1)/2 = 1.5' },
    ])
  })

  it('historical after a sign flip: the earlier numbers stay, labelled as for the earlier signs; current again when restored', () => {
    const before = at(proof(), 9)
    const flipped = plan(before, flipSignActions(lesson(before), 'v0'))
    const f = factsForScope(scopeSnapshot(before), flipped)!
    expect(f.current).toBe(false)
    expect(f.label).toBe('Computed by the app · historical')
    expect(f.note).toMatch(/^For the earlier signs/)
    expect(f.rows[0]!.text).toMatch(/147\/25 ≤ 9 = R²/) // the numbers of the input the answer was about
    // Flipping it back restores exactly that input: the block is current again.
    const restored = plan(flipped, flipSignActions(lesson(flipped), 'v0'))
    expect(factsForScope(scopeSnapshot(before), restored)).toMatchObject({ current: true, note: null })
  })

  it('historical after a different walk, a different endpoint or another experiment', () => {
    const before = at(proof(), 9)
    const other = plan(before, caseActions(lesson(before), 'line-six'))
    expect(factsForScope(scopeSnapshot(before), other)?.note).toMatch(/^For the earlier walk/)
    expect(factsForScope(scopeSnapshot(before), at(before, 3))?.note).toBe('For W₉, which is no longer selected.')
    const elsewhere = plan(before, [{ kind: 'select', experimentId: 'exp-p', sampleId: 's(1,0,1)' }])
    expect(factsForScope(scopeSnapshot(before), elsewhere)?.note).toBe('For W₉ of a walk that is no longer displayed.')
  })

  it('absent for anything that is not a reordered endpoint of a vector walk', () => {
    expect(reorderedEndpoint('walk:reordered:9')).toBe(9)
    expect(reorderedEndpoint('walk:source:9')).toBeNull()
    expect(reorderedEndpoint(null)).toBeNull()
    const pq = docs().pq
    expect(factsForScope(scopeSnapshot(pq), pq)).toBeNull()
    const noSelection = proof()
    expect(factsForScope(scopeSnapshot(noSelection), noSelection)).toBeNull()
    const source = plan(noSelection, [{ kind: 'select_item', experimentId: lesson(noSelection).id, item: 'walk:source:5' }])
    expect(factsForScope(scopeSnapshot(source), source)).toBeNull()
    // Results without a scope, and states that carry no answer.
    expect(answerFacts(answered(undefined), at(proof(), 9))).toBeNull()
    expect(answerFacts({ kind: 'error', requestId: 'r1', prompt: 'x', error: { code: 'network', message: 'down', retryable: true } }, at(proof(), 9))).toBeNull()
    expect(answerFacts({ kind: 'pending', requestId: 'r1', prompt: 'x', startedAt: 0 }, at(proof(), 9))).toBeNull()
  })

  it('an applied answer is scoped to its committed selection, not the selection it was asked from', () => {
    const w3 = at(proof(), 3)
    const w9 = at(w3, 9)
    expect(answerFacts(applied(scoped(w3, w9)), w9)).toMatchObject({ endpoint: 'W₉', current: true })
    // An answer that moved away from the endpoint is not about it: no block.
    const source = plan(w3, [{ kind: 'select_item', experimentId: lesson(w3).id, item: 'walk:source:5' }])
    expect(answerFacts(applied(scoped(w3, source)), source)).toBeNull()
    // An answer without a change is scoped to the selection when it was asked.
    expect(answerFacts(answered(scoped(w3)), w3)).toMatchObject({ endpoint: 'W₃', current: true })
  })
})

describe('answer facts in the panel', () => {
  const words = (s: unknown) => JSON.stringify(s)

  it('the view carries the block for answered, applied, stale and rejected results, and never for errors', () => {
    const d = at(proof(), 9)
    const scope = scoped(d)
    const base = { requestId: 'r1', prompt: 'Why is W9 inside?', response: response('meta') }
    const results: AssistantState[] = [
      { kind: 'answered', ...base, scope },
      { kind: 'applied', ...base, summary: ['x'], sceneChangeMs: 1, scope },
      { kind: 'stale', ...base, reason: 'the workspace changed while the request was running', scope },
      { kind: 'rejected', ...base, reason: 'history full', scope },
    ]
    for (const assistant of results) expect(assistantView(panelInput(d, { assistant })).exchange?.facts).toMatchObject({ endpoint: 'W₉', current: true })
    expect(assistantView(panelInput(d, { assistant: { kind: 'error', requestId: 'r1', prompt: 'x', error: { code: 'network', message: 'down', retryable: true } } })).exchange?.facts).toBeNull()
    // A non-walk answer has no block.
    expect(assistantView(panelInput(docs().pq, { assistant: answered(scoped(docs().pq)) })).exchange?.facts).toBeNull()
  })

  it('the block is labelled as computed by the app and claims nothing about the prose', () => {
    const d = at(proof(), 9)
    const v = assistantView(panelInput(d, { assistant: answered(scoped(d)) }))
    expect(v.exchange?.facts?.label).toBe('Computed by the app')
    expect(words(v.exchange?.facts)).not.toMatch(/verif|certif|prove|correct|checked/i)
  })

  it('XR: the facts lines sit between the explanation and the provenance, inside the panel; historical says so', () => {
    const measure = (t: string, em: number) => t.length * em * 0.5
    const d = at(proof(), 9)
    const v = assistantView(panelInput(d, { surface: 'xr', assistant: answered(scoped(d)) }))
    const lines = layoutSpatial(v, 0, measure).lines.map((l) => l.text)
    const head = lines.findIndex((t) => t.startsWith('Computed by the app · W₉'))
    expect(head).toBeGreaterThan(lines.findIndex((t) => t.startsWith('This applies')))
    expect(lines.slice(head, head + 4).join(' | ')).toMatch(/147\/25 ≤ 9 = R² \| Length \(approx\.\): \|W₉\| = √147\/5 ≈ 2\.425 ≤ 3 = R \| Bound: R = \(B \+ D\)\/2 = \(5 \+ 1\)\/2 = 3/)
    expect(lines.findIndex((t) => /Live Muse|muse-spark/.test(t))).toBeGreaterThan(head)
    const flipped = plan(d, flipSignActions(lesson(d), 'v0'))
    const h = layoutSpatial(assistantView(panelInput(flipped, { surface: 'xr', assistant: answered(scoped(d)) })), 0, measure).lines.map((l) => l.text)
    expect(h.some((t) => t.startsWith('Computed by the app · historical · W₉'))).toBe(true)
    expect(h.some((t) => t.startsWith('For the earlier signs'))).toBe(true)
  })

  it('XR: with a 700-character live explanation the facts block and the controls still fit inside the panel', () => {
    const measure = (t: string, em: number) => t.length * em * 0.5
    const d = at(proof(), 9)
    const long = response('meta')
    long.proposal = { ...long.proposal, explanation: 'Every arrow is used once in the new order and the endpoint is half the source prefix plus half the signed prefix. '.repeat(7).slice(0, 700) }
    const v = assistantView(panelInput(d, { surface: 'xr', assistant: { kind: 'answered', requestId: 'r1', prompt: 'Why is W9 inside?', response: long, scope: scoped(d) } }))
    const l = layoutSpatial(v, 0, measure)
    for (const t of l.lines) {
      expect(t.y).toBeGreaterThan(0)
      expect(t.y).toBeLessThan(PANEL.height)
      expect(t.x + measure(t.text, t.em)).toBeLessThanOrEqual(PANEL.width + 1e-9)
    }
    for (const b of l.buttons) expect(b.y + b.h).toBeLessThanOrEqual(PANEL.height + 1e-9)
    // The facts are never the part that is shortened.
    expect(l.lines.map((t) => t.text).join(' | ')).toMatch(/\|W₉\|² = 147\/25 ≤ 9 = R²/)
    expect(l.lines.some((t) => t.text.startsWith('Bound: R = (B + D)/2'))).toBe(true)
  })

  it('desktop: a facts section after the explanation, marked current or historical, re-rendered when the walk changes', () => {
    const fake = new FakeDoc()
    const container = fake.createElement('div')
    const content = createAssistantDomContent(() => {})
    content.mount(container as unknown as HTMLElement)
    const d = at(proof(), 9)
    content.render(panelInput(d, { assistant: answered(scoped(d)) }))
    const box = container.find('data-assistant', 'facts')
    expect(box.getAttribute('data-current')).toBe('true')
    expect(box.textContent).toContain('Computed by the app')
    expect(box.textContent).toMatch(/\|W₉\|² = 147\/25 ≤ 9 = R²/)
    expect(box.textContent).toMatch(/√147\/5 ≈ 2\.425 ≤ 3 = R/)
    expect(box.all('data-assistant', 'facts-historical')).toHaveLength(0)
    const exchange = container.find('data-assistant', 'exchange')
    const order = exchange.children.map((c) => c.className)
    expect(order.indexOf('mwa-facts')).toBe(order.indexOf('mwa-expl') + 1)
    // The same answer after a sign flip: historical, never silently current.
    content.render(panelInput(plan(d, flipSignActions(lesson(d), 'v0')), { assistant: answered(scoped(d)) }))
    const again = container.find('data-assistant', 'facts')
    expect(again.getAttribute('data-current')).toBe('false')
    expect(again.find('data-assistant', 'facts-historical').textContent).toMatch(/^For the earlier signs/)
    content.dispose()
  })
})
