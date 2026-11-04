// The voice error line in the Ask Meta Muse AI view (src/ui/assistant/view.ts): the voice client's message, except a
// too-short recording in XR. The advice there ("Hold Talk while you speak", from the voice client's too_short or the
// speech route's 422 no_speech for audio under its minimum) is the desktop control's: the XR Talk control toggles and
// the hold is on A or X, so XR shows XR_TOO_SHORT_STATUS for both. The desktop wording is unchanged, and so are the
// route's other no_speech refusals.

import { describe, expect, it } from 'vitest'
import { XR_TOO_SHORT_STATUS, assistantView } from '../../../src/ui/assistant/view'
import type { VoiceState } from '../../../src/voice/client'
import { VOICE, docs, panelInput } from './helpers'

/** The voice client's two too_short errors (src/voice/client.ts), word for word. */
const TOO_SHORT_MESSAGE = 'That recording was too short. Hold Talk while you speak, or press it once to start and again to stop.'
const TOO_SHORT: VoiceState = { kind: 'error', code: 'too_short', message: TOO_SHORT_MESSAGE }
const BEFORE_MIC: VoiceState = { kind: 'error', code: 'too_short', message: 'Released before the microphone was ready. Press Talk again to speak.' }
/** The speech route's 422 no_speech refusals (server/speech/index.ts), word for word, as the voice client sets them. */
const SERVER_TOO_SHORT_MESSAGE = 'The recording is too short; hold Talk while speaking.'
const SERVER_TOO_SHORT: VoiceState = { kind: 'error', code: 'no_speech', message: SERVER_TOO_SHORT_MESSAGE }
const SERVER_OTHER = ['The recording is silent; check the microphone and try again.', 'No speech was recognized; try again.', 'No clear speech was recognized; try again.']

const voiceOf = (voice: VoiceState, surface: 'desktop' | 'xr') => assistantView(panelInput(docs().proof, { voice, surface })).voice

describe('the too-short recording error fits the surface', () => {
  it('XR: hold A or X, or press Talk to start and stop (no "Hold Talk")', () => {
    const v = voiceOf(TOO_SHORT, 'xr')
    expect(v.phase).toBe('error')
    expect(v.tone).toBe('error')
    expect(v.status).toBe(XR_TOO_SHORT_STATUS)
    expect(v.status).toBe('That recording was too short. Hold A or X while you speak, or press Talk to start and stop.')
    expect(v.status).not.toMatch(/Hold Talk/)
    expect(v.talk.label).toBe('Talk') // the next recording starts as usual
  })

  it('XR: the speech route\'s too-short refusal (422 no_speech) gets the same XR wording', () => {
    const v = voiceOf(SERVER_TOO_SHORT, 'xr')
    expect(v.phase).toBe('error')
    expect(v.tone).toBe('error')
    expect(v.status).toBe(XR_TOO_SHORT_STATUS)
    expect(v.status).not.toMatch(/hold Talk/i)
    expect(v.talk.label).toBe('Talk')
  })

  it('desktop: the voice client\'s and the route\'s own wording, unchanged', () => {
    expect(voiceOf(TOO_SHORT, 'desktop').status).toBe(TOO_SHORT_MESSAGE)
    expect(voiceOf(SERVER_TOO_SHORT, 'desktop').status).toBe(SERVER_TOO_SHORT_MESSAGE)
  })

  it('other voice errors keep their message on both surfaces (the release before the microphone was ready too)', () => {
    for (const surface of ['desktop', 'xr'] as const) {
      expect(voiceOf(BEFORE_MIC, surface).status).toBe('Released before the microphone was ready. Press Talk again to speak.')
      expect(voiceOf(VOICE.error, surface).status).toBe('Microphone access was denied.')
      // The route's other no_speech refusals are not about the length: their own message.
      for (const message of SERVER_OTHER) expect(voiceOf({ kind: 'error', code: 'no_speech', message }, surface).status).toBe(message)
    }
  })
})
