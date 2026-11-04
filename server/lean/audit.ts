// Post-compile audit (MATHEMATICAL-CONTRACT M9). A clean exit is not enough: the only accepted output is
// exactly one information message, the `#print axioms` line for the expected theorem, naming only
// approved axioms. Anything else (an error or warning, stderr text, an extra or unparseable message, a
// missing or renamed theorem, sorryAx, Lean.ofReduceBool, any other axiom) is "not established".

import type { RunResult } from './runner'

/**
 * Approved axioms: none. The integer-pair encoding and `decide` need no axioms, so even the standard
 * propext / Classical.choice / Quot.sound would mean the template changed, and they are rejected.
 */
export const APPROVED_AXIOMS: readonly string[] = []

export type Audit = { ok: true; axioms: string[] } | { ok: false; reason: string }

interface LeanMessage {
  severity: string
  data: string
}

function parseMessages(stdout: string): LeanMessage[] | null {
  const out: LeanMessage[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let m: unknown
    try {
      m = JSON.parse(line)
    } catch {
      return null
    }
    if (typeof m !== 'object' || m === null) return null
    const { severity, data } = m as Record<string, unknown>
    if (typeof severity !== 'string' || typeof data !== 'string') return null
    out.push({ severity, data })
  }
  return out
}

const brief = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200)

export function auditRun(run: RunResult, theorem: string, approved: readonly string[] = APPROVED_AXIOMS): Audit {
  if (run.spawnError) return { ok: false, reason: 'the Lean process could not be started' }
  if (run.aborted) return { ok: false, reason: 'cancelled before Lean finished' }
  if (run.timedOut) return { ok: false, reason: 'Lean timed out (not verified; this is not a disproof)' }
  if (run.overflow) return { ok: false, reason: 'Lean output exceeded the cap' }
  if (run.stderr.trim()) return { ok: false, reason: 'Lean wrote to stderr' }
  const msgs = parseMessages(run.stdout)
  if (!msgs) return { ok: false, reason: 'unparseable Lean output' }
  const bad = msgs.find((m) => m.severity !== 'information')
  if (bad) return { ok: false, reason: `Lean ${bad.severity}: ${brief(bad.data)} (not verified; this is not a disproof)` }
  if (run.code !== 0) return { ok: false, reason: `Lean exited with code ${run.code}` }
  if (msgs.length !== 1) return { ok: false, reason: `expected one audit message, got ${msgs.length}` }
  const text = msgs[0]!.data.replace(/\s+/g, ' ').trim()
  const m = /^'([^']+)' (?:does not depend on any axioms|depends on axioms: \[([^\]]*)\])$/.exec(text)
  if (!m) return { ok: false, reason: 'unexpected audit message' }
  if (m[1] !== theorem) return { ok: false, reason: `audited ${m[1]}, expected ${theorem}` }
  const axioms = m[2] === undefined ? [] : m[2].split(',').map((a) => a.trim()).filter(Boolean)
  if (axioms.includes('sorryAx')) return { ok: false, reason: 'the proof uses sorry (sorryAx)' }
  if (axioms.includes('Lean.ofReduceBool')) return { ok: false, reason: 'the proof uses native evaluation (Lean.ofReduceBool)' }
  const extra = axioms.filter((a) => !approved.includes(a))
  if (extra.length) return { ok: false, reason: `unapproved axioms: ${extra.join(', ')}` }
  return { ok: true, axioms }
}
