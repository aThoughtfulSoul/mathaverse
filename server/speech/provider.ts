// The provider seam of /api/transcribe: the route hands a provider a validated 16 kHz mono WAV and
// receives text or a SpeechError. The Meta HTTP translation stays inside meta.ts.

import { TRANSCRIBE_ERRORS, type TranscribeErrorCode } from '../../src/voice/protocol'

export interface ProviderInput {
  /** 16 kHz mono 16-bit PCM WAV written by the route in its private temp directory. */
  wavPath: string
  wav: Buffer
  /** Bounded vocabulary hints from the request. */
  hints: string[]
  requestId: string
  /** Aborted by client disconnect, the application timeout or the provider deadline. */
  signal: AbortSignal
}

export interface SpeechProvider {
  readonly source: 'meta'
  readonly provider: string
  readonly model: string
  /** The raw transcript (the route trims it and treats empty text as no speech). */
  transcribe(input: ProviderInput): Promise<string>
}

export class SpeechError extends Error {
  override name = 'SpeechError'
  constructor(readonly code: TranscribeErrorCode, message: string, readonly retryable: boolean) {
    super(message)
  }
  get status(): number {
    return TRANSCRIBE_ERRORS[this.code]
  }
}

/** Thrown when the signal ended the work; the route tells cancellation from a deadline. */
export class SpeechAborted extends Error {
  override name = 'SpeechAborted'
}
