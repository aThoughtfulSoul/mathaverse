// Prepared templates by reference (docs/MUSE.md "Prepared templates by reference"). The context gives the model
// application-computed, validated action lists (prepared.*, prepared.four.*, proofLesson.templates.*). Instead of
// copying a long list token by token, the model may emit {"kind": "use_prepared", "template": "<path>"}; the server
// replaces it with exactly that list, computed on the same document, before the usual validation (parseProposal,
// then planTransaction). The client never sees a reference: the proposal it receives holds ordinary actions.
// The first live run showed why: asked to open the proof lesson, muse-spark-1.3 repeated the first step of the
// 3 KB template in a loop instead of copying the rest.

import type { ActionJson } from '../../src/workspace/actions'
import type { Doc } from '../../src/workspace/document'
import { preparedTemplates } from './order'
import { fourTemplates } from './four'
import { proofLessonBlock } from './walk'

export const USE_PREPARED = 'use_prepared'

/** The context's template blocks, exactly as the model receives them (prompt.ts contextBlock). */
export function preparedContext(doc: Doc) {
  return { prepared: { ...preparedTemplates(doc), four: fourTemplates(doc) }, proofLesson: proofLessonBlock(doc) }
}

/** Every template available on `doc`, by its path in the context ("prepared.four.quarterTurnZ",
 *  "proofLesson.templates.openLesson"). A template given as {unavailable} or with no actions has no entry. */
export function preparedCatalog(doc: Doc): Map<string, ActionJson[]> {
  const out = new Map<string, ActionJson[]>()
  const visit = (node: unknown, path: string, depth: number) => {
    if (typeof node !== 'object' || node === null || Array.isArray(node) || depth > 4) return
    const o = node as Record<string, unknown>
    if (Array.isArray(o.actions)) {
      if (!('unavailable' in o) && o.actions.length) out.set(path, o.actions as ActionJson[])
      return
    }
    for (const [k, v] of Object.entries(o)) visit(v, `${path}.${k}`, depth + 1)
  }
  const ctx = preparedContext(doc)
  visit(ctx.prepared, 'prepared', 0)
  visit(ctx.proofLesson.templates, 'proofLesson.templates', 0)
  return out
}

const isReference = (a: unknown): a is Record<string, unknown> => typeof a === 'object' && a !== null && !Array.isArray(a) && (a as { kind?: unknown }).kind === USE_PREPARED

/** Where a reference was expanded: its position in the model's actions and the template's length. */
export interface Expansion {
  template: string
  at: number
  length: number
}

/** Replace a use_prepared reference in a raw proposal by a copy of its template's actions, computed on `doc`.
 *  A proposal without one is returned unchanged; a malformed or unavailable reference is an error whose
 *  message goes to the model's single repair turn. */
export function expandPrepared(raw: unknown, doc: Doc): { ok: true; value: unknown; expansion?: Expansion } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: true, value: raw }
  const actions = (raw as { actions?: unknown }).actions
  if (!Array.isArray(actions)) return { ok: true, value: raw }
  const refs = actions.filter(isReference)
  if (!refs.length) return { ok: true, value: raw }
  if (refs.length > 1) return { ok: false, message: 'use at most one use_prepared reference per proposal' }
  const r = refs[0]!
  if (Object.keys(r).sort().join(',') !== 'kind,template' || typeof r.template !== 'string') return { ok: false, message: 'use_prepared takes exactly {"kind": "use_prepared", "template": "<path>"}' }
  const catalog = preparedCatalog(doc)
  const t = catalog.get(r.template)
  // The schema's enum already limits the paths; this guards copies from an earlier document or a hand-built reply.
  if (!t) return { ok: false, message: `use_prepared: "${r.template.slice(0, 80)}" is not a prepared template available now; use a path from the use_prepared enum, or the actions themselves` }
  const copy = JSON.parse(JSON.stringify(t)) as ActionJson[]
  return { ok: true, value: { ...(raw as Record<string, unknown>), actions: actions.flatMap((a) => (a === r ? copy : [a])) }, expansion: { template: r.template, at: actions.indexOf(r), length: copy.length } }
}

/** A validation message about the expanded list, restated for the model: its positions and counts are the
 *  expanded list's, which the model never wrote. */
export function explainExpanded(message: string, x: Expansion, modelCount: number, limit: number): string {
  const total = modelCount - 1 + x.length
  if (total > limit) return `use_prepared "${x.template}" expands to ${x.length} actions; with ${modelCount - 1} more the proposal has ${total}, above ${limit}`
  return `positions count the expanded list (use_prepared "${x.template}" at actions[${x.at}] became actions[${x.at}..${x.at + x.length - 1}]): ${message}`
}
