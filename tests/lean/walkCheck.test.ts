// Lean track, proof lesson: real compiles of `walk_reorder_instance` with the pinned toolchain through the
// mounted route (PROOF-EXPLORER-MATH section 8). The prepared hero, line-six and all-positive walks are checked
// with an empty-axiom receipt of template mw-lean-walk-1; a sign-edited hero (still closed) is a different claim
// whose receipt does not cover the hero; open-two is refused before Lean. Lean itself must also reject tampered
// statements (the open walk forced through, wrong bounds, a wrong order, a stale order after a sign flip), so a
// passing check is never vacuous, and the audit accepts the real output only as exactly one axioms line.
// Skipped when the pinned toolchain is absent. Each compile takes well under a second on the reference Mac.
//
// This file's Lean runs use their own TMPDIR: check.test.ts counts `mw-lean-*` directories in the shared temp
// directory around a compile, and test files run in parallel. The last test checks that every run here
// removed its directory.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { type CheckResponse, claimHash, parseClaimDescriptor } from '../../src/workspace/claims'
import { type WalkClaimDescriptor, describeWalkClaim } from '../../src/workspace/walkClaim'
import { type Sign, type WalkInput, deriveWalk } from '../../src/algebra/walk'
import { CASES, type CaseId } from '../../src/lessons/steinitz/cases'
import { checkRoute, resolveReceipt } from '../../server/lean/index'
import { TOOLCHAIN_ID, probeToolchain, runLean } from '../../server/lean/runner'
import { THEOREM } from '../../server/lean/template'
import { generateAny } from '../../server/lean/templates'
import { auditRun } from '../../server/lean/audit'

const lean = await probeToolchain()

const sharedTmp = process.env.TMPDIR
const ownTmp = mkdtempSync(join(tmpdir(), 'mw-walk-tests-'))
process.env.TMPDIR = ownTmp
afterAll(() => {
  if (sharedTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = sharedTmp
  rmSync(ownTmp, { recursive: true, force: true })
})

const desc =(id: CaseId): WalkClaimDescriptor => describeWalkClaim(CASES[id].input)
const hashOf = (d: WalkClaimDescriptor) => claimHash(parseClaimDescriptor(d))

async function check(claim: WalkClaimDescriptor): Promise<CheckResponse> {
  const res = await checkRoute({ method: 'POST', path: '/api/check', body: { requestId: 'walk-real', claim }, signal: new AbortController().signal })
  expect(res.status).toBe(200)
  return res.json as CheckResponse
}

async function expectChecked(claim: WalkClaimDescriptor): Promise<CheckResponse> {
  const r = await check(claim)
  expect(r.reason).toBeNull()
  expect(r.status).toBe('checked')
  const hash = await hashOf(claim)
  expect(r.claimHash).toBe(hash)
  expect(r.provenance).toEqual({ templateVersion: 'mw-lean-walk-1', toolchain: TOOLCHAIN_ID, theorem: 'MathWorkspace.claim', axioms: [], inputHash: hash })
  expect(resolveReceipt(r.receipt!.id, hash)).toMatchObject({ claimHash: hash, templateVersion: 'mw-lean-walk-1', theorem: THEOREM, axioms: [], issuedAt: r.receipt!.issuedAt })
  expect(resolveReceipt(r.receipt!.id, '0'.repeat(64))).toBeNull()
  return r
}

async function heroSource(): Promise<string> {
  const exact = parseClaimDescriptor(desc('hero'))
  return generateAny(exact, await claimHash(exact)).source
}

function replaceOnce(src: string, from: string, to: string): string {
  expect(src.split(from)).toHaveLength(2)
  return src.replace(from, to)
}

describe.skipIf(!lean)('walk_reorder_instance: pinned Lean compiles and audits (real toolchain)', () => {
  it('hero: checked; the statement Lean proved names the order [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1], B = 5 and D = 1', async () => {
    const r = await expectChecked(desc('hero'))
    expect(r.statement).toContain('outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]')
    expect(r.statement).toContain('def B : Nat := 5\ndef D : Nat := 1')
    expect(r.statement).toContain('def eps : List Int := [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]')
  }, 20_000)

  it('line-six: checked (B = 3, D = 1, order [0, 2, 3, 5, 4, 1])', async () => {
    const r = await expectChecked(desc('line-six'))
    expect(r.statement).toContain('def B : Nat := 3\ndef D : Nat := 1')
    expect(r.statement).toContain('outputOrder eps = [0, 2, 3, 5, 4, 1]')
  }, 20_000)

  it('all-positive: checked; a valid bound with no improvement (B = D = 5, order unchanged)', async () => {
    const r = await expectChecked(desc('all-positive'))
    expect(r.statement).toContain('def B : Nat := 5\ndef D : Nat := 5')
    expect(r.statement).toContain('outputOrder eps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]')
  }, 20_000)

  it('a sign-edited hero (still closed) is checked as a different claim; neither receipt covers the other hash', async () => {
    const w = CASES.hero.input
    const edited: WalkInput = { ...w, signs: w.signs.map((s, i) => (w.vectors[i]!.id === 'v1' ? (-s as Sign) : s)) }
    const f = deriveWalk(edited)
    expect(f.zeroSum).toBe(true)
    const hero = await expectChecked(desc('hero'))
    const other = await expectChecked(describeWalkClaim(edited))
    expect(other.claimHash).not.toBe(hero.claimHash)
    expect(other.statement).not.toBe(hero.statement)
    expect(other.statement).toContain(`outputOrder eps = [${f.permutation.join(', ')}]`)
    expect(other.statement).toContain(`def B : Nat := 5\ndef D : Nat := ${f.D}`)
    expect(resolveReceipt(other.receipt!.id, hero.claimHash)).toBeNull()
    expect(resolveReceipt(hero.receipt!.id, other.claimHash)).toBeNull()
    expect(resolveReceipt(other.receipt!.id, other.claimHash)).not.toBeNull()
  }, 30_000)

  it('open-two: refused with its arithmetic before Lean, no receipt', async () => {
    const r = await check(desc('open-two'))
    expect(r).toMatchObject({ status: 'not_established', provenance: null, receipt: null })
    expect(r.reason).toBe('Computed exactly, the claim is false: the walk does not return to its start (total (2, 0, 0)), so the reordering lemma does not apply; here W_2 = (2, 0, 0) has |W_2|^2 = 4 > 9/4 = (3/2)^2. It was not submitted to Lean.')
    expect(r.timing.ms).toBeLessThan(200)
  })

  it('the audit accepts the real output only as exactly one axioms line', async () => {
    const run = await runLean(await heroSource())
    expect(run.code).toBe(0)
    expect(run.stderr).toBe('')
    expect(auditRun(run, THEOREM)).toEqual({ ok: true, axioms: [] })
    const line = run.stdout.trim()
    expect(line.split('\n')).toHaveLength(1)
    expect(JSON.parse(line)).toMatchObject({ severity: 'information', data: expect.stringMatching(/^'MathWorkspace\.claim' does not depend on any axioms\s*$/) })
    const extra = JSON.stringify({ severity: 'information', data: 'W_3 = (1, 1, 1)', caption: '', fileName: 'Claim.lean' })
    for (const stdout of ['', `${line}\n${line}\n`, `${extra}\n${line}\n`, `${line}\n${extra}\n`, line.replace('MathWorkspace.claim', 'MathWorkspace.claim2'), line.replace('does not depend on any axioms', 'depends on axioms: [sorryAx]')]) {
      expect(auditRun({ ...run, stdout }, THEOREM).ok).toBe(false)
    }
  }, 20_000)

  it('Lean itself rejects tampered statements: the claim cannot succeed vacuously', async () => {
    const hero = await heroSource()
    const openExact = parseClaimDescriptor(desc('open-two'))
    const open = generateAny(openExact, await claimHash(openExact)).source
    const tampered = {
      // The route never submits this one; forced through, `decide` proves the conjunction false (U_N ≠ 0).
      'open-two forced through Lean': open,
      'B = 4 (a smaller bound)': replaceOnce(hero, 'def B : Nat := 5', 'def B : Nat := 4'),
      'B = 6 (a bound, but not the least)': replaceOnce(hero, 'def B : Nat := 5', 'def B : Nat := 6'),
      'a wrong order literal': replaceOnce(hero, 'outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]', 'outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 1, 3]'),
      'one sign flipped with the old order kept': replaceOnce(hero, 'def eps : List Int := [1, -1, 1,', 'def eps : List Int := [1, 1, 1,'),
    }
    for (const [name, source] of Object.entries(tampered)) {
      const run = await runLean(source)
      const audit = auditRun(run, THEOREM)
      expect(audit.ok, name).toBe(false)
      expect(run.code, name).toBe(1)
      expect(run.stdout, name).toMatch(/Tactic `decide` proved that the proposition[\s\S]*is false/)
    }
  }, 60_000)

  it('every run of this file used its own temp directory and removed it', () => {
    expect(tmpdir()).toBe(ownTmp)
    expect(readdirSync(ownTmp)).toEqual([])
  })
})
