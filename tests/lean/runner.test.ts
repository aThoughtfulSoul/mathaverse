// Lean track: process limits on real (non-Lean) processes: SIGKILL timeout, abort, output cap, spawn failure.

import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { runProcess } from '../../server/lean/runner'

describe('runProcess limits', () => {
  it('kills a process at the timeout', async () => {
    const r = await runProcess('/bin/sleep', ['10'], tmpdir(), { timeoutMs: 100 })
    expect(r).toMatchObject({ timedOut: true, code: null, aborted: false })
    expect(r.ms).toBeLessThan(3000)
  })

  it('kills a process when the signal aborts, and never starts one for an aborted signal', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    expect(await runProcess('/bin/sleep', ['10'], tmpdir(), { signal: ac.signal })).toMatchObject({ aborted: true, code: null })
    expect(await runProcess('/bin/sleep', ['10'], tmpdir(), { signal: AbortSignal.abort() })).toMatchObject({ aborted: true, ms: 0 })
  })

  it('kills a process above the output cap and keeps at most the cap', async () => {
    const r = await runProcess('/bin/sh', ['-c', 'yes | head -c 1000000'], tmpdir(), { outputBytes: 4096 })
    expect(r.overflow).toBe(true)
    expect(r.stdout.length).toBeLessThanOrEqual(4096)
  })

  it('reports a binary that cannot start', async () => {
    const r = await runProcess('/nonexistent/lean', [], tmpdir())
    expect(r.spawnError).toMatch(/ENOENT/)
  })

  it('runs with a minimal environment in the given directory', async () => {
    const r = await runProcess('/bin/sh', ['-c', 'pwd; env | sort'], tmpdir())
    expect(r.code).toBe(0)
    expect(r.stdout).not.toMatch(/OPENAI|API_KEY|ELAN|LEAN_PATH/)
    expect(r.stdout).toMatch(/^HOME=/m)
  })
})
