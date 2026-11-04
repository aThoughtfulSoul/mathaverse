// Shared helpers for the speech route tests. Audio here is generated (tones, silence) or synthesized
// with macOS `say`; it is never a recording of a person. Providers are fakes unless a test says otherwise.

import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Converter } from '../../server/speech/index'
import type { Probe } from '../../server/speech/config'
import type { SpeechProvider } from '../../server/speech/provider'
import type { ApiRequest } from '../../server/types'
import type { TranscribeRequest } from '../../src/voice/protocol'

/** A 16 kHz mono 16-bit WAV of a tone (amplitude 0 = silence). */
export function toneWav(ms: number, amplitude = 0.3, rate = 16000): Buffer {
  const n = Math.round((ms / 1000) * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + n * 2, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amplitude * 32767), 44 + i * 2)
  return b
}

/** Bytes with a WebM (EBML) signature: the fake converter never decodes them. */
export const WEBM_BYTES = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(100).fill(1)])
export const OGG_BYTES = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, 2)])

export function transcribeBody(over: Partial<TranscribeRequest> = {}, bytes: Buffer = WEBM_BYTES): TranscribeRequest {
  return { requestId: `req-${randomUUID()}`, mimeType: 'audio/webm;codecs=opus', audioBase64: bytes.toString('base64'), durationMs: 1200, hints: ['rotate', 'reflect'], ...over }
}

export function apiRequest(body: unknown, signal: AbortSignal = new AbortController().signal, method = 'POST'): ApiRequest {
  return { method, path: '/api/transcribe', body, signal }
}

/** Every path exists: configuration resolves without touching this machine. */
export const ALL_PRESENT: Probe = { isExecutable: () => true }
// Synthetic credentials used only with injected providers or a mocked Meta fetch.
export const TEST_META_ENV = { SPEECH_PROVIDER: 'meta', META_API_KEY: 'synthetic-test-key', FFMPEG_BIN: '/fake/bin/ffmpeg' }

/** A converter that writes `wav` into the request's temp directory, remembering the directories it saw. */
export function fakeConverter(wav: Buffer | (() => Buffer) = toneWav(1200)) {
  const dirs: string[] = []
  const convert: Converter = async ({ dir }) => {
    dirs.push(dir)
    const p = join(dir, 'audio.wav')
    await writeFile(p, typeof wav === 'function' ? wav() : wav)
    return p
  }
  return { convert, dirs }
}

/** A provider that answers `text`, throws `error`, or waits for its signal. */
export function fakeProvider(behaviour: { text?: string; error?: Error; hang?: boolean } = { text: 'reverse the order on the left' }) {
  const calls: { hints: string[]; requestId: string; signal: AbortSignal; wavBytes: number }[] = []
  const provider: SpeechProvider = {
    source: 'meta',
    provider: 'fake-test-provider',
    model: 'fake',
    async transcribe(input) {
      calls.push({ hints: input.hints, requestId: input.requestId, signal: input.signal, wavBytes: input.wav.length })
      if (behaviour.hang) {
        await new Promise<void>((_, reject) => input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      }
      if (behaviour.error) throw behaviour.error
      return behaviour.text ?? ''
    },
  }
  return { provider: () => provider, calls }
}
