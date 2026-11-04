// Shared inputs for the assistant inspector tests: real documents for the six experiments (built with the
// prepared actions through the planner), capability records, client states and response envelopes. Every
// response here is SYNTHETIC test data (or a hand-written envelope labelled source "meta" to check that only
// such an envelope is presented as live); none is provider output.

import { type Doc, demoDocument } from '../../../src/workspace/document'
import { planTransaction } from '../../../src/workspace/reducer'
import { braidActions, cubeActions, quotientActions, sculptureActions } from '../../../src/demo/four'
import { proofActions } from '../../../src/demo/proof'
import { demoOf, orderDemoActions } from '../../../src/demo/order'
import { findAnyExperiment } from '../../../src/workspace/document'
import type { AssistantState } from '../../../src/assistant/client'
import type { VoiceState } from '../../../src/voice/client'
import type { AssistantResponse } from '../../../src/workspace/actions'
import type { AssistantCapability, SpeechCapability } from '../../../server/types'
import type { AssistantPanelInput, DomainPresentation } from '../../../src/ui/model'
import type { DemoKind } from '../../../src/demo/order'

export const plan = (doc: Doc, actions: unknown[]): Doc => planTransaction(doc, actions).doc

export const CAP: Record<'synthetic' | 'forcedSynthetic' | 'live' | 'liveVerified' | 'unavailable', AssistantCapability> = {
  synthetic: { configured: false, authenticated: false, liveValidated: false, model: null, mode: 'synthetic' },
  forcedSynthetic: { configured: true, authenticated: false, liveValidated: false, model: 'muse-spark-1.3', mode: 'synthetic' },
  live: { configured: true, authenticated: false, liveValidated: false, model: 'muse-spark-1.3', mode: 'meta' },
  liveVerified: { configured: true, authenticated: true, liveValidated: true, model: 'muse-spark-1.3', mode: 'meta' },
  unavailable: { configured: false, authenticated: false, liveValidated: false, model: null, mode: 'unavailable' },
}

export const SPEECH: SpeechCapability = { configured: true, liveValidated: true, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', acceptedMimeTypes: ['audio/webm;codecs=opus'], problem: null }

/** The seven experiments, each displayed in a real document. */
export function docs(): Record<DemoKind, Doc> {
  const pq = demoDocument()
  return {
    pq,
    order: plan(pq, orderDemoActions(pq)),
    sculpture: plan(pq, sculptureActions(pq)),
    cube: plan(pq, cubeActions(pq)),
    quotient: plan(pq, quotientActions(pq)),
    braid: plan(pq, braidActions(pq)),
    proof: plan(pq, proofActions(pq)),
  }
}

const PRESENTATION = {} as DomainPresentation

export function panelInput(doc: Doc, over: Partial<AssistantPanelInput> = {}): AssistantPanelInput {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return {
    open: true,
    surface: 'desktop',
    assistant: { kind: 'idle' },
    voice: { kind: 'idle' },
    voiceAcquiring: false,
    capability: { assistant: CAP.synthetic, speech: SPEECH },
    draft: '',
    doc,
    demo: demoOf(doc, e),
    experimentId: e.id,
    presentation: PRESENTATION,
    ...over,
  }
}

export function response(source: 'meta' | 'synthetic', actions = 0): AssistantResponse {
  return {
    requestId: 'r1',
    source,
    model: source === 'meta' ? 'muse-spark-1.3' : 'synthetic:apply-again',
    baseRevision: 0,
    contextHash: 'h',
    timing: { providerMs: source === 'meta' ? 1800 : null, totalMs: source === 'meta' ? 2100 : 3 },
    proposal: { proposalVersion: 1, title: 'Apply the operation again', explanation: 'This applies the selected operation once more.', actions: new Array(actions).fill({ kind: 'apply_element', experimentId: 'exp-c4', element: 'c1' }) },
  } as AssistantResponse
}

export const STATES = {
  pending: { kind: 'pending', requestId: 'r1', prompt: 'Apply the selected operation again', startedAt: 1 },
  applied: (src: 'meta' | 'synthetic' = 'synthetic') => ({ kind: 'applied', requestId: 'r1', prompt: 'Apply the selected operation again', response: response(src, 1), summary: ['Applied +1 to exp-c4'], sceneChangeMs: 40 }),
  answered: (src: 'meta' | 'synthetic' = 'synthetic') => ({ kind: 'answered', requestId: 'r1', prompt: "Show each element's order", response: response(src) }),
  stale: { kind: 'stale', requestId: 'r1', prompt: 'Apply the selected operation again', response: response('synthetic', 1), reason: 'the workspace changed while the request was running' },
  rejected: (src: 'meta' | 'synthetic' = 'synthetic') => ({ kind: 'rejected', requestId: 'r1', prompt: 'Apply the selected operation again', response: response(src, 1), reason: 'history full' }),
  error: (code: string, retryable: boolean) => ({ kind: 'error', requestId: 'r1', prompt: 'Explain this cycle', error: { code, message: `${code} happened`, retryable } }),
  canceled: { kind: 'canceled', requestId: 'r1', prompt: 'Apply the selected operation again' },
} satisfies Record<string, AssistantState | ((...a: never[]) => AssistantState)>

const transcribed = { requestId: 't1', transcript: 'apply it again', source: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', timing: { audioMs: 1500, providerMs: 400, totalMs: 520 } } as const

export const VOICE = {
  recording: { kind: 'recording', startedAt: 1000 },
  transcribing: { kind: 'transcribing', requestId: 't1', durationMs: 1500 },
  transcriptDesktop: { kind: 'transcript', text: 'apply it again', response: transcribed, autoSubmitAt: null },
  transcriptXr: { kind: 'transcript', text: 'apply it again', response: transcribed, autoSubmitAt: 5000 },
  error: { kind: 'error', code: 'mic_denied', message: 'Microphone access was denied.' },
  canceled: { kind: 'canceled' },
  unavailable: { kind: 'unavailable', reason: 'this browser cannot record audio (no MediaRecorder)' },
  submitted: { kind: 'submitted', text: 'apply it again' },
} satisfies Record<string, VoiceState>
