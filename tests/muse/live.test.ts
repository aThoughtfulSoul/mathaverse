// LIVE Meta smoke test (docs/MUSE.md "Live smoke test"). With MUSE_LIVE=1 and META_API_KEY it makes REAL
// provider calls; otherwise (the normal test run) it rehearses the same cases against a mocked provider whose
// replies are the synthetic fixtures (tests/muse/liveKit.ts; MUSE_REHEARSAL=0 skips them). It never prints the key. Each
// request records the mode, actual model, source, response time, the answer and the validated actions (one JSON
// line per request; in live mode also MUSE_LIVE_DIR/live.json). Each proposal is committed through
// Workspace.commit and undone with Workspace.undo, as the client does.
//
// Cases: P → Q and the order comparison (liveCases/pqOrder.ts), sculpture, cube and quotient (groups.ts),
// braids (braid.ts) and the proof lesson (proof.ts), including every UI-REFINEMENT-SPEC section 7 suggestion.

import { afterAll, describe, expect, it } from 'vitest'
import { demoDocument } from '../../src/workspace/document'
import { ENABLED, LIVE, MODE, TIMEOUT, type LiveCase, askWithInvalidKey, capabilitiesNow, rehearsalReferences, runCase, writeRecords } from './liveKit'
import { PQ_ORDER_CASES } from './liveCases/pqOrder'
import { GROUP_CASES } from './liveCases/groups'
import { BRAID_CASES } from './liveCases/braid'
import { PROOF_CASES } from './liveCases/proof'

afterAll(() => writeRecords('live'))

const SUITES: [string, LiveCase[]][] = [
  ['P → Q and the order comparison', PQ_ORDER_CASES],
  ['sculpture, cube and quotient', GROUP_CASES],
  ['braids', BRAID_CASES],
  ['the proof lesson', PROOF_CASES],
]

describe.skipIf(!ENABLED)(`Meta smoke test (${MODE}${LIVE ? ': real provider calls' : ': mocked provider, synthetic answers'})`, () => {
  for (const [title, cases] of SUITES) {
    if (!cases.length) continue
    describe(title, () => {
      cases.forEach((c, i) => {
        it(c.name, async () => {
          await runCase(c)
          // After the first answer, the process status reports a live-validated configuration.
          if (title === SUITES[0]![0] && i === 0) expect(capabilitiesNow()).toMatchObject({ configured: true, authenticated: true, liveValidated: true, mode: 'meta' })
        }, TIMEOUT)
      })
    })
  }

  // Rehearsal must keep exercising use_prepared: these cases' fixtures are exactly a prepared template.
  it.skipIf(LIVE)('rehearsal replied by reference for every case whose fixture is a prepared template', () => {
    expect(rehearsalReferences()).toBeGreaterThanOrEqual(30)
  })

  it('an invalid key is a truthful provider error with no synthetic fallback', async () => {
    const res = await askWithInvalidKey('Show me what this transformation loses', demoDocument())
    expect(res.status).not.toBe(200)
    expect(res.json).not.toHaveProperty('source')
    expect(res.json).not.toHaveProperty('proposal')
    expect((res.json as { code: string }).code).toMatch(/^provider_/)
  }, TIMEOUT)
})

describe('live smoke test gate', () => {
  it(ENABLED ? `is enabled (${MODE})` : 'is skipped (MUSE_REHEARSAL=0); set MUSE_LIVE=1 and META_API_KEY for real calls', () => {
    expect(typeof ENABLED).toBe('boolean')
  })
  it('every case has a unique name and a prompt', () => {
    const names = SUITES.flatMap(([, cs]) => cs.map((c) => c.name))
    expect(new Set(names).size).toBe(names.length)
    for (const [, cs] of SUITES) for (const c of cs) expect(c.prompt.trim().length).toBeGreaterThan(0)
  })
})
