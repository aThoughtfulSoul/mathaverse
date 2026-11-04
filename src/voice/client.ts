// Push-to-talk lifecycle (WORKSPACE-AND-AI W7, MUSE-INTEGRATION-DESIGN "One request"): record -> release
// -> POST /api/transcribe -> a visible, correctable transcript -> the text is sent through the same
// typed request path as the Ask field (opts.submit, wired to AssistantClient.ask). Transcription and
// reasoning are separate stages with separate errors; nothing here changes the scene.
//
// One utterance at a time. Every start() and cancel() bumps a sequence number, so a late microphone
// grant, recorder flush or server response of an utterance that was canceled or replaced can never
// change state. cancel() works while the microphone is being requested, while recording (the audio is
// discarded, never uploaded), during transcription (the fetch is aborted, which kills the server's
// ffmpeg process or aborts its Meta call) and during the auto-submit window. Recording stops at
// maxMs and says so. The microphone is released as soon as each recording ends (no always-on listening).
//
// No fallback: a failed transcription (for example Meta speech-to-text answering 401, 429 or 504) is shown
// as the route's own error and status. This client never retries through another provider, browser speech
// recognition or a synthetic transcript; the typed Ask path stays available. Every utterance it records is
// a browser-microphone recording (`input` in its timing and history), unlike the test-uploaded synthesized
// recording of `zsh scripts/muse-live.sh speech`.
//
// inputLevel() reads the current recording's level (RMS of an AnalyserNode on the recording's own MediaStream,
// for the assistant orb). The analyser is built the first time the level is read during a recording, is never
// connected to an output (nothing is played back), and is closed with the recording; it never changes what is
// recorded, uploaded or sent.

import type { SpeechCapability } from '../../server/types'
import type { VoiceLine } from '../rendering/adapter'
import { TRANSCRIBE_LIMITS, TRANSCRIBE_MIME_TYPES, type TranscribeMimeType, type TranscribeRequest, type TranscribeResponse, VOICE_VOCABULARY, boundHints, isAcceptedMime, normalizeMime, parseTranscribeResponse } from './protocol'

export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'recording'; startedAt: number }
  /** limitReached: recording was stopped by the maxMs limit, not by the learner. */
  | { kind: 'transcribing'; requestId: string; durationMs: number; limitReached?: boolean }
  /** autoSubmitAt: when the transcript is sent unless cancel() or edit() happens first (XR); null waits for submit(). */
  | { kind: 'transcript'; text: string; response: TranscribeResponse; autoSubmitAt: number | null; limitReached?: boolean }
  | { kind: 'submitted'; text: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'canceled' }

export interface VoiceClientOptions {
  /** Sends the final text as the learner's request (AssistantClient.ask). */
  submit: (text: string) => unknown
  /** Vocabulary hints such as the displayed labels (merged with VOICE_VOCABULARY, bounded to 40). */
  hints?: () => string[]
  fetch?: typeof fetch
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
  Recorder?: typeof MediaRecorder
  /** Recording limit (default 15 s, at most 30 s). */
  maxMs?: number
  now?: () => number
  endpoint?: string
  /** Web Audio for inputLevel() (default: the browser's AudioContext; null: no level, inputLevel() stays 0). */
  AudioContext?: (new () => AudioContext) | null
}

/** Where the audio of an utterance came from: this client only ever records the browser microphone. */
export const MICROPHONE_INPUT = 'browser-microphone' as const

/** Client-side timing of one utterance (application events, not provider claims). */
export interface VoiceTiming {
  requestId: string
  input: typeof MICROPHONE_INPUT
  /** The transcript's provenance, from the route's response (source 'meta' only for a real Meta call). */
  source: TranscribeResponse['source']
  provider: string
  model: string
  /** The audio track's label as the browser reports it (empty when it hides it). A Chrome fake capture device
   *  (used by scripts/voice-chain.sh) reports its own label, so such a run is never mistaken for a microphone. */
  inputDevice: string
  recordedMs: number
  /** Speech release (stop or the limit) -> transcript shown. */
  releaseToTranscriptMs: number
  /** Server-reported provider and route times. */
  providerMs: number
  serverTotalMs: number
  audioMs: number
  uploadBytes: number
}

export const DEFAULT_MAX_MS = 15_000

/** inputLevel() = min(1, RMS x LEVEL_GAIN) of the recording's samples (speech RMS is about 0.02-0.2). */
export const LEVEL_GAIN = 6
const LEVEL_FFT = 1024

/** The read-only level analyser of one recording (source -> analyser; never connected to an output). */
interface LevelMeter {
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  analyser: AnalyserNode
  buf: Float32Array<ArrayBuffer>
}

interface Recording {
  recorder: MediaRecorder
  stream: MediaStream
  mime: TranscribeMimeType
  chunks: Blob[]
  startedAt: number
  releasedAt: number
  autoSubmitMs: number | undefined
  limitTimer: ReturnType<typeof setTimeout> | null
  requestId: string | null
  stopping: boolean
  limitReached: boolean
  discard: boolean
  /** The level analyser (built on the first inputLevel() read; closed with the recording). */
  meter: LevelMeter | null
  /** The analyser was built, failed or was closed: it is not built again for this recording. */
  meterTried: boolean
}

const MIC_CONSTRAINTS: MediaStreamConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }

function stopTracks(stream: MediaStream | null | undefined): void {
  try {
    stream?.getTracks().forEach((t) => t.stop())
  } catch {
    /* a fake or already-ended stream */
  }
}

function closeContext(ctx: AudioContext): void {
  try {
    void Promise.resolve(ctx.close()).catch(() => undefined)
  } catch {
    /* already closed */
  }
}

/** Disconnect and close a recording's level analyser (idempotent). */
function closeMeter(rec: Recording): void {
  rec.meterTried = true
  const m = rec.meter
  rec.meter = null
  if (!m) return
  try {
    m.source.disconnect()
  } catch {
    /* already disconnected */
  }
  try {
    m.analyser.disconnect()
  } catch {
    /* already disconnected */
  }
  closeContext(m.ctx)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function micError(e: unknown): { code: string; message: string; permanent: boolean } {
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return { code: 'mic_denied', message: 'Microphone access was denied. Allow it in the browser site settings, or type the request instead.', permanent: false }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return { code: 'mic_unavailable', message: 'No microphone was found. Type the request instead.', permanent: false }
  if (name === 'NotReadableError' || name === 'AbortError') return { code: 'mic_busy', message: 'The microphone could not be started (it may be in use elsewhere). Try again or type the request.', permanent: false }
  return { code: 'mic_error', message: 'The microphone could not be opened. Type the request instead.', permanent: false }
}

export class VoiceClient {
  state: VoiceState = { kind: 'idle' }
  /** True while the microphone is being requested (the browser may be showing its permission prompt). */
  acquiring = false
  lastTiming: VoiceTiming | null = null
  /** Recent utterances (application events, for evidence and timing). */
  readonly history: { requestId: string | null; outcome: string; recordedMs: number | null; releaseToTranscriptMs: number | null; providerMs: number | null; input?: typeof MICROPHONE_INPUT; source?: TranscribeResponse['source']; model?: string }[] = []

  private readonly listeners = new Set<(s: VoiceState) => void>()
  private readonly fetchImpl: typeof fetch | null
  private readonly getUserMedia: ((c: MediaStreamConstraints) => Promise<MediaStream>) | null
  private readonly Recorder: typeof MediaRecorder | null
  private readonly AudioCtor: (new () => AudioContext) | null
  private readonly maxMs: number
  private readonly now: () => number
  private readonly endpoint: string
  private readonly browserProblem: string | null
  private capability: SpeechCapability | null = null
  private seq = 0
  private rec: Recording | null = null
  private upload: { requestId: string; abort: AbortController } | null = null
  private autoTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(private readonly opts: VoiceClientOptions) {
    const nav = (globalThis as { navigator?: Navigator }).navigator
    this.fetchImpl = opts.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null)
    this.getUserMedia = opts.getUserMedia ?? (nav?.mediaDevices?.getUserMedia ? (c) => nav.mediaDevices.getUserMedia(c) : null)
    this.Recorder = opts.Recorder ?? ((globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder ?? null)
    const g = globalThis as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext }
    this.AudioCtor = opts.AudioContext !== undefined ? opts.AudioContext : (g.AudioContext ?? g.webkitAudioContext ?? null)
    this.maxMs = Math.min(Math.max(opts.maxMs ?? DEFAULT_MAX_MS, 1000), TRANSCRIBE_LIMITS.maxDurationMs)
    this.now = opts.now ?? (() => performance.now())
    this.endpoint = opts.endpoint ?? '/api/transcribe'
    this.browserProblem =
      !this.getUserMedia ? 'this browser does not offer microphone access here (it needs a secure context: HTTPS or localhost)'
      : !this.Recorder ? 'this browser cannot record audio (no MediaRecorder)'
      : !this.fetchImpl ? 'this page cannot reach the speech service'
      : null
    if (this.browserProblem) this.state = { kind: 'unavailable', reason: this.browserProblem }
  }

  subscribe(fn: (s: VoiceState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(s: VoiceState): void {
    if (this.disposed) return
    this.state = s
    this.listeners.forEach((fn) => fn(s))
  }

  private emit(): void {
    this.set(this.state)
  }

  private log(outcome: string, extra: Partial<VoiceClient['history'][number]> = {}): void {
    this.history.push({ requestId: null, recordedMs: null, releaseToTranscriptMs: null, providerMs: null, ...extra, outcome })
    if (this.history.length > 30) this.history.shift()
  }

  /** The recording format: the first type the server accepts that this browser's recorder can produce. */
  pickMime(): TranscribeMimeType | null {
    const R = this.Recorder
    if (!R) return null
    const offered = (this.capability?.acceptedMimeTypes ?? [...TRANSCRIBE_MIME_TYPES]).filter(isAcceptedMime).map((m) => normalizeMime(m) as TranscribeMimeType)
    const can = (t: string) => {
      try {
        return typeof R.isTypeSupported === 'function' ? R.isTypeSupported(t) : false
      } catch {
        return false
      }
    }
    return offered.find(can) ?? null
  }

  /** From GET /api/capabilities `speech` (null: the status could not be loaded). */
  setCapability(c: SpeechCapability | null): void {
    this.capability = c
    if (this.browserProblem) return
    const reason =
      c === null ? 'the speech service status could not be loaded'
      : c.mode === 'unavailable' ? (c.problem ?? 'speech is not configured on the server')
      : !this.pickMime() ? 'this browser cannot record any format the speech service accepts'
      : null
    if (reason) {
      if (this.busy) this.cancel()
      this.set({ kind: 'unavailable', reason })
    } else if (this.state.kind === 'unavailable') {
      this.set({ kind: 'idle' })
    }
  }

  /** The last capability passed to setCapability (null: unknown or not loaded). */
  get speechCapability(): SpeechCapability | null {
    return this.capability
  }

  /** Microphone, recorder or upload in progress. */
  get busy(): boolean {
    return this.acquiring || this.rec !== null || this.upload !== null || this.state.kind === 'transcribing'
  }

  /** Push-to-talk press: request the microphone (first use shows the browser prompt) and record. */
  start(): Promise<void> {
    return this.begin(undefined)
  }

  private async begin(autoSubmitMs: number | undefined): Promise<void> {
    if (this.disposed || this.state.kind === 'unavailable' || this.acquiring || this.rec) return
    this.clearPending()
    const mime = this.pickMime()
    if (!mime) {
      this.set({ kind: 'unavailable', reason: 'this browser cannot record any format the speech service accepts' })
      return
    }
    const mine = ++this.seq
    this.acquiring = true
    this.emit()
    let stream: MediaStream
    try {
      stream = await this.getUserMedia!(MIC_CONSTRAINTS)
    } catch (e) {
      if (mine !== this.seq) return
      this.acquiring = false
      const m = micError(e)
      this.log(m.code)
      this.set({ kind: 'error', code: m.code, message: m.message })
      return
    }
    if (mine !== this.seq || this.disposed) {
      stopTracks(stream) // canceled or released while the microphone was being granted
      return
    }
    this.acquiring = false
    let recorder: MediaRecorder
    try {
      recorder = new this.Recorder!(stream, { mimeType: mime, audioBitsPerSecond: 32_000 })
    } catch {
      stopTracks(stream)
      this.log('recorder_error')
      this.set({ kind: 'error', code: 'recorder_error', message: `This browser could not start recording ${mime}. Type the request instead.` })
      return
    }
    const rec: Recording = { recorder, stream, mime, chunks: [], startedAt: 0, releasedAt: 0, autoSubmitMs, limitTimer: null, requestId: null, stopping: false, limitReached: false, discard: false, meter: null, meterTried: false }
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) rec.chunks.push(ev.data)
    }
    recorder.onstop = () => void this.finishRecording(rec)
    recorder.onerror = () => {
      if (rec.discard || this.rec !== rec) return
      this.dropRecording(rec)
      this.log('recorder_error')
      this.set({ kind: 'error', code: 'recorder_error', message: 'Recording failed. Try again or type the request.' })
    }
    try {
      recorder.start()
    } catch {
      stopTracks(stream)
      this.log('recorder_error')
      this.set({ kind: 'error', code: 'recorder_error', message: 'Recording could not start. Try again or type the request.' })
      return
    }
    rec.startedAt = this.now()
    rec.limitTimer = setTimeout(() => this.stopRecording(rec, true), this.maxMs)
    this.rec = rec
    this.set({ kind: 'recording', startedAt: rec.startedAt })
  }

  /** Push-to-talk release: stop recording and transcribe. */
  stop(): void {
    if (this.acquiring) {
      // Released before the microphone was ready (often: the permission prompt was showing).
      this.seq++
      this.acquiring = false
      this.log('released before the microphone was ready')
      this.set({ kind: 'error', code: 'too_short', message: 'Released before the microphone was ready. Press Talk again to speak.' })
      return
    }
    if (this.rec) this.stopRecording(this.rec, false)
  }

  private stopRecording(rec: Recording, limit: boolean): void {
    if (rec.stopping || rec.discard) return
    rec.stopping = true
    rec.limitReached = limit
    rec.releasedAt = this.now()
    if (rec.limitTimer) clearTimeout(rec.limitTimer)
    rec.requestId = crypto.randomUUID()
    const durationMs = Math.round(rec.releasedAt - rec.startedAt)
    this.set(limit ? { kind: 'transcribing', requestId: rec.requestId, durationMs, limitReached: true } : { kind: 'transcribing', requestId: rec.requestId, durationMs })
    try {
      rec.recorder.stop() // flushes dataavailable, then onstop -> finishRecording
    } catch {
      void this.finishRecording(rec)
    }
  }

  private dropRecording(rec: Recording): void {
    rec.discard = true
    if (rec.limitTimer) clearTimeout(rec.limitTimer)
    try {
      if (rec.recorder.state !== 'inactive') rec.recorder.stop()
    } catch {
      /* already stopped */
    }
    stopTracks(rec.stream)
    closeMeter(rec)
    if (this.rec === rec) this.rec = null
  }

  private async finishRecording(rec: Recording): Promise<void> {
    stopTracks(rec.stream)
    closeMeter(rec)
    if (this.rec === rec) this.rec = null
    if (rec.discard) return
    if (!rec.requestId) {
      // The recorder ended on its own (the microphone track ended or was revoked).
      if (rec.limitTimer) clearTimeout(rec.limitTimer)
      this.log('recorder_stopped')
      this.set({ kind: 'error', code: 'recorder_error', message: 'Recording stopped unexpectedly (the microphone was disconnected or blocked). Try again or type the request.' })
      return
    }
    const mine = this.seq
    const requestId = rec.requestId
    const recordedMs = Math.round(rec.releasedAt - rec.startedAt)
    const blob = new Blob(rec.chunks, { type: rec.mime })
    if (recordedMs < TRANSCRIBE_LIMITS.minDurationMs || blob.size === 0) {
      this.log('too_short', { requestId, recordedMs })
      this.set({ kind: 'error', code: 'too_short', message: 'That recording was too short. Hold Talk while you speak, or press it once to start and again to stop.' })
      return
    }
    const audioBase64 = await blobToBase64(blob)
    if (mine !== this.seq) return
    if (audioBase64.length > TRANSCRIBE_LIMITS.maxAudioBase64) {
      this.log('audio_too_large', { requestId, recordedMs })
      this.set({ kind: 'error', code: 'audio_too_long', message: 'That recording is too large to send. Try a shorter request.' })
      return
    }
    const body: TranscribeRequest = {
      requestId,
      mimeType: rec.mime,
      audioBase64,
      durationMs: recordedMs,
      hints: boundHints([...(this.opts.hints?.() ?? []), ...VOICE_VOCABULARY]),
    }
    const abort = new AbortController()
    this.upload = { requestId, abort }
    let res: Response
    let json: unknown = null
    try {
      res = await this.fetchImpl!(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal })
      try {
        json = await res.json()
      } catch {
        json = null
      }
    } catch {
      if (mine !== this.seq || this.upload?.requestId !== requestId) return
      this.upload = null
      this.log('network', { requestId, recordedMs })
      this.set({ kind: 'error', code: 'network', message: 'The speech service could not be reached. Try again or type the request.' })
      return
    }
    // Canceled, superseded or disposed while the request ran: this response is ignored.
    if (mine !== this.seq || this.upload?.requestId !== requestId) return
    this.upload = null
    if (!res.ok) {
      // The route's own error, shown as it is (it names the provider's HTTP status). No other provider is tried.
      const err = (json ?? {}) as { code?: unknown; message?: unknown }
      const code = typeof err.code === 'string' ? err.code : `http_${res.status}`
      const message = typeof err.message === 'string' ? err.message : `The speech service answered HTTP ${res.status}. Type the request instead.`
      this.log(code, { requestId, recordedMs, input: MICROPHONE_INPUT })
      this.set({ kind: 'error', code, message })
      return
    }
    const response = parseTranscribeResponse(json, requestId)
    if (!response) {
      this.log('invalid_response', { requestId, recordedMs })
      this.set({ kind: 'error', code: 'invalid_response', message: 'The speech service returned an unexpected response. Try again or type the request.' })
      return
    }
    const shownAt = this.now()
    this.lastTiming = {
      requestId,
      input: MICROPHONE_INPUT,
      source: response.source,
      provider: response.provider,
      model: response.model,
      inputDevice: rec.stream.getAudioTracks?.()[0]?.label ?? '',
      recordedMs,
      releaseToTranscriptMs: Math.round(shownAt - rec.releasedAt),
      providerMs: response.timing.providerMs,
      serverTotalMs: response.timing.totalMs,
      audioMs: response.timing.audioMs,
      uploadBytes: audioBase64.length,
    }
    this.log('transcript', { requestId, recordedMs, releaseToTranscriptMs: this.lastTiming.releaseToTranscriptMs, providerMs: response.timing.providerMs, input: MICROPHONE_INPUT, source: response.source, model: response.model })
    const autoSubmitAt = rec.autoSubmitMs !== undefined ? shownAt + rec.autoSubmitMs : null
    const s: VoiceState = { kind: 'transcript', text: response.transcript, response, autoSubmitAt }
    this.set(rec.limitReached ? { ...s, limitReached: true } : s)
    if (rec.autoSubmitMs !== undefined) this.autoTimer = setTimeout(() => this.submit(), rec.autoSubmitMs)
  }

  /** The learner corrected the transcript: no auto-submission; the edited text waits for submit(). */
  edit(text: string): void {
    const s = this.state
    if (s.kind !== 'transcript') return
    this.clearAuto()
    this.set({ ...s, text, autoSubmitAt: null })
  }

  /**
   * Send the transcript (or the corrected text) as the learner's request. Ignored while recording or
   * transcribing; an empty text sends nothing.
   */
  submit(text?: string): void {
    if (this.disposed || this.acquiring || this.rec || this.upload) return
    const s = this.state
    const raw = text ?? (s.kind === 'transcript' ? s.text : null)
    const final = raw?.trim() ?? ''
    if (!final) return
    this.clearAuto()
    const corrected = s.kind === 'transcript' && final !== s.response.transcript.trim()
    this.log(corrected ? 'submitted (corrected)' : 'submitted', { requestId: s.kind === 'transcript' ? s.response.requestId : null })
    this.set({ kind: 'submitted', text: final })
    try {
      void Promise.resolve(this.opts.submit(final)).catch(() => undefined)
    } catch {
      /* the assistant client reports its own errors */
    }
  }

  /** Cancel whatever is in progress; nothing of this utterance is uploaded, applied or sent afterwards. */
  cancel(): void {
    if (this.disposed) return
    this.seq++
    const was = this.state.kind
    const active = this.acquiring || this.rec !== null || this.upload !== null || was === 'transcribing' || was === 'transcript'
    this.clearAuto()
    this.acquiring = false
    if (this.rec) this.dropRecording(this.rec)
    if (this.upload) {
      this.upload.abort.abort(new Error('canceled'))
      this.upload = null
    }
    if (active) {
      this.log(`canceled while ${was === 'idle' ? 'requesting the microphone' : was}`)
      this.set({ kind: 'canceled' })
    }
  }

  /**
   * One control for XR (no keyboard): press to start, press to stop; while transcribing or inside the
   * auto-submit window, press to cancel. With autoSubmitMs the transcript is sent after that delay.
   */
  toggle(opts: { autoSubmitMs?: number } = {}): void {
    const s = this.state
    if (s.kind === 'unavailable') return
    if (s.kind === 'recording') return this.stop()
    if (this.acquiring || s.kind === 'transcribing' || (s.kind === 'transcript' && s.autoSubmitAt !== null)) return this.cancel()
    void this.begin(opts.autoSubmitMs === undefined ? undefined : Math.max(0, opts.autoSubmitMs))
  }

  /**
   * Ask for microphone permission without recording (for example from the 2D page before entering VR,
   * so the browser prompt does not have to appear inside the immersive session). Releases it at once.
   */
  async requestMicrophone(): Promise<boolean> {
    if (!this.getUserMedia || this.disposed) return false
    try {
      stopTracks(await this.getUserMedia(MIC_CONSTRAINTS))
      return true
    } catch (e) {
      const m = micError(e)
      if (!this.busy) this.set({ kind: 'error', code: m.code, message: m.message })
      return false
    }
  }

  /**
   * The current recording's input level, 0..1: min(1, RMS x LEVEL_GAIN) of the latest LEVEL_FFT samples of the
   * recording's own microphone stream. 0 when not recording (idle, requesting the microphone, after release) or
   * when this browser has no Web Audio. Read-only for the recording: nothing is recorded, sent or played back.
   */
  inputLevel(): number {
    const rec = this.rec
    if (this.disposed || !rec || rec.stopping || rec.discard || this.state.kind !== 'recording') return 0
    if (!rec.meterTried) {
      rec.meterTried = true
      rec.meter = this.openMeter(rec.stream)
    }
    const m = rec.meter
    if (!m) return 0
    try {
      m.analyser.getFloatTimeDomainData(m.buf)
      const b = m.buf
      let sum = 0
      for (let i = 0; i < b.length; i++) sum += b[i]! * b[i]!
      const level = Math.sqrt(sum / b.length) * LEVEL_GAIN
      return Number.isFinite(level) ? Math.min(1, level) : 0
    } catch {
      return 0
    }
  }

  private openMeter(stream: MediaStream): LevelMeter | null {
    const Ctor = this.AudioCtor
    if (!Ctor) return null
    let ctx: AudioContext | null = null
    try {
      ctx = new Ctor()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = LEVEL_FFT
      source.connect(analyser) // never to ctx.destination: nothing is played back
      if (ctx.state === 'suspended') void Promise.resolve(ctx.resume()).catch(() => undefined)
      return { ctx, source, analyser, buf: new Float32Array(analyser.fftSize) }
    } catch {
      if (ctx) closeContext(ctx)
      return null
    }
  }

  dispose(): void {
    this.cancel()
    this.disposed = true
    this.listeners.clear()
  }

  private clearAuto(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoTimer = null
  }

  /** A new utterance replaces an unsent transcript or a running transcription. */
  private clearPending(): void {
    this.clearAuto()
    if (this.upload) {
      this.seq++
      this.upload.abort.abort(new Error('superseded'))
      this.upload = null
    }
  }
}

/** Speech provenance stays separate from the assistant reasoning response. */
export function transcriptSource(r: TranscribeResponse): string {
  return `Meta speech-to-text transcription (${r.model})`
}

const quote = (t: string, n = 110) => `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"`

/** The in-scene caption for a voice state (application events only). */
export function captionFor(s: VoiceState): VoiceLine | null {
  switch (s.kind) {
    case 'recording':
      return { text: 'Listening… press Talk to stop', state: 'recording' }
    case 'transcribing':
      return { text: s.limitReached ? 'Transcribing… (stopped at the recording limit)' : 'Transcribing…', state: 'pending' }
    case 'transcript':
      return { text: `You said: ${quote(s.text)}${s.autoSubmitAt !== null ? ' · sending, press Cancel to stop' : ' · edit or send'}`, state: 'transcript' }
    case 'submitted':
      return { text: `You said: ${quote(s.text)}`, state: 'transcript' }
    case 'error':
      return { text: `Voice: ${s.message}`, state: 'error' }
    case 'unavailable':
      return { text: `Speech unavailable: ${s.reason}`, state: 'error' }
    case 'canceled':
      // In XR there is no panel: say that the cancel worked rather than just removing the caption.
      return { text: 'Canceled: nothing was sent', state: 'transcript' }
    default:
      return null
  }
}

/**
 * The XR Talk control's label for a state (one of the control texts the app prepares). It names what
 * toggle() does next; pass client.acquiring, during which a press cancels the microphone request.
 */
export function talkLabelFor(s: VoiceState, acquiring = false): 'Talk' | 'Stop' | 'Cancel' | 'No voice' {
  if (s.kind === 'unavailable') return 'No voice'
  if (s.kind === 'recording') return 'Stop'
  if (acquiring || s.kind === 'transcribing' || (s.kind === 'transcript' && s.autoSubmitAt !== null)) return 'Cancel'
  return 'Talk'
}
