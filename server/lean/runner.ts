// Pinned Lean process invocation (WORKSPACE-AND-AI W6 limits). The binary is resolved inside the pinned
// toolchain directory (never through the elan proxy, which could install a toolchain), its commit is
// verified once, and every run gets a fresh temp directory, a minimal environment, a SIGKILL timeout,
// an output cap and the caller's AbortSignal. Messages are requested as JSON lines (`--json`).

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const TOOLCHAIN = 'leanprover/lean4:v4.26.0'
export const TOOLCHAIN_COMMIT = 'd8204c9fd894f91bbb2cdfec5912ec8196fd8562'
/** Provenance identifier: the toolchain name plus the short pinned commit. */
export const TOOLCHAIN_ID = `${TOOLCHAIN} (${TOOLCHAIN_COMMIT.slice(0, 12)})`
export const RUN_LIMITS = { timeoutMs: 15_000, outputBytes: 64 * 1024 } as const

export function leanBinary(): string {
  const elan = process.env.ELAN_HOME || join(homedir(), '.elan')
  return join(elan, 'toolchains', 'leanprover--lean4---v4.26.0', 'bin', 'lean')
}

export interface RunResult {
  /** Process exit code, or null when killed. */
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** stdout + stderr exceeded the cap; the process was killed. */
  overflow: boolean
  /** Spawn failure (binary missing...), with the process never started. */
  spawnError: string | null
  ms: number
}

export interface RunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  outputBytes?: number
}

/** Run one process with the limits above. Never rejects; failures are fields of the result. */
export function runProcess(bin: string, args: string[], cwd: string, opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? RUN_LIMITS.timeoutMs
  const cap = opts.outputBytes ?? RUN_LIMITS.outputBytes
  const start = performance.now()
  return new Promise((resolve) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let bytes = 0
    const r = { timedOut: false, aborted: false, overflow: false }
    let spawnError: string | null = null
    if (opts.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', ...r, aborted: true, spawnError: null, ms: 0 })
      return
    }
    const child = spawn(bin, args, { cwd, env: { PATH: '/usr/bin:/bin', HOME: cwd, LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    const timer = setTimeout(() => ((r.timedOut = true), kill()), timeoutMs)
    const onAbort = () => ((r.aborted = true), kill())
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > cap) {
        r.overflow = true
        kill()
        return
      }
      sink.push(chunk)
    }
    child.stdout.on('data', collect(out))
    child.stderr.on('data', collect(err))
    let done = false
    const finish = (code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        ...r,
        spawnError,
        ms: Math.round(performance.now() - start),
      })
    }
    child.on('error', (e) => {
      spawnError = e.message
      if (child.pid === undefined) finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

/** Compile one generated Lean file in a fresh temp directory, removed afterwards. */
export async function runLean(source: string, opts: RunOptions = {}): Promise<RunResult> {
  const dir = await mkdtemp(join(tmpdir(), 'mw-lean-'))
  try {
    await writeFile(join(dir, 'Claim.lean'), source, 'utf8')
    return await runProcess(leanBinary(), ['--json', 'Claim.lean'], dir, opts)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

let verified = false

/** TOOLCHAIN_ID when the binary exists and reports the pinned commit, else null (a failure is retried). */
export async function probeToolchain(): Promise<string | null> {
  if (!verified) {
    const r = await runProcess(leanBinary(), ['--githash'], tmpdir(), { timeoutMs: 5_000, outputBytes: 4096 })
    verified = r.code === 0 && r.stdout.trim() === TOOLCHAIN_COMMIT
  }
  return verified ? TOOLCHAIN_ID : null
}
