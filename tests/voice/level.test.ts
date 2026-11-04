// VoiceClient.inputLevel(): the current recording's level from an AnalyserNode RMS on the recording's own
// MediaStream (a FAKE Web Audio here). 0 when not recording; the graph is never connected to an output and is
// closed with the recording; recording, upload and submission are unchanged.

import { beforeEach, describe, expect, it } from 'vitest'
import { LEVEL_GAIN, VoiceClient } from '../../src/voice/client'
import { FakeRecorder, META_CAPABILITY, controlledFetch, fakeMedia, flush } from './fakes'

class FakeNode {
  connections: unknown[] = []
  disconnected = false
  connect(n: unknown) {
    this.connections.push(n)
    return n
  }
  disconnect() {
    this.disconnected = true
  }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048
  /** The samples the next read returns (amplitude of a square wave). */
  amplitude = 0
  reads = 0
  getFloatTimeDomainData(buf: Float32Array) {
    this.reads++
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 ? this.amplitude : -this.amplitude
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static throwOnCreate = false
  state = 'running'
  closed = false
  readonly destination = new FakeNode()
  source: (FakeNode & { stream: unknown }) | null = null
  analyser: FakeAnalyser | null = null
  constructor() {
    if (FakeAudioContext.throwOnCreate) throw new Error('no audio')
    FakeAudioContext.instances.push(this)
  }
  createMediaStreamSource(stream: unknown) {
    this.source = Object.assign(new FakeNode(), { stream })
    return this.source
  }
  createAnalyser() {
    this.analyser = new FakeAnalyser()
    return this.analyser
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }
}

let clock = 0
function setup(audio: unknown = FakeAudioContext) {
  const media = fakeMedia()
  const net = controlledFetch()
  const submitted: string[] = []
  const client = new VoiceClient({
    submit: (t) => submitted.push(t),
    fetch: net.fetchImpl,
    getUserMedia: media.getUserMedia,
    Recorder: FakeRecorder as unknown as typeof MediaRecorder,
    AudioContext: audio as (new () => AudioContext) | null,
    now: () => clock,
  })
  client.setCapability(META_CAPABILITY)
  return { client, media, net, submitted }
}

const ctx = () => FakeAudioContext.instances.at(-1)!

beforeEach(() => {
  clock = 1000
  FakeRecorder.instances = []
  FakeAudioContext.instances = []
  FakeAudioContext.throwOnCreate = false
})

describe('voice input level', () => {
  it('is 0 when idle and builds no audio graph', () => {
    const { client } = setup()
    expect(client.inputLevel()).toBe(0)
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('is 0 while the microphone is being requested', async () => {
    const { client, media } = setup()
    media.holdNext()
    const p = client.start()
    expect(client.acquiring).toBe(true)
    expect(client.inputLevel()).toBe(0)
    media.grant()
    await p
    expect(client.state.kind).toBe('recording')
  })

  it('follows the RMS of the recording stream through an analyser that is never connected to an output', async () => {
    const { client, media } = setup()
    await client.start()
    expect(client.inputLevel()).toBe(0) // silence
    const c = ctx()
    expect(c.source!.stream).toBe(media.streams[0]) // the recording's own stream
    expect(c.source!.connections).toEqual([c.analyser])
    expect(c.analyser!.connections).toEqual([]) // nothing is played back
    expect(c.analyser!.fftSize).toBe(1024)
    c.analyser!.amplitude = 0.05
    expect(client.inputLevel()).toBeCloseTo(0.05 * LEVEL_GAIN, 6)
    c.analyser!.amplitude = 0.1
    expect(client.inputLevel()).toBeCloseTo(0.1 * LEVEL_GAIN, 6)
    c.analyser!.amplitude = 0.9
    expect(client.inputLevel()).toBe(1) // clamped
    expect(FakeAudioContext.instances).toHaveLength(1) // one graph per recording, built once
  })

  it('drops to 0 on release and closes the graph with the recording; the utterance flows as before', async () => {
    const { client, net, media } = setup()
    await client.start()
    client.inputLevel()
    const c = ctx()
    c.analyser!.amplitude = 0.1
    expect(client.inputLevel()).toBeGreaterThan(0)
    clock += 1500
    client.stop()
    expect(client.state.kind).toBe('transcribing')
    expect(client.inputLevel()).toBe(0)
    await flush()
    expect(c.closed).toBe(true)
    expect(c.source!.disconnected).toBe(true)
    expect(c.analyser!.disconnected).toBe(true)
    expect(media.streams[0]!.released).toBe(true)
    expect(net.calls).toHaveLength(1)
    net.reply('rotate ninety degrees')
    await flush()
    expect(client.state.kind).toBe('transcript')
    expect(client.inputLevel()).toBe(0)
  })

  it('cancel and dispose close the graph', async () => {
    const a = setup()
    await a.client.start()
    a.client.inputLevel()
    const c1 = ctx()
    a.client.cancel()
    expect(c1.closed).toBe(true)
    expect(a.client.inputLevel()).toBe(0)
    await a.client.start()
    a.client.inputLevel()
    const c2 = ctx()
    expect(c2).not.toBe(c1) // a new recording gets its own graph
    a.client.dispose()
    expect(c2.closed).toBe(true)
    expect(a.client.inputLevel()).toBe(0)
  })

  it('without Web Audio (or when it fails) the level is 0 and recording is unchanged', async () => {
    for (const audio of [null, FakeAudioContext]) {
      FakeAudioContext.throwOnCreate = audio !== null
      const { client, net } = setup(audio)
      await client.start()
      expect(client.state.kind).toBe('recording')
      expect(client.inputLevel()).toBe(0)
      expect(client.inputLevel()).toBe(0) // not retried every frame
      clock += 1500
      client.stop()
      await flush()
      expect(net.calls).toHaveLength(1)
    }
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it('the default lookup finds no Web Audio in node: 0, and the existing flow is untouched', async () => {
    const { client } = setup(undefined)
    await client.start()
    expect(client.inputLevel()).toBe(0)
  })
})
