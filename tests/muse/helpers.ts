// Test helpers for the Muse track. Everything here is SYNTHETIC: a fake key, mocked fetch replies
// shaped like documented Responses objects, and labelled fixtures. Nothing here is live Muse output.

import { randomUUID } from 'node:crypto'
import type { AssistantRequest } from '../../src/workspace/actions'
import { type Doc, demoDocument, docToJson } from '../../src/workspace/document'
import type { ApiRequest } from '../../server/types'

/** A fake, clearly synthetic key in the documented LLM_{id}_{secret} shape. Never a real credential. */
export const SYNTHETIC_KEY = `LLM_synthetictest_${randomUUID().replace(/-/g, '')}`
export const LIVE_ENV = { META_API_KEY: SYNTHETIC_KEY }

export function assistantRequest(prompt: string, doc: Doc = demoDocument(), over: Partial<AssistantRequest> = {}): AssistantRequest {
  return { requestId: `req-${randomUUID()}`, workspaceId: doc.workspaceId, baseRevision: doc.revision, prompt, context: { contextVersion: 1, document: docToJson(doc), evidence: [] }, ...over }
}

export function apiRequest(body: unknown, signal: AbortSignal = new AbortController().signal): ApiRequest {
  return { method: 'POST', path: '/api/assistant', body, signal }
}

/** A synthetic provider reply shaped like the documented Response object (not a recorded live reply). */
export function syntheticReply(text: string, over: Record<string, unknown> = {}): Response {
  const body = {
    id: 'resp_synthetic', object: 'response', created_at: 0, status: 'completed', model: 'muse-spark-1.3',
    output: [
      { type: 'reasoning', id: 'rs_synthetic', summary: [] },
      { id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    ...over,
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

export const syntheticProposal = (actions: unknown[] = [], extra: Record<string, unknown> = {}) => JSON.stringify({ proposalVersion: 1, title: 'Synthetic proposal', explanation: 'Synthetic test output.', actions, ...extra })

export interface Call {
  url: string
  init: RequestInit
  body: Record<string, unknown>
}

/** A mocked fetch that records every call and answers from a queue of synthetic replies. */
export function mockFetch(...replies: (Response | ((init: RequestInit) => Promise<Response>) | Error)[]) {
  const calls: Call[] = []
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init.body)) })
    const next = replies.shift()
    if (next === undefined) throw new Error('synthetic mock: no reply queued')
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(init)
    return next
  }) as typeof fetch
  return { fetchImpl, calls }
}

/** A reply that never arrives: it rejects only when the request's signal aborts. */
export const hangUntilAborted = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const s = init.signal!
    if (s.aborted) reject(s.reason)
    s.addEventListener('abort', () => reject(s.reason), { once: true })
  })

// ------------------------------------------------------------------ minimal validator for the strict subset

type Schema = Record<string, unknown>

/** Validates an instance against the keywords the proposal schema uses. Returns the first error or null. */
export function schemaError(schema: Schema, x: unknown, path = '$'): string | null {
  if (Array.isArray(schema.anyOf)) {
    const errs = (schema.anyOf as Schema[]).map((s) => schemaError(s, x, path))
    return errs.includes(null) ? null : `${path}: matches no anyOf variant (${errs[0]})`
  }
  const t = schema.type
  const ok =
    t === 'object' ? typeof x === 'object' && x !== null && !Array.isArray(x)
      : t === 'array' ? Array.isArray(x)
        : t === 'integer' ? Number.isInteger(x)
          : t === 'number' ? typeof x === 'number'
            : t === 'null' ? x === null
              : typeof x === t
  if (!ok) return `${path}: expected ${String(t)}`
  if (Array.isArray(schema.enum) && !schema.enum.includes(x)) return `${path}: not in enum`
  if (t === 'array') {
    for (const [i, v] of (x as unknown[]).entries()) {
      const e = schemaError(schema.items as Schema, v, `${path}[${i}]`)
      if (e) return e
    }
  }
  if (t === 'object') {
    const props = schema.properties as Record<string, Schema>
    const o = x as Record<string, unknown>
    for (const k of Object.keys(o)) if (!(k in props)) return `${path}: unknown field ${k}`
    for (const k of schema.required as string[]) if (!(k in o)) return `${path}: missing ${k}`
    for (const [k, s] of Object.entries(props)) {
      const e = schemaError(s, o[k], `${path}.${k}`)
      if (e) return e
    }
  }
  return null
}
