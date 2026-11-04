// Test doubles for the browser voice client: a fake MediaRecorder / MediaStream / getUserMedia and a
// controllable fetch. Every transcript produced here is SYNTHETIC test data, never provider output.

import type { SpeechCapability } from '../../server/types'
import { TRANSCRIBE_MIME_TYPES, type TranscribeRequest, type TranscribeResponse } from '../../src/voice/protocol'

export class FakeTrack {
  stopped = false
  stop(): void {
    this.stopped = true
  }
}

export class FakeStream {
  readonly tracks = [new FakeTrack()]
  getTracks(): FakeTrack[] {
    return this.tracks
  }
  get released(): boolean {
    return this.tracks.every((t) => t.stopped)
  }
}

/** Records the instances it creates; supports a configurable set of MIME types. */
export class FakeRecorder {
  static supported = new Set<string>(['audio/webm;codecs=opus', 'audio/webm'])
  static instances: FakeRecorder[] = []
  static isTypeSupported(t: string): boolean {
    return FakeRecorder.supported.has(t)
  }
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((ev: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  /** Bytes the next stop() delivers (a WebM signature followed by filler). */
  payload: Uint8Array = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(7)])
  constructor(readonly stream: FakeStream, readonly options: { mimeType: string }) {
    FakeRecorder.instances.push(this)
  }
  start(): void {
    this.state = 'recording'
  }
  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    // Browsers deliver the final dataavailable and then stop, asynchronously.
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob([this.payload], { type: this.options.mimeType }) })
      this.onstop?.()
    })
  }
  /** The microphone track ended on its own. */
  endUnexpectedly(): void {
    this.state = 'inactive'
    queueMicrotask(() => this.onstop?.())
  }
}

export function fakeMedia(opts: { deny?: string } = {}) {
  const streams: FakeStream[] = []
  let gate: { resolve: () => void } | null = null
  let hold = false
  const getUserMedia = async (): Promise<MediaStream> => {
    if (hold) await new Promise<void>((r) => (gate = { resolve: r }))
    if (opts.deny) throw Object.assign(new Error('denied'), { name: opts.deny })
    const s = new FakeStream()
    streams.push(s)
    return s as unknown as MediaStream
  }
  return {
    getUserMedia,
    streams,
    /** Make the next getUserMedia wait (the permission prompt is showing) until grant(). */
    holdNext: () => (hold = true),
    grant: () => {
      hold = false
      gate?.resolve()
    },
  }
}

interface Call {
  url: string
  body: TranscribeRequest
  signal: AbortSignal
}

/** A fetch whose replies the test controls; replies can be held until release(). */
export function controlledFetch() {
  const calls: Call[] = []
  const waiters: { call: Call; resolve: (r: Response) => void; reject: (e: unknown) => void }[] = []
  const fetchImpl = ((url: string, init: RequestInit) => {
    const call: Call = { url, body: JSON.parse(String(init.body)) as TranscribeRequest, signal: init.signal! }
    calls.push(call)
    return new Promise<Response>((resolve, reject) => {
      waiters.push({ call, resolve, reject })
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
  }) as unknown as typeof fetch
  return {
    fetchImpl,
    calls,
    /** Answer the oldest held call with a synthetic transcript (or an error body). */
    reply(transcript: string, over: Partial<TranscribeResponse> = {}) {
      const w = waiters.shift()!
      const body: TranscribeResponse = { requestId: w.call.body.requestId, transcript, source: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', timing: { audioMs: 1200, providerMs: 210, totalMs: 260 }, ...over }
      w.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    },
    replyError(status: number, code: string, message: string) {
      const w = waiters.shift()!
      w.resolve(new Response(JSON.stringify({ code, message, retryable: false }), { status, headers: { 'content-type': 'application/json' } }))
    },
    get held() {
      return waiters.length
    },
  }
}

export const META_CAPABILITY: SpeechCapability = { configured: true, liveValidated: false, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', acceptedMimeTypes: [...TRANSCRIBE_MIME_TYPES], problem: null }

/** Let queued microtasks and resolved promises run (setImmediate is not faked by the timer tests). */
export async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise<void>((r) => setImmediate(r))
}
