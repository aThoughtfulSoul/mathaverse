// The proof lesson with Ask Meta Muse AI (PROOF-EXPLORER-SPEC section 6) in SYNTHETIC mode: exact walk facts
// in the assistant context, the labelled synthetic fixtures (prepared examples, NOT Muse output) on the
// hero, an edited-signs hero, the simpler line-six case and the open two-arrow counterexample, schema and
// planner validation, the synthetic route, stale-context rejection after a case change, and the
// suggestions of the proof lesson answered by these fixtures. No provider call is made here.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeFacts } from '../../src/workspace/context'
import { type Doc, demoDocument, walkInputOf } from '../../src/workspace/document'
import { Workspace, planTransaction } from '../../src/workspace/reducer'
import { type AssistantResponse, parseProposal } from '../../src/workspace/actions'
import { deriveWalk, walkItemText } from '../../src/algebra/walk'
import { CASES, arrowNames } from '../../src/lessons/steinitz/cases'
import { caseActions, lessonExperiment, proofActions } from '../../src/demo/proof'
import { AssistantClient } from '../../src/assistant/client'
import type { App } from '../../src/app'
import { createAssistantRoute } from '../../server/muse/index'
import { FIXTURES, matchFixture, normalizePrompt } from '../../server/muse/synthetic'
import { WALK_FIXTURES, namedArrow, namedEndpoint } from '../../server/muse/walkSynthetic'
import { checkTemplate, walkTemplates } from '../../server/muse/walk'
import { proposalSchema } from '../../server/muse/schema'
import { validateProposal } from '../../server/muse/validate'
import { suggestionsFor } from '../../src/ui/assistant/suggestions'
import type { ApiResult } from '../../server/types'
import { apiRequest, assistantRequest, schemaError } from './helpers'
import { CAP, SPEECH, panelInput } from '../ui/assistant/helpers'

const plan = (doc: Doc, actions: unknown[]) => planTransaction(doc, actions).doc
const PQ = demoDocument()
const HERO = plan(PQ, proofActions(PQ))
const E = lessonExperiment(HERO)!
const sel = (doc: Doc, item: string | null) => plan(doc, [{ kind: 'select_item', experimentId: E.id, item }])
const EDITED = plan(HERO, [{ kind: 'set_walk_signs', experimentId: E.id, signs: [{ id: 'v1', sign: 1 }] }])
const LINE = plan(HERO, caseActions(E, 'line-six'))
const OPEN = plan(HERO, caseActions(E, 'open-two'))
const ALLPOS = plan(HERO, caseActions(E, 'all-positive'))

const DOCS: Record<string, Doc> = {
  'demo (no lesson)': PQ,
  hero: HERO,
  'hero, W3 selected': sel(HERO, 'walk:reordered:3'),
  'hero, W9 selected': sel(HERO, 'walk:reordered:9'),
  'hero, arrow v4 selected': sel(HERO, 'walk:vector:v4'),
  'hero, U5 selected': sel(HERO, 'walk:source:5'),
  'hero, S5 selected': sel(HERO, 'walk:signed:5'),
  'edited signs': EDITED,
  'all positive': ALLPOS,
  'line-six': LINE,
  'open-two': OPEN,
  'open-two, W2 selected': sel(OPEN, 'walk:reordered:2'),
}

const route = createAssistantRoute({ env: {} })
const ok = (r: ApiResult) => {
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as AssistantResponse
}
const ask = async (prompt: string, doc: Doc) => ok(await route(apiRequest(assistantRequest(prompt, doc))))
const fact = (doc: Doc, id: string) => computeFacts(doc).find((f) => f.id === id)?.text ?? ''
const walkFacts = (doc: Doc) => computeFacts(doc).filter((f) => f.kind.startsWith('walk'))

afterEach(() => vi.unstubAllGlobals())

describe('exact vector-walk facts in the assistant context', () => {
  it('k = 3 on the hero: positive branch, witness j = 5, exact identity and squared-norm chain', () => {
    const t = fact(sel(HERO, 'walk:reordered:3'), `walk_selection:${E.id}`)
    const w = deriveWalk(CASES.hero.input).witnesses[3]!
    expect([w.j, w.branch]).toEqual([5, 'positive'])
    for (const s of [
      'selected W_3 = (7/5, 7/5, 7/5)', 'positive branch; witness j = 5', '(v0 (a₁) v2 (b₁) v4 (c₁))', 'W_3 = P_5 = (U_5 + S_5)/2',
      'U_5 = (2, 14/5, 11/5)', 'S_5 = (4/5, 0, 3/5)', 'U_5/2 = (1, 7/5, 11/10) then S_5/2 = (2/5, 0, 3/10)',
      '|U_5|² = 417/25 ≤ B² = 25', '|S_5|² = 1 ≤ D² = 1', '≤ (B + D)/2 = 3', 'exactly |W_3|² = 147/25 ≤ R² = 9',
    ]) expect(t).toContain(s)
  })

  it('k = 9 on the hero: negative branch, witness j = 6, T dropped only because the walk is closed', () => {
    const t = fact(sel(HERO, 'walk:reordered:9'), `walk_selection:${E.id}`)
    const w = deriveWalk(CASES.hero.input).witnesses[9]!
    expect([w.j, w.branch]).toEqual([6, 'negative'])
    for (const s of [
      'selected W_9 = (-7/5, -7/5, -7/5)', 'negative branch; witness j = 6', '(v1 (a₂) v3 (b₂) v5 (c₂))', 'W_9 = T − M_6 = T + (S_6 − U_6)/2',
      'T = 0 gives W_9 = (S_6 − U_6)/2', 'S_6 = (0, 0, 0), U_6 = (14/5, 14/5, 14/5)', '−U_6/2 = (-7/5, -7/5, -7/5)',
      '|S_6|² = 0 ≤ D² = 1', '|U_6|² = 588/25 ≤ B² = 25', 'exactly |W_9|² = 147/25 ≤ R² = 9',
    ]) expect(t).toContain(s)
  })

  it('walk, bounds (labelled as bounds), actual peaks, order, applicability and representative endpoints', () => {
    expect(fact(HERO, `walk:${E.id}`)).toMatch(/12 arrows in 3D, prepared case "hero".*v1 \(a₂\) = \(3\/5, 4\/5, 0\) sign −.*total T = \(0, 0, 0\): the walk returns to its start \(closed\)/)
    const b = fact(HERO, `walk_bounds:${E.id}`)
    for (const s of ['not measured distances', 'source bound B = 5', 'signed bound D = 1', 'new bound R = (B + D)/2 = 3', '|U_6|² = 588/25 (|U_6| ≈4.850)', '|W_3|² = 147/25 (|W_3| ≈2.425)', 'new bound 3 is smaller than source bound 5 (a better bound)']) expect(b).toContain(s)
    expect(fact(HERO, `walk_order:${E.id}`)).toContain('v0 (a₁) v2 (b₁) v4 (c₁) v6 (−a₁) v8 (−b₁) v10 (−c₁) | v11 (−c₂) v9 (−b₂) v7 (−a₂) v5 (c₂) v3 (b₂) v1 (a₂)')
    expect(fact(HERO, `walk_order:${E.id}`)).toContain('source positions [0,2,4,6,8,10,11,9,7,5,3,1]')
    expect(fact(HERO, `walk_lemma:${E.id}`)).toContain('the lemma signedOrder_prefix_bound applies')
    expect(fact(HERO, `walk_endpoints:${E.id}`)).toBe(`${E.id} representative endpoints: positive branch W_3 (witness j = 5); negative branch W_9 (witness j = 6)`)
    expect(fact(ALLPOS, `walk_bounds:${E.id}`)).toContain('new bound 5 equals source bound 5 (valid, no improvement from these signs)')
    expect(fact(ALLPOS, `walk_endpoints:${E.id}`)).toContain('no negative branch (no − arrows)')
    expect(fact(EDITED, `walk:${E.id}`)).toContain('the hero arrows with edited signs')
    for (const d of Object.values(DOCS)) for (const f of walkFacts(d)) expect(f.text).not.toMatch(/maximum distance|measured distance of/i)
  })

  it('the open walk: not closed, the lemma does not apply, the exact first failure and the kept residual T', () => {
    expect(fact(OPEN, `walk:${E.id}`)).toContain('total T = (2, 0, 0): the walk does NOT return to its start')
    const l = fact(OPEN, `walk_lemma:${E.id}`)
    for (const s of ['does NOT apply', 'fails first at k = 2', '|W_2|² = 4 > R² = 9/4 (2 exceeds 1.5)', 'W_2 = T + (S_0 − U_0)/2 = (2, 0, 0)', 'dropping T would wrongly give (0, 0, 0)', 'not to the published theorem']) expect(l).toContain(s)
    expect(fact(OPEN, `walk_bounds:${E.id}`)).toContain('proposed bound R = (B + D)/2 = 1.5')
    expect(fact(OPEN, `walk_bounds:${E.id}`)).toContain('is not a valid bound here')
    expect(fact(sel(OPEN, 'walk:reordered:2'), `walk_selection:${E.id}`)).toContain('T = (2, 0, 0) not zero, so T cannot be dropped')
  })

  it('source, signed and arrow selections have their own exact facts', () => {
    expect(fact(sel(HERO, 'walk:source:5'), `walk_selection:${E.id}`)).toContain('U_5 = (2, 14/5, 11/5) (after 5 of 12 source steps): |U_5|² = 417/25 ≤ B² = 25')
    expect(fact(sel(HERO, 'walk:signed:5'), `walk_selection:${E.id}`)).toContain('S_5 = (4/5, 0, 3/5) (auxiliary signed walk after 5 steps; signed copies, not the original arrows): |S_5|² = 1 ≤ D² = 1')
    const v = fact(sel(HERO, 'walk:vector:v4'), `walk_selection:${E.id}`)
    expect(v).toContain('selected arrow v4 (c₁) = (4/5, 0, 3/5): source step 5 of 12 (from U_4 to U_5), sign +, |c₁|² = 1')
    expect(v).toContain('in the new order it is step 3 (from W_2 to W_3)')
    expect(fact(HERO, `walk_selection:${E.id}`)).toBe('')
  })
})

describe('arrow names in the facts: the scene\'s labels beside the persistent IDs', () => {
  it('the hero (and the hero with edited signs or order) pairs every ID with its scene label; the ID stays the identity', () => {
    const walk = fact(HERO, `walk:${E.id}`)
    expect(walk).toContain('each arrow is its ID followed by the label the scene shows, in parentheses (a display label only: actions and selection items use the ID, for example walk:vector:v0)')
    const names = arrowNames(walkInputOf(E))
    for (const v of E.vectors) expect(walk).toContain(`${v.id} (${names.get(v.id)}) = `)
    expect(fact(EDITED, `walk:${E.id}`)).toContain('v1 (a₂) = (3/5, 4/5, 0) sign +')
    // A changed source order keeps each name with its occurrence (names follow identity, not position).
    const reversed = plan(HERO, [{ kind: 'set_walk_order', experimentId: E.id, order: [...E.order].reverse() }])
    expect(fact(reversed, `walk:${E.id}`)).toContain('in parentheses (a display label only: actions and selection items use the ID, for example walk:vector:v11)): v11 (−c₂) = (-4/5, 0, -3/5) sign −, v10 (−c₁) = ')
    // The selection item and the refs carry only IDs.
    expect(computeFacts(sel(HERO, 'walk:vector:v4')).find((f) => f.id === `walk_selection:${E.id}`)!.refs).toEqual([E.id, 'walk:vector:v4'])
    expect(computeFacts(HERO).find((f) => f.id === `walk_order:${E.id}`)!.refs.every((r) => !r.includes('('))).toBe(true)
  })

  it('walks whose scene labels are their IDs get no invented names', () => {
    for (const doc of [LINE, OPEN]) {
      const walk = fact(doc, `walk:${E.id}`)
      expect(walk).toContain('the scene labels these arrows by their IDs')
      expect(walk).not.toMatch(/v\d+ \(/)
      expect(fact(doc, `walk_order:${E.id}`)).not.toMatch(/v\d+ \(/)
    }
    expect(fact(LINE, `walk_order:${E.id}`)).toContain('v0 v2 v3 v5 | v4 v1')
    expect(fact(sel(LINE, 'walk:vector:v0'), `walk_selection:${E.id}`)).toContain('selected arrow v0 = (1, 0, 0)')
    // Custom IDs that look like hero labels stay IDs: nothing is parsed out of a label.
    const ids = plan(HERO, [{ kind: 'set_vector_walk', experimentId: E.id, dimension: 3, vectors: [{ id: 'c1', coords: [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }] }, { id: 'a2', coords: [{ n: '-1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }] }], order: ['c1', 'a2'], signs: [1, -1] }])
    expect(fact(ids, `walk:${E.id}`)).toContain('c1 = (1, 0, 0) sign +, a2 = (-1, 0, 0) sign −')
  })
})

describe('fixture matching (typed and spoken phrasings)', () => {
  it.each([
    ['Show me a step from an AI-produced proof', 'proof-open'], ['show me a step from an A.I. produced proof', 'proof-open'], ['Okay, show me a step from an AI generated proof', 'proof-open'],
    ['Why does returning home not keep it close?', 'proof-why-not-close'], ["why doesn't returning home keep it close", 'proof-why-not-close'],
    ['Show the sign trick', 'proof-sign-trick'], ['can you show me the sign trick', 'proof-sign-trick'], ['what is the signing trick', 'proof-sign-trick'],
    ['Rearrange the same arrows', 'proof-rearrange'], ['rearrange these arrows', 'proof-rearrange'], ['Rearrange the arrows.', 'proof-rearrange'],
    ['Why is this point inside the bound?', 'proof-why-point'], ['why is W3 inside the bound', 'proof-why-point'], ['Why is W 3 inside the bound', 'proof-why-point'], ['why is w three inside the new bound', 'proof-why-point'], ['why is this point within the bound', 'proof-why-point'],
    ['Show the other half of the argument', 'proof-other-half'], ['show me the other half', 'proof-other-half'], ['show the negative branch', 'proof-other-half'],
    ['Flip this sign', 'proof-flip-sign'], ['flip the sign of v4', 'proof-flip-sign'], ['Flip the sign of V 4.', 'proof-flip-sign'],
    ['Flip the sign of c₁', 'proof-flip-sign'], ['flip minus a two', 'proof-flip-sign'], ['change the sign of b 2', 'proof-flip-sign'], ['Flip −c₂.', 'proof-flip-sign'],
    ['Make all signs positive', 'proof-all-positive'], ['make all the signs plus', 'proof-all-positive'],
    ['Why must the arrows return home?', 'proof-return-home'], ['why must these arrows return home', 'proof-return-home'], ['why do the arrows have to come back home', 'proof-return-home'], ['Show the counterexample', 'proof-return-home'],
    ['Restore the closed walk', 'proof-restore'], ['go back to the closed walk', 'proof-restore'],
    ['Why does the bound fail here?', 'proof-why-fails'], ["why doesn't the bound hold here", 'proof-why-fails'],
    ['Check this example', 'proof-check'], ['could you check this example please', 'proof-check'], ['check it in lean', 'proof-check'],
    ['Does this prove the whole theorem?', 'proof-whole-theorem'], ['is this the whole proof', 'proof-whole-theorem'],
    ['Restore the prepared signs', 'proof-restore-signs'], ['Show the simpler example', 'proof-simpler'],
  ])('"%s" -> %s', (prompt, name) => {
    expect(matchFixture(prompt)?.name).toBe(name)
  })

  it('the earlier fixtures keep their phrasings', () => {
    expect(matchFixture('Check that these two maps differ')?.name).toBe('check-maps-differ')
    expect(matchFixture('Reverse the order on the left')?.name).toBe('reverse-left')
    expect(matchFixture('Show the other side of the braid relation')?.name).toBe('other-side')
  })

  it('reads a named endpoint or arrow from a transcript, never a stray letter', () => {
    expect([namedEndpoint('why is w3 inside the bound'), namedEndpoint('why is w 3 inside'), namedEndpoint('why is w-9 inside'), namedEndpoint('why is w three inside'), namedEndpoint('why is this point inside the bound')]).toEqual([3, 3, 9, 3, null])
    expect([namedArrow('flip the sign of v4'), namedArrow('flip the sign of v 11'), namedArrow('flip this sign')]).toEqual(['v4', 'v11', null])
    // The scene's names on the hero: a₁ a₂ b₁ b₂ c₁ c₂ −a₁ −a₂ −b₁ −b₂ −c₁ −c₂ for v0 … v11.
    const names = arrowNames(walkInputOf(E))
    expect([...names.values()]).toEqual(['a₁', 'a₂', 'b₁', 'b₂', 'c₁', 'c₂', '−a₁', '−a₂', '−b₁', '−b₂', '−c₁', '−c₂'])
    const named = (p: string) => namedArrow(normalizePrompt(p), names)
    expect([named('Flip the sign of c₁'), named('flip the sign of c1'), named('Flip the sign of −a₂'), named('flip minus a two'), named('flip the sign of b 1'), named('flip the sign of v4'), named('flip this sign')]).toEqual(['v4', 'v4', 'v7', 'v7', 'v2', 'v4', null])
    // A name the walk does not have comes back as written, never as the selected arrow.
    expect([named('flip the sign of a3'), namedArrow('flip the sign of c1', arrowNames(walkInputOf(lessonExperiment(LINE)!)))]).toEqual(['a₃', 'c₁'])
  })
})

describe('every walk fixture plans on every lesson document and fits the strict schema', () => {
  for (const [label, doc] of Object.entries(DOCS)) {
    it(label, () => {
      const schema = proposalSchema(doc)
      for (const f of WALK_FIXTURES) {
        for (const prompt of [undefined, normalizePrompt(f.example)]) {
          const p = f.build(doc, prompt)
          const where = `${f.name} on ${label}`
          expect(schemaError(schema, p), where).toBeNull()
          const v = validateProposal(p, doc)
          expect(v.ok, `${where}: ${v.ok ? '' : v.message}`).toBe(true)
          expect(p.title.length, where).toBeLessThanOrEqual(80)
          expect(p.explanation.length, where).toBeGreaterThan(0)
          expect(p.explanation.length, where).toBeLessThanOrEqual(700)
          expect(p.explanation, where).not.toMatch(/maximum distance|\bI (found|discovered|proved|invented)\b|Muse (found|discovered|proved|invented)/i)
        }
      }
    })
  }

  it('the walk fixtures are registered after the earlier ones, with unique names', () => {
    const names = FIXTURES.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
    for (const f of WALK_FIXTURES) expect(names).toContain(f.name)
    for (const f of WALK_FIXTURES) expect(matchFixture(f.example)?.name, f.example).toBe(f.name)
  })
})

describe('the supported conversation through the synthetic route (labelled synthetic, not Muse output)', () => {
  it('opens the lesson with provenance, described as a prepared interactive explanation', async () => {
    const j = await ask('Show me a step from an AI-produced proof', PQ)
    expect([j.source, j.model]).toEqual(['synthetic', 'synthetic:proof-open'])
    expect(j.proposal.actions.map((a) => a.kind)).toEqual(['save_recipe', 'create_vector_walk', 'bind_recipe', 'show_walk_stage'])
    expect(j.proposal.explanation).toContain('prepared interactive explanation')
    expect(j.proposal.explanation).toContain('OAI.EuclideanSteinitzBergstrom.signedOrder_prefix_bound (commit 4eaee875)')
    expect(j.proposal.explanation).toContain('not a new AI-invented lemma')
    expect(j.proposal.explanation).toContain('source bound 5, signed bound 1, new bound 3 (bounds, not measured distances)')
    const ws = new Workspace(PQ)
    ws.commit({ baseRevision: j.baseRevision, actions: j.proposal.actions })
    expect(ws.current.selection.experimentId).toBe('exp-walk')
  })

  it('"Why is this point inside the bound?" with nothing selected selects the prepared W3 and says so', async () => {
    const j = await ask('Why is this point inside the bound?', HERO)
    expect(j.model).toBe('synthetic:proof-why-point')
    expect(j.proposal.actions).toEqual([{ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:3' }, { kind: 'show_walk_stage', experimentId: E.id, stage: 'why' }])
    for (const s of ['No endpoint was selected, so this selects the prepared example W₃', 'W₃ = (7/5, 7/5, 7/5)', '(a₁ b₁ c₁)', 'W₃ = (U₅ + S₅)/2', 'U₅ = (2, 14/5, 11/5)', 'S₅ = (4/5, 0, 3/5)', '|U₅|² = 417/25 ≤ 25', '(5 + 1)/2 = 3', '|W₃|² = 147/25 ≤ 9']) expect(j.proposal.explanation).toContain(s)
  })

  it('uses the persisted selection, never another point: W9 stays W9; an arrow or a source point gets a clarifying answer', async () => {
    const j = await ask('Why is this point inside the bound?', sel(HERO, 'walk:reordered:9'))
    expect(j.proposal.actions).toEqual([{ kind: 'show_walk_stage', experimentId: E.id, stage: 'why' }])
    for (const s of ['W₉ = (-7/5, -7/5, -7/5)', '(a₂ b₂ c₂)', 'W₉ = (S₆ − U₆)/2', 'U₆ = (14/5, 14/5, 14/5)', '|U₆|² = 588/25 ≤ 25', '|W₉|² = 147/25 ≤ 9']) expect(j.proposal.explanation).toContain(s)
    // One plain-language sentence leads, before any arithmetic (the lesson's WHY_LEAD, as the panel shows it).
    expect(j.proposal.explanation).toMatch(/^Two half-sized arrows, one from each old walk, land exactly on W₉, so it is no farther from home than half the two bounds combined\. W₉ = /)
    const openW2 = await ask('Why is this point inside the bound?', sel(OPEN, 'walk:reordered:2'))
    expect(openW2.proposal.title).toBe('Why W₂ is outside the bound')
    expect(openW2.proposal.explanation).toMatch(/^The walk does not return home, so a leftover total stays in the formula for W₂: the two half-sized arrows alone do not reach it\. /)
    const openW1 = await ask('Why is this point inside the bound?', sel(OPEN, 'walk:reordered:1'))
    expect(openW1.proposal.explanation).toContain('This identity and its bound need no zero total; the walk does not return home, though, so the lemma as a whole does not apply.')
    const arrow = await ask('Why is this point inside the bound?', sel(HERO, 'walk:vector:v4'))
    expect(arrow.proposal.actions).toEqual([])
    expect(arrow.proposal.explanation).toMatch(/An arrow \(c₁\) is selected, not a point.*Which point/)
    const source = await ask('Why is this point inside the bound?', sel(HERO, 'walk:source:5'))
    expect(source.proposal.actions).toEqual([])
    expect(source.proposal.explanation).toContain('source point U₅ = (2, 14/5, 11/5): |U₅|² = 417/25 ≤ 25')
    // A named endpoint in a voice transcript is explicit.
    const named = await ask('why is w 9 inside the bound', sel(HERO, 'walk:reordered:3'))
    expect(named.proposal.actions[0]).toEqual({ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:9' })
  })

  it('"Show the other half of the argument": W9 on the hero, a derived endpoint elsewhere, honest without − arrows', async () => {
    const j = await ask('Show the other half of the argument', HERO)
    expect(j.model).toBe('synthetic:proof-other-half')
    expect(j.proposal.actions[0]).toEqual({ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:9' })
    expect(j.proposal.explanation).toContain('W₉ = (S₆ − U₆)/2')
    const line = await ask('Show the other half of the argument', LINE)
    expect(line.proposal.actions[0]).toEqual({ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:5' })
    expect(deriveWalk(CASES['line-six'].input).witnesses[5]!.branch).toBe('negative')
    expect(line.proposal.explanation).toContain('W₅ = (-1, 0, 0)')
    const none = await ask('Show the other half of the argument', ALLPOS)
    expect(none.proposal.actions).toEqual([])
    expect(none.proposal.explanation).toContain('This walk has no − arrows, so there is no − half')
  })

  it('"Flip this sign" needs a selected arrow; the edit recomputes and states that bounds can get better, stay or worsen', async () => {
    const none = await ask('Flip this sign', HERO)
    expect(none.proposal.actions).toEqual([])
    expect(none.proposal.explanation).toMatch(/^Which arrow\?/)
    const j = await ask('Flip this sign', sel(HERO, 'walk:vector:v4'))
    expect(j.model).toBe('synthetic:proof-flip-sign')
    expect(j.proposal.actions).toEqual([{ kind: 'set_walk_signs', experimentId: E.id, signs: [{ id: 'v4', sign: -1 }] }])
    for (const s of ['from + to −', 'source bound 5 stay', 'signed bound 3 (was 1), new bound 4 (was 3)', 'better, keep it the same or make it worse']) expect(j.proposal.explanation).toContain(s)
    expect((await ask('flip the sign of v 4', HERO)).proposal.actions).toEqual(j.proposal.actions)
    // Answers name arrows as the scene labels them, and the name works as a request.
    expect(none.proposal.explanation).toContain('for example "Flip the sign of c₁"')
    expect(j.proposal.title).toBe('Flip the sign of c₁')
    expect(j.proposal.explanation).toContain('This changes the sign of c₁ from + to −')
    expect(planTransaction(HERO, j.proposal.actions).summary).toContain('Set the sign of c₁ to −')
    expect((await ask('Flip the sign of c₁', HERO)).proposal.actions).toEqual(j.proposal.actions)
    // A walk whose scene labels are ASCII IDs that look like names ("a1", "b1") resolves them as shown.
    const ids = plan(HERO, [{ kind: 'set_vector_walk', experimentId: E.id, dimension: 3, vectors: [{ id: 'a1', coords: [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }] }, { id: 'b1', coords: [{ n: '-1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }] }], order: ['a1', 'b1'], signs: [1, -1] }])
    expect((await ask('Flip the sign of b1', ids)).proposal.actions).toEqual([{ kind: 'set_walk_signs', experimentId: E.id, signs: [{ id: 'b1', sign: 1 }] }])
    const off = await ask('Flip the sign of c1', sel(LINE, 'walk:vector:v0'))
    expect(off.proposal.actions).toEqual([])
    expect(off.proposal.explanation).toBe('Not applied: the walk has no arrow c₁.')
  })

  it('"Rearrange the same arrows" lists the arrows by the scene\'s names: + in source order, then − reversed', async () => {
    expect((await ask('Rearrange the same arrows', HERO)).proposal.explanation).toContain('a₁ b₁ c₁ −a₁ −b₁ −c₁, then −c₂ −b₂ −a₂ c₂ b₂ a₂')
    expect(planTransaction(HERO, [{ kind: 'set_walk_order', experimentId: E.id, order: [...E.order].reverse() }]).summary).toEqual(['Reordered the source walk: −c₂ −c₁ −b₂ −b₁ −a₂ −a₁ c₂ c₁ b₂ b₁ a₂ a₁'])
  })

  it('"Make all signs positive" reports the actual result: no improvement', async () => {
    const j = await ask('Make all signs positive', HERO)
    expect(j.proposal.actions[0]).toEqual({ kind: 'set_walk_signs', experimentId: E.id, signs: CASES.hero.input.vectors.map((v) => ({ id: v.id, sign: 1 })) })
    for (const s of ['new bound (5 + 5)/2 = 5 (before: 3)', 'equals source bound 5 (valid, no improvement from these signs)', 'better, keep it the same or make it worse']) expect(j.proposal.explanation).toContain(s)
  })

  it('"Why must the arrows return home?" opens the counterexample: nonzero total, 2 exceeds 1.5', async () => {
    const j = await ask('Why must the arrows return home?', HERO)
    expect(j.model).toBe('synthetic:proof-return-home')
    expect(j.proposal.actions).toEqual(caseActions(E, 'open-two', 'assumptions'))
    for (const s of ['T = (2, 0, 0) is not zero', 'the lemma does not apply', '(2 + 1)/2 = 1.5', '|W₂|² = 4 > 9/4, so 2 exceeds 1.5', 'dropping T would wrongly give (0, 0, 0)', 'not to the published theorem', 'Undo restores the previous walk']) expect(j.proposal.explanation).toContain(s)
    const ws = new Workspace(HERO)
    ws.commit({ baseRevision: HERO.revision, actions: j.proposal.actions })
    expect(deriveWalk(walkInputOf(lessonExperiment(ws.current)!)).zeroSum).toBe(false)
    // Undo restores the hero.
    ws.undo()
    expect(ws.current.experiments.find((x) => x.id === E.id)).toEqual(E)
  })

  it('the open walk: why it fails, restore, check refused with the exact failure (never a request_check)', async () => {
    const fails = await ask('Why does the bound fail here?', OPEN)
    expect(fails.proposal.actions).toEqual([{ kind: 'select_item', experimentId: E.id, item: 'walk:reordered:2' }, { kind: 'show_walk_stage', experimentId: E.id, stage: 'why' }])
    expect(fails.proposal.explanation).toContain('2 exceeds 1.5')
    const check = await ask('Check this example', OPEN)
    expect(check.model).toBe('synthetic:proof-check')
    expect(check.proposal.actions).toEqual([])
    for (const s of ['No Lean check is requested', 'total (2, 0, 0)', 'succeed vacuously', '|W₂|² = 4 > 9/4, so 2 exceeds 1.5']) expect(check.proposal.explanation).toContain(s)
    expect(checkTemplate(OPEN)).toMatchObject({ unavailable: expect.stringMatching(/does not return to its start/) })
    expect(() => planTransaction(OPEN, [{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: E.id } }])).toThrow(/does not return to its start/)
    const restore = await ask('Restore the closed walk', OPEN)
    expect(restore.proposal.actions[0]).toMatchObject({ kind: 'set_vector_walk', experimentId: E.id })
    expect(restore.proposal.explanation).toContain('source bound 5, signed bound 1, new bound 3')
    // No fixture, under any of its phrasings or none, yields a check on an open walk.
    for (const doc of [OPEN, sel(OPEN, 'walk:reordered:2'), sel(OPEN, 'walk:vector:v0')]) {
      for (const f of FIXTURES) for (const prompt of [undefined, normalizePrompt(f.example)]) {
        expect(f.build(doc, prompt).actions.some((a) => a.kind === 'request_check'), f.name).toBe(false)
      }
    }
    expect(JSON.stringify(walkTemplates(OPEN))).not.toContain('walk_reorder_instance')
  })

  it('"Check this example" on a closed walk requests the finite claim (a request, not a result)', async () => {
    const j = await ask('Check this example', HERO)
    expect(j.proposal.actions).toEqual([{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: E.id } }])
    expect(j.proposal.explanation).toContain('B = 5, D = 1')
    expect(j.proposal.explanation).toContain('Nothing is Lean-checked until the checker answers')
    expect(planTransaction(HERO, j.proposal.actions).effects).toEqual([{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: E.id } }])
  })

  it('"Does this prove the whole theorem?" — no: one reordering lemma, signing bound outside, minimality bridge', async () => {
    const j = await ask('Does this prove the whole theorem?', HERO)
    expect(j.proposal.actions).toEqual([])
    expect(j.proposal.explanation).toMatch(/^No\. /)
    for (const s of ['one reordering lemma', 'signing bound', 'outside this lesson', 'minimality forces B* ≤ D']) expect(j.proposal.explanation).toContain(s)
  })

  it('every example prompt answers through the route with its labelled synthetic model name', async () => {
    const docFor: Record<string, Doc> = { 'proof-flip-sign': sel(HERO, 'walk:vector:v4'), 'proof-restore': OPEN, 'proof-why-fails': OPEN, 'proof-restore-signs': EDITED }
    for (const f of WALK_FIXTURES) {
      const j = await ask(f.example, docFor[f.name] ?? HERO)
      expect([j.source, j.model, j.timing.providerMs]).toEqual(['synthetic', `synthetic:${f.name}`, null])
    }
  })
})

describe('stale context: a response planned for the hero never applies to the counterexample', () => {
  it('the planner rejects the hero proposal on the changed document', async () => {
    const j = await ask('Show the other half of the argument', HERO)
    expect(j.proposal.actions[0]).toMatchObject({ item: 'walk:reordered:9' })
    const v = validateProposal(j.proposal, OPEN)
    expect(v.ok).toBe(false)
    expect(v.ok ? '' : v.message).toMatch(/walk:reordered:9/)
  })

  it('the assistant client keeps it as a stale suggestion after the case changed during the request', async () => {
    const workspace = new Workspace(HERO)
    const app = {
      workspace,
      transact(actions: unknown) {
        const { plan: p } = workspace.commit({ baseRevision: workspace.current.revision, actions })
        return { summary: p.summary, effects: p.effects }
      },
      isPreviewing: () => false,
    } as unknown as App
    const pending: { body: unknown; resolve: (r: Response) => void }[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => pending.push({ body: JSON.parse(init.body as string), resolve }))))
    const client = new AssistantClient(app, () => [], () => {})
    const done = client.ask('Show the other half of the argument')
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    // The learner switches to the counterexample while the request runs.
    workspace.commit({ baseRevision: workspace.current.revision, actions: caseActions(E, 'open-two') })
    // The real synthetic route answers the request as it was sent (planned for the hero).
    const res = await route(apiRequest(pending[0]!.body))
    expect((res.json as AssistantResponse).proposal.actions[0]).toMatchObject({ item: 'walk:reordered:9' })
    pending[0]!.resolve(new Response(JSON.stringify(res.json), { status: res.status, headers: { 'content-type': 'application/json' } }))
    await done
    expect(client.state).toMatchObject({ kind: 'stale', reason: 'the workspace changed while the request was running' })
    expect(deriveWalk(walkInputOf(lessonExperiment(workspace.current)!)).zeroSum).toBe(false)
    expect(workspace.current.selection.item).toBeNull()
  })

  it('the server refuses a request whose base revision does not match the document', async () => {
    const body = assistantRequest('Show the other half of the argument', HERO, { baseRevision: HERO.revision + 1 })
    const r = await route(apiRequest(body))
    expect(r.status).toBe(400)
    expect((r.json as { code: string }).code).toBe('context_mismatch')
  })
})

describe('proof-lesson suggestions are answered by these fixtures on the actual document', () => {
  const states: Record<string, Doc> = {
    hero: HERO, 'W3 selected': sel(HERO, 'walk:reordered:3'), 'W9 selected': sel(HERO, 'walk:reordered:9'), 'arrow selected': sel(HERO, 'walk:vector:v4'),
    'U5 selected': sel(HERO, 'walk:source:5'), 'edited signs': EDITED, 'all positive': ALLPOS, 'line-six': LINE, 'open-two': OPEN,
  }
  for (const [label, doc] of Object.entries(states)) {
    it(label, () => {
      const list = suggestionsFor(panelInput(doc, { capability: { assistant: CAP.synthetic, speech: SPEECH } }))
      const live = suggestionsFor(panelInput(doc, { capability: { assistant: CAP.live, speech: SPEECH } }))
      expect(list.map((s) => s.text)).toEqual(live.map((s) => s.text))
      expect(list.length).toBeGreaterThan(0)
      for (const s of list) {
        const f = matchFixture(s.text)
        expect(f?.name, s.text).toMatch(/^proof-/)
        const p = f!.build(doc, normalizePrompt(s.text))
        const v = validateProposal(p, doc)
        expect(v.ok, `${s.text}: ${v.ok ? '' : v.message}`).toBe(true)
        expect(p.explanation, s.text).not.toMatch(/^(Not (applied|available)|Which (point|arrow))/)
      }
    })
  }

  it('an arrow selection offers "Flip this sign" instead of a "this point" question', () => {
    const texts = suggestionsFor(panelInput(sel(HERO, 'walk:vector:v4'))).map((s) => s.text)
    expect(texts[0]).toBe('Flip this sign')
    expect(suggestionsFor(panelInput(sel(HERO, 'walk:vector:v4')))[0]!.note).toBe('The sign of c₁')
    expect(suggestionsFor(panelInput(sel(HERO, 'walk:reordered:9'))).find((s) => s.text === 'Why is this point inside the bound?')?.note).toBe('W₉')
    expect(planTransaction(HERO, [{ kind: 'select_item', experimentId: E.id, item: 'walk:vector:v4' }]).summary).toEqual(['Selected arrow c₁'])
    expect(texts).not.toContain('Why is this point inside the bound?')
    expect(walkItemText({ kind: 'vector', id: 'v4' })).toBe('walk:vector:v4')
  })
})

describe('parseProposal accepts every walk template the context offers', () => {
  it('on the hero and on the open walk', () => {
    for (const doc of [HERO, sel(HERO, 'walk:reordered:9'), sel(HERO, 'walk:vector:v4'), EDITED, OPEN, PQ]) {
      for (const [name, t] of Object.entries(walkTemplates(doc))) {
        if (!('actions' in t)) continue
        const p = { proposalVersion: 1, title: name, explanation: '', actions: t.actions }
        expect(schemaError(proposalSchema(doc), p), name).toBeNull()
        expect(() => planTransaction(doc, parseProposal(p).actions), name).not.toThrow()
      }
    }
  })
})
