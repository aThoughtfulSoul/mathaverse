// Application API mount (WORKSPACE-AND-AI W6), served from the same origin as the frontend by a Vite
// middleware (vite.config.ts). The coordinator owns this file; the Muse and Lean tracks own their
// route modules. A missing or failing service answers with a truthful 503, never a fabricated result.

import { ACTION_KINDS } from '../src/workspace/actions'
import { CLAIM_KINDS } from '../src/workspace/claims'
import { OPERATION_KINDS } from '../src/recipes/recipe'
import { type ApiRequest, type ApiResult, type AssistantCapability, type ProofCapability, type SpeechCapability, apiError } from './types'

interface MuseModule {
  assistantRoute: (req: ApiRequest) => Promise<ApiResult>
  museCapabilities: () => AssistantCapability
}
interface LeanModule {
  checkRoute: (req: ApiRequest) => Promise<ApiResult>
  leanCapabilities: () => Promise<ProofCapability>
}
interface SpeechModule {
  transcribeRoute: (req: ApiRequest) => Promise<ApiResult>
  speechCapabilities: () => Promise<SpeechCapability>
}
const NO_SPEECH: SpeechCapability = { configured: false, liveValidated: false, mode: 'unavailable', provider: null, model: null, acceptedMimeTypes: [], problem: 'the speech service is not installed in this build' }

async function load<T>(path: string): Promise<T | null> {
  try {
    return (await import(/* @vite-ignore */ path)) as T
  } catch {
    return null
  }
}

export async function handleApi(req: ApiRequest): Promise<ApiResult> {
  const route = `${req.method} ${req.path}`
  switch (route) {
    case 'GET /api/capabilities': {
      const muse = await load<MuseModule>('./muse/index')
      const lean = await load<LeanModule>('./lean/index')
      const assistant: AssistantCapability = muse ? muse.museCapabilities() : { configured: false, authenticated: false, liveValidated: false, model: null, mode: 'unavailable' }
      const proof: ProofCapability = lean ? await lean.leanCapabilities().catch(() => ({ available: false, toolchain: null, templateVersion: null, claimKinds: [] })) : { available: false, toolchain: null, templateVersion: null, claimKinds: [] }
      const speechMod = await load<SpeechModule>('./speech/index')
      const speech: SpeechCapability = speechMod ? await speechMod.speechCapabilities().catch(() => ({ ...NO_SPEECH, problem: 'the speech service failed to report its status' })) : NO_SPEECH
      return {
        status: 200,
        json: {
          schemaVersion: 1,
          actions: ACTION_KINDS,
          claimKinds: CLAIM_KINDS,
          recipeOperations: OPERATION_KINDS,
          assistant,
          proof,
          speech,
        },
      }
    }
    case 'POST /api/assistant': {
      const muse = await load<MuseModule>('./muse/index')
      if (!muse) return apiError(503, 'assistant_unavailable', 'The assistant service is not installed in this build.', false)
      return muse.assistantRoute(req)
    }
    case 'POST /api/transcribe': {
      const speech = await load<SpeechModule>('./speech/index')
      if (!speech) return apiError(503, 'speech_unavailable', 'The speech service is not installed in this build.', false)
      return speech.transcribeRoute(req)
    }
    case 'POST /api/check': {
      const lean = await load<LeanModule>('./lean/index')
      if (!lean) return apiError(503, 'checker_unavailable', 'The Lean checker is not installed in this build.', false)
      return lean.checkRoute(req)
    }
    default:
      return apiError(404, 'not_found', `No route ${route}`, false)
  }
}
