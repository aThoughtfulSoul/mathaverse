// The audio pipeline of `zsh scripts/muse-live.sh speech`, up to the network, with a MOCKED Meta endpoint:
// macOS `say` and ffmpeg make the same 16 kHz mono 16-bit WAV the script makes (synthesized speech, NOT a
// person or a browser microphone), and the application's /api/transcribe route converts it with the real ffmpeg
// and hands it to the Meta adapter. The mocked endpoint checks what Meta would receive and answers with a
// SYNTHETIC documented response, so this proves the route accepts the script's recording; only the real call
// itself (the script's speech mode) can show that Meta accepts it. Skipped without say or ffmpeg.

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseWav } from '../../server/speech/audio'
import { newSpeechStatus, readSpeechConfig } from '../../server/speech/config'
import { capabilitiesFor, createTranscribeRoute } from '../../server/speech/index'
import { VOICE_VOCABULARY, boundHints } from '../../src/voice/protocol'
import { apiRequest } from './helpers'
import { sttRecord } from './sttLiveKit'

const SYNTHETIC_KEY = `LLM_synthetictest_${randomUUID().replace(/-/g, '')}`
// Only what the Meta path needs; the key is synthetic and the fetch is mocked.
const env = { PATH: process.env.PATH, HOME: process.env.HOME, SPEECH_PROVIDER: 'meta', META_API_KEY: SYNTHETIC_KEY }
const config = readSpeechConfig(env)
const SAY = '/usr/bin/say'
const ready = config.mode === 'meta' && existsSync(SAY)
const SENTENCE = 'Show me what this transformation loses.'

let dir = ''
let wav = Buffer.alloc(0)

beforeAll(async () => {
  if (!ready) return
  dir = await mkdtemp(join(tmpdir(), 'mw-stt-pipeline-'))
  const aiff = join(dir, 'request.aiff')
  const out = join(dir, 'request.wav')
  // The script's two commands, argument for argument.
  execFileSync(SAY, ['-o', aiff, SENTENCE])
  execFileSync(config.ffmpeg!, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], { stdio: 'ignore' })
  wav = readFileSync(out)
}, 60_000)

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe.skipIf(!ready)('speech-check recording through the route to a mocked Meta endpoint (synthesized speech)', () => {
  it('the route accepts the script recording and sends Meta a 16 kHz mono WAV; the record is labelled a test upload', async () => {
    const info = parseWav(wav)
    expect(info).toMatchObject({ sampleRate: 16000, channels: 1 })
    let sent: { url: string; audio: Buffer; auth: boolean } | null = null
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = Buffer.from(init.body as Uint8Array)
      const at = body.indexOf('RIFF')
      sent = { url, audio: body.subarray(at), auth: (init.headers as Record<string, string>).Authorization === `Bearer ${SYNTHETIC_KEY}` }
      return new Response(JSON.stringify({ sessionId: 's', transcript: 'synthetic mocked transcript', audioDurationMs: 1, turns: [] }), { status: 200 })
    }) as unknown as typeof fetch
    const status = newSpeechStatus()
    const route = createTranscribeRoute({ env, fetchImpl, status })
    const body = { requestId: `stt-pipeline-${Date.now()}`, mimeType: 'audio/wav', audioBase64: wav.toString('base64'), durationMs: Math.round(info!.durationMs), hints: boundHints([...VOICE_VOCABULARY]) }
    const result = await route(apiRequest(body))
    expect(result.status, JSON.stringify(result.json)).toBe(200)
    expect(sent!.url.split('?')[0]).toBe('https://api.meta.ai/v1/asr/transcribe')
    expect(sent!.auth).toBe(true)
    expect(parseWav(sent!.audio)).toMatchObject({ sampleRate: 16000, channels: 1 })
    expect(parseWav(sent!.audio)!.peak).toBeGreaterThan(0.01) // speech, not silence
    const rec = sttRecord({ spokenText: SENTENCE, bytes: wav.length, audioMs: info!.durationMs, config, result, wallMs: 1, capabilityAfter: capabilitiesFor(env, status), live: false })
    expect(rec).toMatchObject({ live: false, outcome: 'transcript', source: 'meta', input: { kind: 'test-upload-synthesized-speech' } })
    expect(JSON.stringify(rec)).not.toContain(SYNTHETIC_KEY)
  }, 30_000)
})
