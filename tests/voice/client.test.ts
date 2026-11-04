// VoiceClient state machine with a fake MediaRecorder, getUserMedia and fetch. Transcripts here are
// SYNTHETIC test replies, not provider output.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceClient, type VoiceState, captionFor, talkLabelFor } from '../../src/voice/client'
import { TRANSCRIBE_MIME_TYPES, VOICE_VOCABULARY } from '../../src/voice/protocol'
import { FakeRecorder, META_CAPABILITY, controlledFetch, fakeMedia, flush } from './fakes'

let clock = 0
const now = () => clock

function setup(opts: { deny?: string; maxMs?: number; hints?: () => string[] } = {}) {
  const media = fakeMedia({ deny: opts.deny })
  const net = controlledFetch()
  const submitted: string[] = []
  const client = new VoiceClient({
    submit: (t) => submitted.push(t),
    hints: opts.hints,
    fetch: net.fetchImpl,
    getUserMedia: media.getUserMedia,
    Recorder: FakeRecorder as unknown as typeof MediaRecorder,
    maxMs: opts.maxMs,
    now,
  })
  client.setCapability(META_CAPABILITY)
  const states: VoiceState['kind'][] = []
  client.subscribe((s) => states.push(s.kind))
  return { client, media, net, submitted, states }
}

/** Start, wait for the recorder, advance the clock, release, and wait for the upload. */
async function speak(c: VoiceClient, ms = 1500) {
  await c.start()
  clock += ms
  c.stop()
  await flush()
}

beforeEach(() => {
  clock = 1000
  FakeRecorder.instances = []
  FakeRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/webm'])
})
afterEach(() => vi.useRealTimers())

describe('push-to-talk happy path', () => {
  it('record -> release -> transcribe -> editable transcript -> submit through the typed path', async () => {
    const { client, net, submitted, media } = setup({ hints: () => ['R', 'S', 'order'] })
    await client.start()
    expect(client.state).toEqual({ kind: 'recording', startedAt: 1000 })
    expect(FakeRecorder.instances[0]!.options.mimeType).toBe('audio/webm;codecs=opus')
    clock += 1500
    client.stop()
    expect(client.state.kind).toBe('transcribing')
    await flush()
    expect(media.streams[0]!.released).toBe(true) // the microphone is released at the end of the recording
    expect(net.calls).toHaveLength(1)
    const req = net.calls[0]!.body
    expect(Object.keys(req).sort()).toEqual(['audioBase64', 'durationMs', 'hints', 'mimeType', 'requestId'])
    expect(req.mimeType).toBe('audio/webm;codecs=opus')
    expect(req.durationMs).toBe(1500)
    expect(req.hints.slice(0, 3)).toEqual(['R', 'S', 'order']) // displayed labels first, then the vocabulary
    expect(req.hints.length).toBeLessThanOrEqual(40)
    expect(req.hints).toContain(VOICE_VOCABULARY[0])
    expect(Buffer.from(req.audioBase64, 'base64').subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    clock += 400
    net.reply('Reverse the order on the left.')
    await flush()
    expect(client.state).toMatchObject({ kind: 'transcript', text: 'Reverse the order on the left.', autoSubmitAt: null })
    expect(client.lastTiming).toMatchObject({ releaseToTranscriptMs: 400, providerMs: 210, serverTotalMs: 260, recordedMs: 1500 })
    expect(submitted).toEqual([]) // desktop: waits for Send
    client.submit()
    expect(submitted).toEqual(['Reverse the order on the left.'])
    expect(client.state).toEqual({ kind: 'submitted', text: 'Reverse the order on the left.' })
  })

  it('a corrected transcript is what gets submitted', async () => {
    const { client, net, submitted } = setup()
    await speak(client)
    net.reply('Reverse the order on the lift')
    await flush()
    client.edit('Reverse the order on the left')
    client.submit('Reverse the order on the left')
    expect(submitted).toEqual(['Reverse the order on the left'])
    expect(client.history.at(-1)!.outcome).toBe('submitted (corrected)')
  })

  it('an empty correction sends nothing', async () => {
    const { client, net, submitted } = setup()
    await speak(client)
    net.reply('hello')
    await flush()
    client.submit('   ')
    expect(submitted).toEqual([])
    expect(client.state.kind).toBe('transcript')
  })
})

describe('cancel at each stage', () => {
  it('before upload: while the microphone permission is pending, nothing records', async () => {
    const { client, media, net } = setup()
    media.holdNext()
    const p = client.start()
    expect(client.acquiring).toBe(true)
    expect(talkLabelFor(client.state, client.acquiring)).toBe('Cancel')
    client.cancel()
    expect(client.state.kind).toBe('canceled')
    media.grant()
    await p
    await flush()
    expect(FakeRecorder.instances).toHaveLength(0)
    expect(media.streams[0]!.released).toBe(true) // the late grant is released immediately
    expect(net.calls).toHaveLength(0)
  })

  it('while recording: the audio is discarded, never uploaded', async () => {
    const { client, net, media } = setup()
    await client.start()
    clock += 2000
    client.cancel()
    await flush()
    expect(client.state.kind).toBe('canceled')
    expect(net.calls).toHaveLength(0)
    expect(media.streams[0]!.released).toBe(true)
  })

  it('during transcription: the fetch is aborted and a late response is ignored', async () => {
    const { client, net, submitted } = setup()
    await speak(client)
    expect(net.calls).toHaveLength(1)
    client.cancel()
    expect(net.calls[0]!.signal.aborted).toBe(true)
    expect(client.state.kind).toBe('canceled')
    await flush()
    expect(client.state.kind).toBe('canceled')
    expect(submitted).toEqual([])
  })

  it('a stale response for a canceled utterance never changes a newer one', async () => {
    const { client, net } = setup()
    const f = net.fetchImpl
    // A fetch that ignores abort, so the first reply really arrives late.
    let resolveFirst!: (r: Response) => void
    const lateFetch = vi.fn((url: string, init: RequestInit) => {
      if (lateFetch.mock.calls.length === 1) {
        return new Promise<Response>((r) => (resolveFirst = r))
      }
      return f(url, init)
    })
    const c2 = new VoiceClient({ submit: () => undefined, fetch: lateFetch as unknown as typeof fetch, getUserMedia: fakeMedia().getUserMedia, Recorder: FakeRecorder as unknown as typeof MediaRecorder, now })
    c2.setCapability(META_CAPABILITY)
    await speak(c2)
    const firstId = JSON.parse(String(lateFetch.mock.calls[0]![1].body)).requestId as string
    c2.cancel()
    await speak(c2) // second utterance, now waiting on net
    resolveFirst(new Response(JSON.stringify({ requestId: firstId, transcript: 'STALE', source: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', timing: { audioMs: 1, providerMs: 1, totalMs: 1 } }), { status: 200 }))
    await flush()
    expect(c2.state.kind).toBe('transcribing')
    net.reply('fresh')
    await flush()
    expect(c2.state).toMatchObject({ kind: 'transcript', text: 'fresh' })
    void client
  })

  it('a response echoing another request ID is rejected', async () => {
    const { client, net } = setup()
    await speak(client)
    net.reply('x', { requestId: 'someone-else' })
    await flush()
    expect(client.state).toMatchObject({ kind: 'error', code: 'invalid_response' })
  })
})

describe('XR toggle with an auto-submit window', () => {
  it('press, press again, then the transcript is sent after the window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client, net, submitted } = setup()
    client.toggle({ autoSubmitMs: 2500 })
    await flush()
    expect(client.state.kind).toBe('recording')
    expect(talkLabelFor(client.state)).toBe('Stop')
    clock += 1200
    client.toggle({ autoSubmitMs: 2500 })
    expect(talkLabelFor(client.state)).toBe('Cancel')
    await flush()
    net.reply('Replay the comparison')
    await flush()
    expect(client.state).toMatchObject({ kind: 'transcript', autoSubmitAt: clock + 2500 })
    expect(captionFor(client.state)!.text).toContain('sending, press Cancel to stop')
    expect(talkLabelFor(client.state)).toBe('Cancel')
    vi.advanceTimersByTime(2499)
    expect(submitted).toEqual([])
    vi.advanceTimersByTime(1)
    expect(submitted).toEqual(['Replay the comparison'])
    expect(talkLabelFor(client.state)).toBe('Talk')
  })

  it('pressing Talk inside the window cancels the submission', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client, net, submitted } = setup()
    client.toggle({ autoSubmitMs: 2500 })
    await flush()
    clock += 1200
    client.toggle({ autoSubmitMs: 2500 })
    await flush()
    net.reply('Check that these two maps differ')
    await flush()
    vi.advanceTimersByTime(1000)
    client.toggle({ autoSubmitMs: 2500 }) // = Cancel
    expect(client.state.kind).toBe('canceled')
    vi.advanceTimersByTime(5000)
    expect(submitted).toEqual([])
  })

  it('an edit inside the window stops the auto-submission', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client, net, submitted } = setup()
    client.toggle({ autoSubmitMs: 2500 })
    await flush()
    clock += 1200
    client.toggle({ autoSubmitMs: 2500 })
    await flush()
    net.reply('Reverse the order on the lift')
    await flush()
    client.edit('Reverse the order on the left')
    vi.advanceTimersByTime(5000)
    expect(submitted).toEqual([])
    expect(client.state).toMatchObject({ kind: 'transcript', text: 'Reverse the order on the left', autoSubmitAt: null })
  })

  it('pressing Talk during transcription cancels it', async () => {
    const { client, net } = setup()
    client.toggle()
    await flush()
    clock += 900
    client.toggle()
    await flush()
    client.toggle()
    expect(client.state.kind).toBe('canceled')
    expect(net.calls[0]!.signal.aborted).toBe(true)
  })
})

describe('limits and failures', () => {
  it('recording stops at maxMs and says so', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client, net } = setup({ maxMs: 5000 })
    await client.start()
    clock += 5000
    vi.advanceTimersByTime(5000)
    expect(client.state).toMatchObject({ kind: 'transcribing', durationMs: 5000, limitReached: true })
    expect(captionFor(client.state)!.text).toContain('recording limit')
    await flush()
    expect(net.calls[0]!.body.durationMs).toBe(5000)
    net.reply('long request')
    await flush()
    expect(client.state).toMatchObject({ kind: 'transcript', limitReached: true })
  })

  it('the default limit is 15 s and it is capped at 30 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client } = setup({ maxMs: 120_000 })
    await client.start()
    vi.advanceTimersByTime(29_999)
    expect(client.state.kind).toBe('recording')
    vi.advanceTimersByTime(1)
    expect(client.state.kind).toBe('transcribing')
  })

  it('microphone denied: a clear error, and typing still works', async () => {
    const { client, net, submitted } = setup({ deny: 'NotAllowedError' })
    await client.start()
    expect(client.state).toMatchObject({ kind: 'error', code: 'mic_denied' })
    expect((client.state as { message: string }).message).toMatch(/denied.*type the request/i)
    expect(net.calls).toHaveLength(0)
    client.submit('Show me why rotation and reflection order matters')
    expect(submitted).toEqual(['Show me why rotation and reflection order matters'])
  })

  it('no microphone device', async () => {
    const { client } = setup({ deny: 'NotFoundError' })
    await client.start()
    expect(client.state).toMatchObject({ kind: 'error', code: 'mic_unavailable' })
  })

  it('a browser without MediaRecorder or getUserMedia is unavailable', () => {
    const c = new VoiceClient({ submit: () => undefined, fetch: controlledFetch().fetchImpl, getUserMedia: fakeMedia().getUserMedia, now })
    // No Recorder option and no global MediaRecorder in Node.
    expect(c.state.kind).toBe('unavailable')
    expect(captionFor(c.state)).toEqual({ text: expect.stringContaining('Speech unavailable'), state: 'error' })
    expect(talkLabelFor(c.state)).toBe('No voice')
  })

  it('server speech unavailable -> unavailable with the server reason; available again -> idle', async () => {
    const { client } = setup()
    client.setCapability({ ...META_CAPABILITY, mode: 'unavailable', configured: false, acceptedMimeTypes: [], problem: 'speech is turned off on this server (SPEECH_PROVIDER=off)' })
    expect(client.state).toEqual({ kind: 'unavailable', reason: 'speech is turned off on this server (SPEECH_PROVIDER=off)' })
    await client.start()
    expect(FakeRecorder.instances).toHaveLength(0)
    client.setCapability(META_CAPABILITY)
    expect(client.state.kind).toBe('idle')
    client.setCapability(null)
    expect(client.state).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('could not be loaded') })
  })

  it('picks a MIME type the server accepts and the recorder supports', async () => {
    FakeRecorder.supported = new Set(['audio/mp4'])
    const { client } = setup()
    expect(client.pickMime()).toBe('audio/mp4')
    FakeRecorder.supported = new Set(['audio/x-unknown'])
    client.setCapability(META_CAPABILITY)
    expect(client.state).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('cannot record any format') })
    FakeRecorder.supported = new Set(TRANSCRIBE_MIME_TYPES)
    client.setCapability({ ...META_CAPABILITY, acceptedMimeTypes: ['audio/ogg;codecs=opus'] })
    expect(client.pickMime()).toBe('audio/ogg;codecs=opus')
  })

  it('a tap shorter than the minimum is not uploaded', async () => {
    const { client, net } = setup()
    await speak(client, 80)
    expect(client.state).toMatchObject({ kind: 'error', code: 'too_short' })
    expect(net.calls).toHaveLength(0)
  })

  it('releasing before the microphone is granted ends truthfully', async () => {
    const { client, media, net } = setup()
    media.holdNext()
    const p = client.start()
    client.stop()
    expect(client.state).toMatchObject({ kind: 'error', code: 'too_short' })
    media.grant()
    await p
    expect(FakeRecorder.instances).toHaveLength(0)
    expect(net.calls).toHaveLength(0)
  })

  it('rejects a non-Meta success envelope instead of presenting or submitting it', async () => {
    const { client, net, submitted } = setup()
    await speak(client)
    net.reply('This must not reach the assistant', { source: 'unsupported' as never })
    await flush()
    expect(client.state).toMatchObject({ kind: 'error', code: 'invalid_response' })
    expect(submitted).toEqual([])
  })

  it('server errors surface with their code (no speech, timeout)', async () => {
    const { client, net } = setup()
    await speak(client)
    net.replyError(422, 'no_speech', 'No speech was recognized; try again.')
    await flush()
    expect(client.state).toEqual({ kind: 'error', code: 'no_speech', message: 'No speech was recognized; try again.' })
    expect(captionFor(client.state)).toEqual({ text: 'Voice: No speech was recognized; try again.', state: 'error' })
    await speak(client)
    net.replyError(504, 'timeout', "Meta speech-to-text did not answer within this application's 30 s limit.")
    await flush()
    expect(client.state).toMatchObject({ kind: 'error', code: 'timeout' })
  })

  it('the microphone track ending mid-recording is an error, not a silent hang', async () => {
    const { client } = setup()
    await client.start()
    FakeRecorder.instances[0]!.endUnexpectedly()
    await flush()
    expect(client.state).toMatchObject({ kind: 'error', code: 'recorder_error' })
  })

  it('dispose releases the microphone and stops notifications', async () => {
    const { client, media, states } = setup()
    await client.start()
    const n = states.length
    client.dispose()
    await flush()
    expect(media.streams[0]!.released).toBe(true)
    expect(states.slice(n)).toEqual(['canceled']) // the final state, then nothing
    await client.start()
    expect(FakeRecorder.instances).toHaveLength(1)
  })
})

describe('captions', () => {
  it('cover each stage', () => {
    expect(captionFor({ kind: 'idle' })).toBeNull()
    expect(captionFor({ kind: 'canceled' })).toEqual({ text: 'Canceled: nothing was sent', state: 'transcript' })
    expect(captionFor({ kind: 'recording', startedAt: 0 })).toEqual({ text: 'Listening… press Talk to stop', state: 'recording' })
    expect(captionFor({ kind: 'transcribing', requestId: 'r', durationMs: 900 })).toEqual({ text: 'Transcribing…', state: 'pending' })
    const response = { requestId: 'r', transcript: 'x', source: 'meta' as const, provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', timing: { audioMs: 1, providerMs: 1, totalMs: 1 } }
    expect(captionFor({ kind: 'transcript', text: 'Replay the comparison', response, autoSubmitAt: null })).toEqual({ text: 'You said: "Replay the comparison" · edit or send', state: 'transcript' })
    expect(captionFor({ kind: 'submitted', text: 'Replay the comparison' })).toEqual({ text: 'You said: "Replay the comparison"', state: 'transcript' })
    expect(captionFor({ kind: 'transcript', text: 'a'.repeat(300), response, autoSubmitAt: null })!.text.length).toBeLessThan(150)
  })
})
