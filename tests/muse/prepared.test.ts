// Prepared templates by reference (server/muse/prepared.ts) on the LIVE path with a MOCKED fetch: every provider
// reply here is SYNTHETIC. A use_prepared reference expands to exactly the template the model was shown, computed
// on the same document; the client receives ordinary actions; a malformed, repeated or unavailable reference goes
// to the repair turn and never applies anything.

import { describe, expect, it } from 'vitest'
import { type Doc, demoDocument } from '../../src/workspace/document'
import { Workspace, planTransaction } from '../../src/workspace/reducer'
import { type AssistantResponse, parseProposal } from '../../src/workspace/actions'
import { proofActions, lessonExperiment } from '../../src/demo/proof'
import { createAssistantRoute } from '../../server/muse/index'
import { newStatus } from '../../server/muse/config'
import { USE_PREPARED, expandPrepared, preparedCatalog, preparedContext } from '../../server/muse/prepared'
import { proposalSchema } from '../../server/muse/schema'
import { walkTemplates } from '../../server/muse/walk'
import { preparedTemplates } from '../../server/muse/order'
import { fourTemplates } from '../../server/muse/four'
import { REARRANGE_WALK } from '../../src/recipes/recipe'
import { LIVE_ENV, apiRequest, assistantRequest, mockFetch, schemaError, syntheticProposal, syntheticReply } from './helpers'

const PQ = demoDocument()
const HERO = planTransaction(PQ, proofActions(PQ)).doc
const ref = (template: string) => ({ kind: USE_PREPARED, template })
const actionsOf = (t: unknown) => (t as { actions: unknown[] }).actions

async function live(doc: Doc, ...replies: Response[]) {
  const m = mockFetch(...replies)
  const route = createAssistantRoute({ env: LIVE_ENV, fetchImpl: m.fetchImpl, status: newStatus(), minRepairMs: 0 })
  const res = await route(apiRequest(assistantRequest('Open the proof lesson', doc)))
  return { res, calls: m.calls }
}

describe('the catalog is the context the model sees', () => {
  it('names every available template by its context path, with exactly the context\'s actions', () => {
    const c = preparedCatalog(PQ)
    expect([...c.keys()]).toEqual(expect.arrayContaining(['prepared.orderComparison', 'proofLesson.templates.openLesson', 'proofLesson.templates.counterexample', 'prepared.four.showSculptureC4']))
    expect(c.get('proofLesson.templates.openLesson')).toEqual(actionsOf(walkTemplates(PQ).openLesson))
    expect(c.get('prepared.orderComparison')).toEqual(actionsOf(preparedTemplates(PQ).orderComparison))
    for (const [name, t] of Object.entries(fourTemplates(PQ))) {
      if ('actions' in t && t.actions.length) expect(c.get(`prepared.four.${name}`)).toEqual(t.actions)
      else expect(c.has(`prepared.four.${name}`)).toBe(false)
    }
    expect(preparedContext(PQ).proofLesson.templates).toEqual(walkTemplates(PQ))
  })

  it('leaves out unavailable templates: whyThisPoint exists only with a selected endpoint', () => {
    expect(preparedCatalog(HERO).has('proofLesson.templates.whyThisPoint')).toBe(false)
    const e = lessonExperiment(HERO)!
    const k3 = planTransaction(HERO, [{ kind: 'select_item', experimentId: e.id, item: 'walk:reordered:3' }]).doc
    expect(preparedCatalog(k3).has('proofLesson.templates.whyThisPoint')).toBe(true)
  })

  it('the schema offers use_prepared with exactly the available paths', () => {
    const variants = ((proposalSchema(HERO).properties as { actions: { items: { anyOf: { properties: { kind: { enum: string[] }; template?: { enum: string[] } } }[] } } }).actions.items.anyOf)
    const v = variants.find((x) => x.properties.kind.enum[0] === USE_PREPARED)!
    expect(v.properties.template!.enum.sort()).toEqual([...preparedCatalog(HERO).keys()].sort())
    expect(schemaError(proposalSchema(PQ), { proposalVersion: 1, title: 't', explanation: 'e', actions: [ref('proofLesson.templates.openLesson')] })).toBeNull()
  })
})

describe('expansion', () => {
  it('replaces the reference in place with a copy of the template, keeping the actions around it', () => {
    const select = { kind: 'select', experimentId: 'exp-p', sampleId: null }
    const x = expandPrepared({ proposalVersion: 1, title: 't', explanation: 'e', actions: [ref('proofLesson.templates.openLesson'), select] }, PQ)
    expect(x.ok && (x.value as { actions: unknown[] }).actions).toEqual([...actionsOf(walkTemplates(PQ).openLesson), select])
    expect(x.ok && x.expansion).toEqual({ template: 'proofLesson.templates.openLesson', at: 0, length: 4 })
    // A deep copy: editing nested fields of the expanded actions never changes the templates or shared constants.
    const before = JSON.stringify([preparedCatalog(PQ).get('proofLesson.templates.openLesson'), REARRANGE_WALK])
    if (x.ok) {
      const a = (x.value as { actions: Record<string, any>[] }).actions // eslint-disable-line @typescript-eslint/no-explicit-any
      a[0]!.recipe.name = 'edited'
      a[0]!.recipe.operations[0].kind = 'edited'
      a[1]!.vectors[0].coords[0].n = '9'
    }
    expect(JSON.stringify([preparedCatalog(PQ).get('proofLesson.templates.openLesson'), REARRANGE_WALK])).toBe(before)
  })

  it('leaves a proposal without a reference unchanged', () => {
    const raw = { proposalVersion: 1, title: 't', explanation: 'e', actions: [] }
    expect(expandPrepared(raw, PQ)).toEqual({ ok: true, value: raw })
  })

  it.each([
    ['an unknown path', [ref('prepared.four.nothing')], /is not a prepared template available now/],
    ['an unavailable template', [ref('proofLesson.templates.whyThisPoint')], /is not a prepared template available now/],
    ['two references', [ref('prepared.orderComparison'), ref('proofLesson.templates.openLesson')], /at most one use_prepared/],
    ['an extra field', [{ ...ref('prepared.orderComparison'), note: 'x' }], /takes exactly/],
    ['a non-string path', [{ kind: USE_PREPARED, template: 3 }], /takes exactly/],
  ])('rejects %s', (_, actions, message) => {
    const x = expandPrepared({ proposalVersion: 1, title: 't', explanation: 'e', actions }, PQ)
    expect(x.ok).toBe(false)
    if (!x.ok) expect(x.message).toMatch(message)
  })
})

describe('on the live path (synthetic mock)', () => {
  it('a reference to openLesson opens the lesson as source "meta"; the client receives ordinary actions', async () => {
    const { res } = await live(PQ, syntheticReply(syntheticProposal([ref('proofLesson.templates.openLesson')])))
    expect(res.status).toBe(200)
    const j = res.json as AssistantResponse
    expect(j.source).toBe('meta')
    expect(j.proposal.actions).toEqual(actionsOf(walkTemplates(PQ).openLesson))
    expect(JSON.stringify(j)).not.toContain(USE_PREPARED)
    // The client's own parser accepts it, and committing opens the lesson.
    expect(() => parseProposal(j.proposal)).not.toThrow()
    const ws = new Workspace(PQ)
    ws.commit({ baseRevision: j.baseRevision, actions: j.proposal.actions })
    expect(lessonExperiment(ws.current)).not.toBeNull()
  })

  it('an unavailable reference goes to the repair turn with the reason; a corrected reply applies', async () => {
    const { res, calls } = await live(HERO, syntheticReply(syntheticProposal([ref('proofLesson.templates.whyThisPoint')])), syntheticReply(syntheticProposal([ref('proofLesson.templates.whyRepresentative')])))
    expect(res.status).toBe(200)
    const repair = JSON.stringify(calls[1]!.body.input)
    expect(repair).toContain('\\"proofLesson.templates.whyThisPoint\\" is not a prepared template available now; use a path from the use_prepared enum')
    expect((res.json as AssistantResponse).proposal.actions).toEqual(actionsOf(walkTemplates(HERO).whyRepresentative))
  })

  it('a bad reference twice is an honest error that applies nothing', async () => {
    const bad = syntheticReply(syntheticProposal([ref('prepared.four.nothing')]))
    const { res } = await live(PQ, bad, syntheticReply(syntheticProposal([ref('prepared.four.nothing')])))
    expect(res.status).toBe(502)
    expect(res.json).toMatchObject({ code: 'invalid_output' })
    expect(res.json).not.toHaveProperty('proposal')
  })

  it('a template counts toward the 8-action limit: 7 + 1 applies all 8; 7 + 2 is refused with the expansion stated, never truncated', async () => {
    const view = { kind: 'set_view', ghostCube: false, sampleLabels: true }
    expect(preparedCatalog(PQ).get('prepared.orderComparison')).toHaveLength(7)
    const fits = await live(PQ, syntheticReply(syntheticProposal([ref('prepared.orderComparison'), view])))
    expect(fits.res.status).toBe(200)
    expect((fits.res.json as AssistantResponse).proposal.actions).toEqual([...actionsOf(preparedTemplates(PQ).orderComparison), view])
    const over = syntheticProposal([ref('prepared.orderComparison'), view, view])
    const { res, calls } = await live(PQ, syntheticReply(over), syntheticReply(over))
    expect(res.status).toBe(502)
    expect(res.json).toMatchObject({ code: 'invalid_output' })
    expect(res.json).not.toHaveProperty('proposal')
    const reason = 'use_prepared \\"prepared.orderComparison\\" expands to 7 actions; with 2 more the proposal has 9, above 8'
    expect(JSON.stringify(calls[1]!.body.input)).toContain(reason)
  })

  it('after an expansion, a repair message says its positions count the expanded list', async () => {
    const bad = syntheticProposal([ref('proofLesson.templates.openLesson'), { kind: 'select_item', experimentId: '$walk', item: 'walk:reordered:99' }])
    const { res, calls } = await live(PQ, syntheticReply(bad), syntheticReply(bad))
    expect(res.status).toBe(422)
    expect(JSON.stringify(calls[1]!.body.input)).toContain('positions count the expanded list (use_prepared \\"proofLesson.templates.openLesson\\" at actions[0] became actions[0..3]): actions[4]')
  })
})
