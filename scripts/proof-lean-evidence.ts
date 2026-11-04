// Proof lesson, Lean evidence: run the REAL finite checker (the mounted POST /api/check handler with the pinned
// toolchain) on the four prepared Steinitz cases and write what it answered to docs/evidence/proof-explorer/lean/.
//
//   npx vite-node scripts/proof-lean-evidence.ts
//
// Writes one JSON per case (the route response: status, claimHash, statement, provenance, receipt, reason,
// timing), the generated Lean source of the hero (hero-claim.lean) and negative-controls.json: tampered sources
// compiled directly (bypassing the route's exact pre-check) to show that the Lean theorem itself fails when a
// conjunct is false. These are local runs of the finite-example checker, not a build of the upstream research
// project. Receipts live in this process only: the IDs recorded here are not resolvable by a running server.

import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { CASES, CASE_IDS, type CaseId } from '../src/lessons/steinitz/cases'
import { describeWalkClaim } from '../src/workspace/walkClaim'
import { type CheckResponse, claimHash, evaluateExactly, parseClaimDescriptor } from '../src/workspace/claims'
import { checkRoute, resolveReceipt } from '../server/lean/index'
import { generateAny } from '../server/lean/templates'
import { WALK_TEMPLATE_VERSION } from '../server/lean/walkTemplate'
import { THEOREM } from '../server/lean/template'
import { auditRun } from '../server/lean/audit'
import { TOOLCHAIN_ID, probeToolchain, runLean } from '../server/lean/runner'

const OUT = fileURLToPath(new URL('../docs/evidence/proof-explorer/lean/', import.meta.url))
const SCOPE = 'Real local run of the finite-example checker (pinned Lean, core Lean only, decide, empty-axiom audit) on one prepared walk. Not a build or check of the upstream research project, the general lemma, the renderer or any explanation.'

async function runCase(id: CaseId) {
  const claim = describeWalkClaim(CASES[id].input)
  const exact = parseClaimDescriptor(claim)
  const res = await checkRoute({ method: 'POST', path: '/api/check', body: { requestId: `evidence-${id}`, claim }, signal: new AbortController().signal })
  const r = res.json as CheckResponse
  const hash = await claimHash(exact)
  const record = {
    case: id,
    title: CASES[id].title,
    scope: SCOPE,
    recordedAt: new Date().toISOString(),
    templateVersion: WALK_TEMPLATE_VERSION,
    computedExactly: evaluateExactly(exact),
    request: { requestId: `evidence-${id}`, claim },
    httpStatus: res.status,
    response: r,
    checks: {
      serverHashMatchesLocalHash: r.claimHash === hash,
      receiptResolvesForThisHash: r.receipt ? resolveReceipt(r.receipt.id, hash) !== null : false,
      receiptResolvesForAnotherHash: r.receipt ? resolveReceipt(r.receipt.id, '0'.repeat(64)) !== null : false,
    },
  }
  await writeFile(`${OUT}${id}.json`, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return { id, status: r.status, hash: r.claimHash, ms: r.timing.ms, receipt: r.receipt?.id ?? null, reason: r.reason }
}

/** Tampered sources compiled directly: the route would never submit these, but Lean must reject each one. */
async function negativeControls() {
  const heroExact = parseClaimDescriptor(describeWalkClaim(CASES.hero.input))
  const hero = generateAny(heroExact, await claimHash(heroExact)).source
  const openExact = parseClaimDescriptor(describeWalkClaim(CASES['open-two'].input))
  const open = generateAny(openExact, await claimHash(openExact)).source
  const swap = (src: string, from: string, to: string) => {
    if (!src.includes(from)) throw new Error(`control: "${from}" not found in the generated source`)
    return src.split(from).join(to)
  }
  const controls = [
    { name: 'open-two forced through Lean', change: 'the non-closed walk [e, e] with signs [+1, -1], generated as is (the route refuses it before Lean)', source: open },
    { name: 'hero with B = 4', change: 'def B : Nat := 5 replaced by 4 (some |U_j|^2 = 588/25 > 16)', source: swap(hero, 'def B : Nat := 5', 'def B : Nat := 4') },
    { name: 'hero with B = 6', change: 'def B : Nat := 5 replaced by 6 (still a bound, but not the least natural one)', source: swap(hero, 'def B : Nat := 5', 'def B : Nat := 6') },
    { name: 'hero with a wrong order literal', change: 'the order literal in the theorem with its last two entries swapped (..., 3, 1] -> ..., 1, 3])', source: swap(hero, 'outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]', 'outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 1, 3]') },
    { name: 'hero with one sign flipped, old order kept', change: 'eps[1] = -1 replaced by +1; the order literal and D are those generated for the original hero', source: swap(hero, 'def eps : List Int := [1, -1, 1,', 'def eps : List Int := [1, 1, 1,') },
  ]
  const out = []
  for (const c of controls) {
    const run = await runLean(c.source)
    const audit = auditRun(run, THEOREM)
    out.push({ name: c.name, change: c.change, exitCode: run.code, leanMs: run.ms, audit })
  }
  return out
}

async function main() {
  const toolchain = await probeToolchain()
  if (!toolchain) {
    console.error('The pinned Lean toolchain is not available; nothing was written.')
    process.exit(1)
  }
  await mkdir(OUT, { recursive: true })
  const heroExact = parseClaimDescriptor(describeWalkClaim(CASES.hero.input))
  await writeFile(`${OUT}hero-claim.lean`, generateAny(heroExact, await claimHash(heroExact)).source, 'utf8')
  const summary = []
  for (const id of CASE_IDS) summary.push(await runCase(id))
  const controls = await negativeControls()
  const controlsDoc = { scope: 'Tampered Lean sources compiled directly with the pinned toolchain and audited with server/lean/audit.ts. None may pass.', toolchain: TOOLCHAIN_ID, recordedAt: new Date().toISOString(), controls }
  await writeFile(`${OUT}negative-controls.json`, `${JSON.stringify(controlsDoc, null, 2)}\n`, 'utf8')
  for (const s of summary) console.log(`${s.id.padEnd(13)} ${s.status.padEnd(16)} ${s.hash.slice(0, 12)}  ${String(s.ms).padStart(5)} ms  ${s.receipt ?? s.reason}`)
  for (const c of controls) console.log(`control: ${c.name.padEnd(44)} ${c.audit.ok ? 'PASSED (unexpected)' : 'rejected'}  ${c.leanMs} ms  ${c.audit.ok ? '' : c.audit.reason}`)
  if (controls.some((c) => c.audit.ok)) process.exit(2)
}

await main()
