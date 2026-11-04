// The proof lesson on the LIVE path with a MOCKED fetch: every provider reply here is SYNTHETIC (shaped like
// the documented Response object, never recorded from a live call). It checks what Muse would receive (the
// developer instructions, the exact walk facts, the curated lesson context and the planned templates) and
// that its output takes the same validation as everything else. Live Meta verification is PENDING (no key).

import { describe, expect, it } from 'vitest'
import { type Doc, demoDocument } from '../../src/workspace/document'
import { planTransaction } from '../../src/workspace/reducer'
import type { AssistantResponse } from '../../src/workspace/actions'
import { caseActions, lessonExperiment, proofActions } from '../../src/demo/proof'
import { LESSON_SOURCE } from '../../src/lessons/steinitz/source'
import { createAssistantRoute } from '../../server/muse/index'
import { newStatus } from '../../server/muse/config'
import { INSTRUCTIONS } from '../../server/muse/prompt'
import { preparedTemplates } from '../../server/muse/order'
import { fourTemplates } from '../../server/muse/four'
import { walkTemplates } from '../../server/muse/walk'
import type { ApiResult } from '../../server/types'
import { LIVE_ENV, SYNTHETIC_KEY, apiRequest, assistantRequest, mockFetch, syntheticProposal, syntheticReply } from './helpers'

const plan = (doc: Doc, actions: unknown[]) => planTransaction(doc, actions).doc
const PQ = demoDocument()
const HERO = plan(PQ, proofActions(PQ))
const E = lessonExperiment(HERO)!
const K3 = plan(HERO, [{ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:3' }])
const OPEN = plan(HERO, caseActions(E, 'open-two'))

type Ctx = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function live(prompt: string, doc: Doc, ...replies: Response[]) {
  const m = mockFetch(...replies)
  const route = createAssistantRoute({ env: LIVE_ENV, fetchImpl: m.fetchImpl, status: newStatus(), minRepairMs: 0 })
  const res: ApiResult = await route(apiRequest(assistantRequest(prompt, doc)))
  const input = m.calls[0]!.body.input as { content: { text: string }[] }[]
  const ctx = JSON.parse(input[0]!.content[1]!.text.replace(/^[^\n]*\n/, '')) as Ctx
  for (const c of m.calls) expect(JSON.stringify(c.body)).not.toContain(SYNTHETIC_KEY)
  return { res, ctx, calls: m.calls, input }
}

describe('live input for the proof lesson (synthetic mock)', () => {
  it('carries the lesson instructions, the exact walk facts for the selected point and the curated source context', async () => {
    const { ctx, calls, input } = await live('Why is this point inside the bound?', K3, syntheticReply(syntheticProposal([])))
    expect(calls[0]!.body.instructions).toBe(INSTRUCTIONS)
    expect(INSTRUCTIONS).toContain('THE PROOF LESSON')
    expect(INSTRUCTIONS).toContain('never say you found the signs')
    expect(INSTRUCTIONS).toContain('never measured or maximum distances')
    // Display labels in prose, IDs in actions; a plain-language lead before the arithmetic; the precise branch rule.
    expect(INSTRUCTIONS).toContain('the walk fact lists each arrow as its ID followed by the label the scene shows, for example "v4 (c₁)"')
    expect(INSTRUCTIONS).toContain('In explanations name arrows by that display label (c₁, −a₂) and points as the scene writes them (W₃, U₅, S₅); write an ID only inside actions and items')
    expect(INSTRUCTIONS).toContain("never derive an ID from a label's letters or position")
    expect(INSTRUCTIONS).toContain('Lead every proof-lesson explanation with one short sentence in everyday words (what the step or point shows, without formulas), then give the exact arithmetic from the facts.')
    expect(INSTRUCTIONS).toContain('the positive identity and its bound need no zero total, while on a walk that does not return home the lemma as a whole still does not apply')
    // The earlier grounding lines are kept.
    for (const line of ['Keep squared lengths and lengths apart', 'Describe the workspace as it will be after the proposal applies', 'credit the source\'s authors', 'never title or phrase the answer as a Lean check result', 'Follow the braid fact\'s verdict']) expect(INSTRUCTIONS).toContain(line)
    expect(input[0]!.content[0]!.text).toBe('Learner request:\nWhy is this point inside the bound?')
    expect(ctx.displayedExperiment).toBe(E.id)
    expect(ctx.selectedItem).toBe('walk:reordered:3')
    const facts = ctx.facts as { id: string; kind: string; text: string }[]
    expect(facts.map((f) => f.kind)).toEqual(expect.arrayContaining(['walk', 'walk_bounds', 'walk_order', 'walk_lemma', 'walk_endpoints', 'walk_selection']))
    const selFact = facts.find((f) => f.id === `walk_selection:${E.id}`)!.text
    expect(selFact).toContain('positive branch; witness j = 5')
    expect(selFact).toContain('W_3 = P_5 = (U_5 + S_5)/2')
    expect(selFact).toContain('exactly |W_3|² = 147/25 ≤ R² = 9')
    // Arrow names: the scene's display labels beside the persistent IDs, in the facts the model receives.
    expect(selFact).toContain('the + arrows among the first 5 source steps (v0 (a₁) v2 (b₁) v4 (c₁))')
    const walkFact = facts.find((f) => f.id === `walk:${E.id}`)!.text
    expect(walkFact).toContain('v4 (c₁) = (4/5, 0, 3/5) sign +')
    expect(walkFact).toContain('actions and selection items use the ID')
    expect(facts.find((f) => f.id === `walk_order:${E.id}`)!.text).toContain('v0 (a₁) v2 (b₁) v4 (c₁) v6 (−a₁) v8 (−b₁) v10 (−c₁) | v11 (−c₂)')
    const lesson = ctx.proofLesson
    expect(lesson.displayed).toBe(true)
    expect(lesson.case).toBe('hero')
    expect(lesson.lesson).toMatchObject({ declaration: LESSON_SOURCE.declaration.name, commit: LESSON_SOURCE.commit, statement: LESSON_SOURCE.declaration.role, coverage: LESSON_SOURCE.coverageLine, minimality: LESSON_SOURCE.minimality })
    expect(lesson.lesson.framing).toMatch(/prepared interactive explanation/)
    expect(lesson.templates).toEqual(JSON.parse(JSON.stringify(walkTemplates(K3))))
    expect(lesson.templates.whyThisPoint).toEqual({ actions: [{ kind: 'show_walk_stage', experimentId: E.id, stage: 'why' }] })
    expect(lesson.templates.otherHalf.actions[0]).toEqual({ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:9' })
    expect(lesson.templates.checkExample).toEqual({ actions: [{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: E.id } }] })
    // Curated context only, not upstream repository text: no Lean source, no `sorry` challenge file.
    expect(JSON.stringify(lesson)).not.toMatch(/theorem signedOrder_prefix_bound|:= by|sorry/)
    // The earlier prepared block is unchanged.
    expect(ctx.prepared).toEqual(JSON.parse(JSON.stringify({ ...preparedTemplates(K3), four: fourTemplates(K3) })))
  })

  it('a verbatim template reply validates as source "meta"; a check on the open walk is rejected twice, never applied', async () => {
    const tpl = walkTemplates(K3).whyThisPoint as { actions: unknown[] }
    const { res } = await live('Why is this point inside the bound?', K3, syntheticReply(syntheticProposal(tpl.actions)))
    expect(res.status).toBe(200)
    const j = res.json as AssistantResponse
    expect([j.source, j.proposal.actions]).toEqual(['meta', tpl.actions])

    const check = [{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: E.id } }]
    const open = await live('Check this example', OPEN, syntheticReply(syntheticProposal(check)), syntheticReply(syntheticProposal(check)))
    expect(open.ctx.proofLesson.templates.checkExample).toMatchObject({ unavailable: expect.stringMatching(/does not return to its start/) })
    expect((open.ctx.facts as { id: string; text: string }[]).find((f) => f.id === `walk_lemma:${E.id}`)!.text).toContain('2 exceeds 1.5')
    expect(open.calls).toHaveLength(2)
    expect(JSON.stringify(open.calls[1]!.body.input)).toContain('does not return to its start')
    expect(open.res.status).toBe(422)
    expect((open.res.json as { code: string }).code).toBe('proposal_rejected')
  })

  it('without a displayed lesson: provenance and the two opening templates only', async () => {
    const { ctx } = await live('Show me a step from an AI-produced proof', PQ, syntheticReply(syntheticProposal([])))
    expect(ctx.proofLesson.displayed).toBe(false)
    expect(ctx.proofLesson.source.declaration).toBe(LESSON_SOURCE.declaration.name)
    expect(Object.keys(ctx.proofLesson.templates)).toEqual(['openLesson', 'counterexample'])
    expect(ctx.proofLesson.templates.openLesson.actions.map((a: { kind: string }) => a.kind)).toEqual(['save_recipe', 'create_vector_walk', 'bind_recipe', 'show_walk_stage'])
    expect(ctx.proofLesson.lesson).toBeUndefined()
    expect((ctx.facts as { kind: string }[]).some((f) => f.kind.startsWith('walk'))).toBe(false)
  })
})
