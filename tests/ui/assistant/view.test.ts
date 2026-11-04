// The Ask Meta Muse AI view derivation against the spec's lifecycle table (UI-REFINEMENT-SPEC section 7): which
// phase each actual client state maps to, what can be done in it (Stop, Cancel, Retry, Send), and that
// suggestions are offered only when nothing is in progress. Logic only; copy constants are not re-asserted.

import { describe, expect, it } from 'vitest'
import { EDIT_WITH_DRAFT, assistantView, phaseOf } from '../../../src/ui/assistant/view'
import { CAP, SPEECH, STATES, VOICE, docs, panelInput } from './helpers'
import type { AssistantState } from '../../../src/assistant/client'

const sculpture = () => docs().sculpture
const view = (over: Parameters<typeof panelInput>[1]) => assistantView(panelInput(sculpture(), over))
const actionIds = (v: ReturnType<typeof assistantView>) => v.exchange?.actions.map((a) => a.id) ?? []
const kinds = (v: ReturnType<typeof assistantView>) => v.exchange?.actions.map((a) => (a.command.kind === 'assistant' ? a.command.action.kind : a.command.kind)) ?? []

describe('lifecycle phases', () => {
  it('idle: suggestions and input; nothing is started by deriving the view', () => {
    const v = view({})
    expect(v.phase).toBe('idle')
    expect(v.exchange).toBeNull()
    expect(v.suggestions.length).toBeGreaterThanOrEqual(2)
    expect(v.input.visible && v.input.enabled).toBe(true)
    expect(v.voice.mic.mode).toBe('record')
    expect(v.voice.phase).toBe('idle')
  })

  it('recording (and the microphone request): Stop and Cancel, no suggestions', () => {
    const v = view({ voice: VOICE.recording })
    expect(v.phase).toBe('recording')
    expect(v.voice.mic.mode).toBe('stop')
    expect(v.voice.cancel?.command).toEqual({ kind: 'assistant', action: { kind: 'voiceCancel' } })
    expect(v.suggestions).toEqual([])
    const a = view({ voiceAcquiring: true })
    expect(a.phase).toBe('recording')
    expect(a.voice.mic.mode).toBe('cancel')
  })

  it('transcribing: cancellation available, separate from the request', () => {
    const v = view({ voice: VOICE.transcribing })
    expect(v.phase).toBe('transcribing')
    expect(v.voice.mic.mode).toBe('cancel')
    expect(v.voice.talk.label).toBe('Cancel')
    expect(v.exchange).toBeNull()
  })

  it('transcript ready on desktop: editable with Send; the question field steps aside', () => {
    const v = view({ voice: VOICE.transcriptDesktop })
    expect(v.phase).toBe('transcript')
    expect(v.input.visible).toBe(false)
    expect(v.voice.transcript?.autoSubmitAt).toBeNull()
    expect(v.voice.send?.command).toEqual({ kind: 'assistant', action: { kind: 'transcriptSubmit' } })
    expect(v.voice.transcript?.source).toMatch(/^Meta transcription · /)
  })

  it('transcript ready in XR: countdown with a clear Cancel (Talk reads Cancel) and Send now; no text field', () => {
    const v = view({ voice: VOICE.transcriptXr, surface: 'xr' })
    expect(v.phase).toBe('transcript')
    expect(v.input.visible).toBe(false)
    expect(v.voice.transcript?.autoSubmitAt).toBe(5000)
    expect(v.voice.talk.label).toBe('Cancel')
    expect(v.voice.talk.command).toEqual({ kind: 'assistant', action: { kind: 'voiceToggle' } })
    expect(v.voice.xrCancel?.command).toEqual({ kind: 'assistant', action: { kind: 'voiceCancel' } })
    expect(v.voice.send?.label).toBe('Send now')
  })

  it('pending: the actual submitted question and Cancel; no suggestions while it runs', () => {
    const v = view({ assistant: STATES.pending })
    expect(v.phase).toBe('pending')
    expect(v.exchange?.question).toBe(STATES.pending.prompt)
    expect(kinds(v)).toEqual(['cancel'])
    expect(v.suggestions).toEqual([])
  })

  it('applied: actual response, validated change summary and its provenance; no panel Undo (Undo stays global)', () => {
    const v = view({ assistant: STATES.applied() })
    expect(v.phase).toBe('applied')
    expect(v.exchange?.changes).toEqual(['Applied +1 to exp-c4'])
    expect(v.exchange?.title).toBe('Apply the operation again')
    expect(v.exchange?.provenance?.live).toBe(false)
    expect(kinds(v)).not.toContain('undo')
    expect(actionIds(v)).toEqual([])
  })

  it('answered: response and provenance, scene unchanged', () => {
    const v = view({ assistant: STATES.answered() })
    expect(v.phase).toBe('answered')
    expect(v.exchange?.changes).toEqual([])
    expect(v.exchange?.explanation).toBeTruthy()
  })

  it('stale: reason, explanation kept, Retry; rejected: Retry only for a live response', () => {
    const s = view({ assistant: STATES.stale })
    expect(s.phase).toBe('stale')
    expect(s.exchange?.reason?.toLowerCase()).toContain('the workspace changed while the request was running')
    expect(s.exchange?.explanation).toBeTruthy()
    expect(kinds(s)).toContain('retry')
    expect(kinds(view({ assistant: STATES.rejected('synthetic') }))).not.toContain('retry')
    expect(kinds(view({ assistant: STATES.rejected('meta') }))).toContain('retry')
  })

  it('error: Retry only when retryable; recoverable input restores the question into an empty field', () => {
    const net = view({ assistant: STATES.error('network', true) })
    expect(net.phase).toBe('error')
    expect(kinds(net)).toEqual(['retry', 'draft'])
    expect(net.exchange?.actions.find((a) => a.id === 'edit')?.command).toEqual({ kind: 'assistant', action: { kind: 'draft', text: 'Explain this cycle' } })
    const noFixture = view({ assistant: STATES.error('synthetic_no_fixture', false) })
    expect(kinds(noFixture)).toEqual(['draft'])
    // A draft in progress is never overwritten: Edit question stays (the answer keeps its height as typing starts),
    // disabled with the reason.
    const drafting = view({ assistant: STATES.error('network', true), draft: 'my own question' })
    expect(kinds(drafting)).toEqual(['retry', 'draft'])
    expect(drafting.exchange?.actions.map((a) => a.disabled ?? null)).toEqual([null, EDIT_WITH_DRAFT])
    expect(net.exchange?.actions.find((a) => a.id === 'edit')?.disabled).toBeUndefined()
    for (const assistant of [STATES.canceled, STATES.rejected('synthetic'), STATES.error('provider_gateway_timeout', false)] as AssistantState[]) {
      const ids = (draft: string) => view({ assistant, draft }).exchange?.actions.map((a) => a.id)
      expect(ids('W')).toEqual(ids(''))
    }
    // XR has no field to restore into.
    expect(kinds(view({ assistant: STATES.error('network', true), surface: 'xr' }))).toEqual(['retry'])
  })

  it('timeouts and provider errors: an upstream 504 offers only Edit for a smaller request; retryable ones keep Retry', () => {
    const state = (code: string, retryable: boolean, message: string): AssistantState => ({ kind: 'error', requestId: 'r1', prompt: 'Explain every endpoint in detail', error: { code, message, retryable } })
    // Upstream Meta 504/408 (server/muse/provider.ts): no Retry of the same text, no scene update, Edit for a new request.
    const gw = view({ assistant: state('provider_gateway_timeout', false, 'Meta timed out before Muse finished this request (HTTP 504 gateway timeout). The workspace has not changed.') })
    expect(gw.phase).toBe('error')
    expect(gw.exchange).toMatchObject({ heading: 'Timed out at Meta', tone: 'error', changes: [], facts: null, explanation: null })
    expect(gw.exchange?.reason).toMatch(/^Meta timed out \(HTTP 504\), so the scene did not change\./)
    expect(gw.exchange?.reason).toMatch(/same question again is not advised/)
    expect(gw.exchange?.reason).toMatch(/smaller or simpler question/)
    expect(kinds(gw)).toEqual(['draft'])
    expect(gw.exchange?.actions[0]).toMatchObject({ id: 'edit', command: { kind: 'assistant', action: { kind: 'draft', text: 'Explain every endpoint in detail' } } })
    expect(gw.exchange?.actions[0]?.ariaLabel).toMatch(/smaller or simpler new request/)
    // Even if a server ever marked it retryable, the panel does not offer an unchanged resend.
    expect(kinds(view({ assistant: state('provider_gateway_timeout', true, 'x') }))).toEqual(['draft'])
    // XR has no field: no action; the reason points at Talk or a suggestion, and suggestions are offered.
    const gwXr = view({ assistant: state('provider_gateway_timeout', false, 'x'), surface: 'xr' })
    expect(kinds(gwXr)).toEqual([])
    expect(gwXr.exchange?.reason).toMatch(/with Talk or a suggestion/)
    expect(gwXr.suggestions.length).toBeGreaterThan(0)
    // This application's own deadline (40 s) and request limit (45 s): named as such, Retry kept.
    const deadline = view({ assistant: state('provider_timeout', true, "Muse did not answer within this application's 40 s limit, so the request was stopped. The workspace has not changed.") })
    expect(deadline.exchange).toMatchObject({ heading: 'No answer in time', reason: expect.stringMatching(/this application's 40 s limit/) })
    expect(kinds(deadline)).toEqual(['retry', 'draft'])
    expect(view({ assistant: state('timeout', true, "The assistant request exceeded this application's time limit. The workspace has not changed.") }).exchange?.heading).toBe('No answer in time')
    // 429 rate limited (with the Retry-After wait) and 503 transient: retryable.
    const limited = view({ assistant: state('provider_rate_limited', true, 'Meta is rate-limiting requests; try again in about 15 s. The workspace has not changed.') })
    expect(limited.exchange).toMatchObject({ heading: 'Rate limited', reason: expect.stringMatching(/about 15 s/) })
    expect(kinds(limited)).toEqual(['retry', 'draft'])
    const transient = view({ assistant: state('provider_unavailable', true, 'Meta is temporarily unavailable (HTTP 503); try again shortly. The workspace has not changed.') })
    expect(transient.exchange?.heading).toBe('Meta unavailable')
    expect(kinds(transient)).toEqual(['retry', 'draft'])
  })

  it('canceled: clear status; suggestions return', () => {
    const v = view({ assistant: STATES.canceled })
    expect(v.phase).toBe('canceled')
    expect(kinds(v)).toContain('retry')
    expect(v.suggestions.length).toBeGreaterThan(0)
  })

  it('an active voice stage takes precedence over the request; a finished voice error shows only when no request result is up', () => {
    expect(phaseOf({ assistant: STATES.pending, voice: VOICE.recording, voiceAcquiring: false })).toBe('recording')
    expect(phaseOf({ assistant: STATES.answered(), voice: VOICE.error, voiceAcquiring: false })).toBe('answered')
    expect(phaseOf({ assistant: { kind: 'idle' }, voice: VOICE.error, voiceAcquiring: false })).toBe('error')
    expect(phaseOf({ assistant: { kind: 'idle' }, voice: VOICE.canceled, voiceAcquiring: false })).toBe('canceled')
    expect(phaseOf({ assistant: STATES.pending, voice: VOICE.submitted, voiceAcquiring: false })).toBe('pending')
    // While recording during a pending request, the request keeps its own Cancel.
    expect(kinds(view({ assistant: STATES.pending, voice: VOICE.recording }))).toEqual(['cancel'])
  })

  it('every state of both clients maps to a phase with a status line', () => {
    const assistants: AssistantState[] = [{ kind: 'idle' }, STATES.pending, STATES.applied(), STATES.answered(), STATES.stale, STATES.rejected(), STATES.error('x', false), STATES.canceled]
    for (const a of assistants) for (const v of Object.values(VOICE)) for (const surface of ['desktop', 'xr'] as const) {
      const out = view({ assistant: a, voice: v, surface })
      expect(out.status.text.length).toBeGreaterThan(0)
      expect(out.input.visible).toBe(surface === 'desktop' && out.phase !== 'transcript')
    }
  })
})

describe('controls follow availability', () => {
  it('voice unavailable: microphone and Talk disabled with the reason; typed questions still work', () => {
    const v = view({ voice: VOICE.unavailable })
    expect(v.voice.mic.enabled).toBe(false)
    expect(v.voice.mic.reason).toMatch(/MediaRecorder/)
    expect(v.voice.talk.enabled).toBe(false)
    expect(v.input.enabled).toBe(true)
  })

  it('assistant unavailable: no suggestions, no Send, no microphone; the reason is shown', () => {
    const v = view({ capability: { assistant: CAP.unavailable, speech: SPEECH }, draft: 'hello' })
    expect(v.source.label).toBe('Unavailable')
    expect(v.suggestions).toEqual([])
    expect(v.input.sendEnabled).toBe(false)
    expect(v.input.reason).toBeTruthy()
    expect(v.voice.mic.enabled).toBe(false)
    expect(v.voice.talk.enabled).toBe(false)
  })

  it('Send needs a non-empty draft; the draft is carried, never turned into a command by itself', () => {
    expect(view({ draft: '' }).input.sendEnabled).toBe(false)
    expect(view({ draft: '   ' }).input.sendEnabled).toBe(false)
    const v = view({ draft: 'Why?' })
    expect(v.input.sendEnabled).toBe(true)
    expect(v.input.draft).toBe('Why?')
    expect(JSON.stringify(v.suggestions)).not.toContain('Why?')
  })

  it('XR Talk: press to record (voiceToggle), Stop while recording with a separate Cancel', () => {
    const idle = view({ surface: 'xr' })
    expect(idle.voice.talk).toMatchObject({ label: 'Talk', enabled: true, command: { kind: 'assistant', action: { kind: 'voiceToggle' } } })
    const rec = view({ surface: 'xr', voice: VOICE.recording })
    expect(rec.voice.talk.label).toBe('Stop')
    expect(rec.voice.xrCancel?.command).toEqual({ kind: 'assistant', action: { kind: 'voiceCancel' } })
  })
})
