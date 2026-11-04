// Real ffmpeg conversion -> real Meta adapter -> MOCKED network, with generated tones, not speech.
// This preserves browser-format coverage without invoking a recognition model or requiring an API key.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseWav } from '../../server/speech/audio'
import { newSpeechStatus, readSpeechConfig } from '../../server/speech/config'
import { createTranscribeRoute } from '../../server/speech/index'
import type { TranscribeMimeType } from '../../src/voice/protocol'
import { apiRequest, toneWav, transcribeBody } from './helpers'

const env = { PATH: process.env.PATH, SPEECH_PROVIDER: 'meta', META_API_KEY: 'synthetic-format-test-key' }
const config = readSpeechConfig(env)
const ready = config.mode === 'meta'
let dir = ''
const clips: { name: string; mime: TranscribeMimeType; bytes: Buffer }[] = []

beforeAll(async () => {
  if (!ready) return
  dir = await mkdtemp(join(tmpdir(), 'mw-audio-formats-'))
  const input = join(dir, 'tone.wav')
  await writeFile(input, toneWav(1200, 0.3, 48000))
  const formats: [string, TranscribeMimeType, string[]][] = [
    ['webm', 'audio/webm;codecs=opus', ['-c:a', 'libopus', '-b:a', '32k']],
    ['ogg', 'audio/ogg;codecs=opus', ['-c:a', 'libopus', '-b:a', '32k']],
    ['mp4', 'audio/mp4', ['-c:a', 'aac', '-b:a', '64k']],
    ['wav', 'audio/wav', ['-c:a', 'pcm_s16le']],
  ]
  for (const [name, mime, codec] of formats) {
    const output = join(dir, `encoded.${name}`)
    execFileSync(config.ffmpeg!, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-ac', '1', ...codec, output], { stdio: 'ignore' })
    clips.push({ name, mime, bytes: readFileSync(output) })
  }
}, 30_000)

afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

describe.skipIf(!ready)('browser audio formats to Meta (tones, mocked endpoint)', () => {
  for (const name of ['webm', 'ogg', 'mp4', 'wav']) {
    it(`${name} becomes a 16 kHz mono WAV and reaches only the Meta endpoint`, async () => {
      const calls: string[] = []
      const fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push(url)
        const multipart = Buffer.from(init.body as Uint8Array)
        const start = multipart.indexOf('RIFF')
        expect(start).toBeGreaterThan(0)
        const size = multipart.readUInt32LE(start + 4) + 8
        const info = parseWav(multipart.subarray(start, start + size))!
        expect(info).toMatchObject({ sampleRate: 16000, channels: 1 })
        expect(info.peak).toBeGreaterThan(0.1)
        expect(Math.abs(info.durationMs - 1200)).toBeLessThan(100)
        return new Response(JSON.stringify({ transcript: 'synthetic format test result' }), { status: 200 })
      }) as unknown as typeof fetch
      const route = createTranscribeRoute({ env, fetchImpl, status: newSpeechStatus() })
      const clip = clips.find(c => c.name === name)!
      const result = await route(apiRequest(transcribeBody({ mimeType: clip.mime, durationMs: 1200 }, clip.bytes)))
      expect(result.status, JSON.stringify(result.json)).toBe(200)
      expect(result.json).toMatchObject({ source: 'meta', provider: 'meta-muse-voice-transcribe', transcript: 'synthetic format test result' })
      expect(calls.map(url => url.split('?')[0])).toEqual(['https://api.meta.ai/v1/asr/transcribe'])
    })
  }
})
