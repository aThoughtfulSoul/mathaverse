// Recording format checks and conversion to the Meta file endpoint format: 16 kHz mono 16-bit PCM WAV.
// ffmpeg runs with a forced demuxer, the file protocol only, no stdin, a minimal environment, a time limit and an abort
// signal, so a crafted upload cannot be interpreted as a playlist or reach the network.

import { spawn } from 'node:child_process'
import type { TranscribeMimeType } from '../../src/voice/protocol'

export type Container = 'webm' | 'ogg' | 'mp4' | 'wav'

export function containerOf(mime: TranscribeMimeType): Container {
  if (mime.startsWith('audio/webm')) return 'webm'
  if (mime.startsWith('audio/ogg')) return 'ogg'
  if (mime === 'audio/mp4') return 'mp4'
  return 'wav'
}

/** The container the bytes actually are, from their signature (null: none of the accepted ones). */
export function sniffContainer(b: Uint8Array): Container | null {
  const ascii = (at: number, s: string) => b.length >= at + s.length && [...s].every((c, i) => b[at + i] === c.charCodeAt(0))
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm'
  if (ascii(0, 'OggS')) return 'ogg'
  if (ascii(4, 'ftyp')) return 'mp4'
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav'
  return null
}

/** ffmpeg demuxer per container (never probed from the data). */
const DEMUXER: Record<Container, string> = { webm: 'matroska', ogg: 'ogg', mp4: 'mov', wav: 'wav' }

export interface ProcessResult {
  code: number | null
  stderr: string
  timedOut: boolean
  aborted: boolean
  spawnError: string | null
}

/** Run a process with no stdin, bounded stderr, a timeout and an abort signal. Never rejects. */
export function runBounded(bin: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number; signal: AbortSignal }): Promise<ProcessResult> {
  return new Promise((resolve) => {
    if (opts.signal.aborted) return resolve({ code: null, stderr: '', timedOut: false, aborted: true, spawnError: null })
    const r = { timedOut: false, aborted: false }
    let spawnError: string | null = null
    let stderr = ''
    const child = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'ignore', 'pipe'] })
    const kill = () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
    const timer = setTimeout(() => ((r.timedOut = true), kill()), opts.timeoutMs)
    const onAbort = () => ((r.aborted = true), kill())
    opts.signal.addEventListener('abort', onAbort, { once: true })
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 4096) stderr += c.toString('utf8')
    })
    let done = false
    const finish = (code: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
      resolve({ code, stderr: stderr.slice(0, 4096), ...r, spawnError })
    }
    child.on('error', (e) => {
      spawnError = e.message
      if (child.pid === undefined) finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

export const CONVERT_TIMEOUT_MS = 10_000

/** ffmpeg arguments: decode `input` with the container's demuxer, write 16 kHz mono s16 WAV to `output`. */
export function convertArgs(input: string, output: string, container: Container, maxSeconds: number): string[] {
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-protocol_whitelist', 'file',
    '-f', DEMUXER[container], '-i', input,
    '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-t', String(maxSeconds),
    '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
    // A plain 44-byte RIFF header (no LIST/INFO encoder chunk).
    '-fflags', '+bitexact', '-flags:a', '+bitexact',
    '-f', 'wav', '-y', output,
  ]
}

export interface Wav {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** PCM bytes in the data chunk. */
  dataBytes: number
  durationMs: number
  /** Largest absolute sample over full scale (0..1): a near-zero peak is silence. */
  peak: number
}

/** Parse a RIFF/WAVE header and measure it (PCM 16-bit only). Null when it is not such a file. */
export function parseWav(b: Buffer): Wav | null {
  if (b.length < 12 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null
  let off = 12
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    let size = b.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ' && body + 16 <= b.length) {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), sampleRate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.sampleRate < 1) return null
      // ffmpeg writing to a non-seekable output can leave 0xFFFFFFFF; clamp to what is present.
      size = Math.min(size, b.length - body)
      const samples = Math.floor(size / 2)
      let peak = 0
      for (let i = 0; i < samples; i++) {
        const v = Math.abs(b.readInt16LE(body + i * 2))
        if (v > peak) peak = v
      }
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16, dataBytes: size, durationMs: (samples / fmt.channels / fmt.sampleRate) * 1000, peak: peak / 32768 }
    }
    off = body + size + (size % 2)
  }
  return null
}

/** Below this peak (about -54 dBFS) the clip is treated as silence and no model is run. */
export const SILENCE_PEAK = 0.002
