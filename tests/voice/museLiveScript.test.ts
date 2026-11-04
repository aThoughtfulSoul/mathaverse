// scripts/muse-live.sh argument handling and provider selection, with NO real call: the script is copied into a
// temporary project root (it cd's to its own parent directory, so .local/ and docs/evidence/ land there) and
// `say`, `ffmpeg`, `npx` and `npm` are stubs that record their arguments and the relevant environment (whether a
// key is set, never its value). Real npx/npm are not on the stub PATH, so nothing can reach Meta.

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('../../scripts/muse-live.sh', import.meta.url))
const ZSH = ['/bin/zsh', '/usr/bin/zsh'].find((p) => existsSync(p))
/** A fake, clearly synthetic key. Never a real credential. */
const SYNTHETIC_KEY = `LLM_synthetictest_${randomUUID().replace(/-/g, '')}`

const STUBS: Record<string, string> = {
  say: `#!/bin/sh
echo "say $*" >> "$STUB_LOG"
while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then shift; printf 'FORMstub' > "$1"; fi; shift; done
`,
  ffmpeg: `#!/bin/sh
echo "ffmpeg $*" >> "$STUB_LOG"
for last; do :; done
printf 'RIFFstub' > "$last"
`,
  npx: `#!/bin/sh
wav=missing; [ -s "\${SPEECH_LIVE_WAV:-/nonexistent}" ] && wav=present
echo "npx $* | SPEECH_PROVIDER=$SPEECH_PROVIDER MUSE_LIVE=\${MUSE_LIVE:-} SPEECH_LIVE=\${SPEECH_LIVE:-} key=\${META_API_KEY:+set} wav=$wav text=\${SPEECH_LIVE_TEXT:-} dir=\${SPEECH_LIVE_DIR:-}" >> "$STUB_LOG"
echo '[speech-live] {"stub":"test double, not a Meta call"}'
exit \${STUB_EXIT:-0}
`,
  npm: `#!/bin/sh
echo "npm $* | SPEECH_PROVIDER=$SPEECH_PROVIDER key=\${META_API_KEY:+set}" >> "$STUB_LOG"
`,
}

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mw-muse-live-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'bin'))
  mkdirSync(join(root, 'tmp'))
  copyFileSync(SCRIPT, join(root, 'scripts', 'muse-live.sh'))
  for (const [name, body] of Object.entries(STUBS)) {
    writeFileSync(join(root, 'bin', name), body)
    chmodSync(join(root, 'bin', name), 0o755)
  }
  return root
}

function run(args: string[], opts: { key?: string; stubExit?: number } = {}) {
  const root = project()
  const log = join(root, 'stub.log')
  const env: Record<string, string> = { PATH: `${join(root, 'bin')}:/usr/bin:/bin`, HOME: root, ZDOTDIR: root, TMPDIR: join(root, 'tmp'), LANG: 'C', STUB_LOG: log }
  if (opts.key) env.META_API_KEY = opts.key
  if (opts.stubExit !== undefined) env.STUB_EXIT = String(opts.stubExit)
  const r = spawnSync(ZSH!, [join(root, 'scripts', 'muse-live.sh'), ...args], { env, input: '', encoding: 'utf8', timeout: 20_000 })
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []
  const out = `${r.stdout}${r.stderr}`
  return { status: r.status, out, calls, root }
}

describe.skipIf(!ZSH)('scripts/muse-live.sh (stubbed tools, no real call)', () => {
  it('rejects an unknown mode with a usage line that lists speech', () => {
    const r = run(['bogus'])
    expect(r.status).toBe(2)
    expect(r.out).toContain("usage: zsh scripts/muse-live.sh [rehearse|test|serve|again '<case name part>' [n]|speech ['<sentence>']]")
    expect(r.calls).toEqual([])
  })

  it('again needs a case name and a count of 1 to 50', () => {
    expect(run(['again']).status).toBe(2)
    for (const n of ['0', '51', 'x']) {
      const r = run(['again', 'fiber', n])
      expect(r.status).toBe(2)
      expect(r.out).toContain('n is 1 to 50')
      expect(r.calls).toEqual([])
    }
  })

  it('speech rejects a sentence that is not plain words before asking for the key', () => {
    for (const bad of ['-o /tmp/x', 'hi $(id)', 'a'.repeat(161), 'semi; colon']) {
      const r = run(['speech', bad])
      expect(r.status).toBe(2)
      expect(r.out).toContain("usage: zsh scripts/muse-live.sh speech ['<sentence>']")
      expect(r.out).not.toContain('Paste the Meta API key')
      expect(r.calls).toEqual([])
    }
  })

  it('speech without a key sends nothing: no synthesis, no route call, no record', () => {
    const r = run(['speech'])
    expect(r.status).toBe(1)
    expect(r.out).toContain('Paste the Meta API key (nothing is shown)')
    expect(r.out).toContain('No key entered; nothing was sent.')
    expect(r.calls).toEqual([])
    expect(existsSync(join(r.root, 'docs'))).toBe(false)
  })

  it('serve starts the app with SPEECH_PROVIDER=meta and the key in its environment, never printed', () => {
    const r = run(['serve'], { key: SYNTHETIC_KEY })
    expect(r.status).toBe(0)
    expect(r.calls).toEqual(['npm run dev:local | SPEECH_PROVIDER=meta key=set'])
    expect(r.out).toContain('with live Muse and Meta speech-to-text (SPEECH_PROVIDER=meta)')
    expect(r.out).not.toContain(SYNTHETIC_KEY)
    expect(r.out).not.toContain('Note: the key does not start with LLM_')
  })

  it('test runs the preflight and the full live run with SPEECH_PROVIDER=meta (stubbed), then does not serve on No', () => {
    const r = run(['test'], { key: SYNTHETIC_KEY })
    expect(r.status).toBe(0)
    expect(r.calls).toHaveLength(2)
    for (const c of r.calls) expect(c).toMatch(/^npx vitest run tests\/muse\/live\.test\.ts.* \| SPEECH_PROVIDER=meta MUSE_LIVE=1 SPEECH_LIVE= key=set/)
    expect(r.calls.some((c) => c.startsWith('npm'))).toBe(false)
    expect(r.out).not.toContain(SYNTHETIC_KEY)
  })

  it('speech synthesizes, converts to 16 kHz mono 16-bit WAV and runs the gated route check once, labelled as a test upload', () => {
    const r = run(['speech'], { key: SYNTHETIC_KEY })
    expect(r.status).toBe(0)
    expect(r.calls).toHaveLength(3)
    const [say, ffmpeg, npx] = r.calls as [string, string, string]
    expect(say).toMatch(/^say -o .*\/mw-stt-live\.[^/]+\/request\.aiff Show me what this transformation loses\.$/)
    expect(ffmpeg).toMatch(/-i .*request\.aiff -ac 1 -ar 16000 -c:a pcm_s16le .*request\.wav$/)
    expect(npx).toMatch(/^npx vitest run tests\/voice\/sttLive\.test\.ts \| SPEECH_PROVIDER=meta MUSE_LIVE= SPEECH_LIVE=1 key=set wav=present text=Show me what this transformation loses\. dir=docs\/evidence\/speech-live\/\d{4}-\d{2}-\d{2}-\d{6}$/)
    expect(r.out).toContain('Input: test-uploaded recording (synthesized speech), not a browser microphone.')
    expect(r.out).toContain('[speech-live] {"stub":"test double, not a Meta call"}')
    expect(r.out).toMatch(/Record: docs\/evidence\/speech-live\/\d{4}-\d{2}-\d{2}-\d{6}\/stt\.json/)
    expect(r.out).not.toContain(SYNTHETIC_KEY)
    expect(r.calls.some((c) => c.startsWith('npm'))).toBe(false) // "No" at the serve prompt
    expect(readdirSync(join(r.root, 'tmp'))).toEqual([]) // the temporary recording is removed on exit
  })

  it('speech passes a custom sentence and reports a failed check with its exit status', () => {
    const r = run(['speech', "Explain why W nine is inside the bound, please."], { key: SYNTHETIC_KEY, stubExit: 1 })
    expect(r.status).toBe(1)
    expect(r.calls[2]).toContain('text=Explain why W nine is inside the bound, please.')
    expect(r.out).toContain('The speech check failed')
    expect(readdirSync(join(r.root, 'tmp'))).toEqual([])
  })
})
