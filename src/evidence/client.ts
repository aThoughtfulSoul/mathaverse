// Evidence for the three M9 claim kinds (WORKSPACE-AND-AI W6, ACCEPTANCE A5). Labels distinguish
// "Computed exactly" (local rational evaluation), "Checking", "Lean checked: [claim]", "Not verified" and
// historical results. A Lean status comes only from a server `checked` response whose claim hash equals
// the hash of the requested claim, and it counts as current only while that hash equals the hash of the
// same claim recomputed from the CURRENT document; any relevant map or sample change makes the entry
// historical (still labelled, with a historical marker). Moving or renaming displays does not (the hash
// covers only the mathematical content). Receipts are never read from imported JSON. The list keeps 12 entries:
// beyond that it drops the not_sent refusals first (oldest first), then the oldest other settled entries, and never
// one that is still computed or checking.

import type { App } from '../app'
import { describeClaim } from '../workspace/reducer'
import { type ClaimRequest, type ClaimDescriptor, type CheckResponse, type LocalEvaluation, parseClaimDescriptor, claimHash, evaluateExactly } from '../workspace/claims'
import type { WalkClaimDescriptor } from '../workspace/walkClaim'
import { type EvidenceRef, API_LIMITS } from '../workspace/actions'
import { type QJson, fromJson as qFromJson } from '../model/rational'
import { vecTex, vecText, plainName } from '../rendering/viewDescription'

/** `not_sent`: refused locally because another check was running (one at a time, W6); Lean was not asked. */
export type EvidenceStatus = 'computed' | 'not_sent' | 'checking' | 'checked' | 'not_established' | 'error'

export interface EvidenceEntry {
  id: number
  request: ClaimRequest
  descriptor: ClaimDescriptor
  claimHash: string
  /** Readable claim in the workspace's own names ("u ≠ v and Pu = Pv"). */
  label: string
  local: LocalEvaluation
  status: EvidenceStatus
  response: CheckResponse | null
  error: string | null
  /** False once the claim recomputed from the current document has a different hash (historical). */
  current: boolean
}

const AXES = ['x', 'y', 'z']

/** Entries the list keeps (more only while that many are unsettled, which one check at a time rules out). */
const MAX_ENTRIES = 12

function symbolOf(steps: { label: string }[], as: 'plain' | 'tex' = 'tex'): string {
  return steps.length ? [...steps].reverse().map((s) => (as === 'plain' ? plainName(s.label) : s.label)).join('') : 'I'
}

/**
 * A witness's name in panel and scene text: its sample label, or else its exact coordinates in the claim.
 * Never a placeholder letter or a generated scene name (w, w2 follow the selection and would later name
 * another sample), and never the sample ID (a dragged sample keeps the ID of its original position).
 */
function witnessName(w: { label: string; coords: QJson[] }, as: 'plain' | 'tex'): string {
  if (w.label) return as === 'tex' ? w.label : plainName(w.label)
  const v = w.coords.map((c) => qFromJson(c))
  return as === 'tex' ? vecTex(v) : vecText(v)
}

function labelOf(d: ClaimDescriptor): string {
  switch (d.kind) {
    case 'same_image_witness': {
      const S = symbolOf(d.sequence, 'plain')
      const u = witnessName(d.u, 'plain')
      const v = witnessName(d.v, 'plain')
      return `${u} ≠ ${v} and ${S}${u} = ${S}${v}`
    }
    case 'map_equality':
      return `${symbolOf(d.left, 'plain')} = ${symbolOf(d.right, 'plain')} (every entry)`
    case 'map_difference_witness':
      return `${symbolOf(d.left, 'plain')}e${d.basisIndex + 1} ≠ ${symbolOf(d.right, 'plain')}e${d.basisIndex + 1} (they differ on e_${AXES[d.basisIndex]})`
    case 'walk_reorder_instance':
      return walkClaimLabel(d)
  }
}

/** The proof lesson's finite claim in words (src/workspace/walkClaim.ts): one example, every prefix. */
export function walkClaimLabel(d: WalkClaimDescriptor): string {
  return `this ${d.vectors.length}-arrow walk and its signs: closed walk, bounds B and D, the reordering and every reordered prefix within (B + D)/2`
}

export class EvidenceClient {
  readonly entries: EvidenceEntry[] = []
  private nextId = 1
  private busy = false
  /** Revalidation generation: only the newest run may write `current` (runs await hashes and can finish out of order). */
  private revalGen = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly app: App) {
    app.workspace.subscribe(() => void this.revalidate())
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed(): void {
    this.listeners.forEach((fn) => fn())
  }

  /** Evidence references for assistant context: the server resolves receipts itself (W5). */
  refs(): EvidenceRef[] {
    // W5: each reference carries its typed claim locator; the server rebuilds and rehashes the claim from
    // the submitted document before it resolves the receipt (the browser's hash is only a lookup key).
    return this.entries.filter((e) => e.current && e.status === 'checked' && e.response?.receipt).slice(-API_LIMITS.evidenceRefs).map((e) => ({ claim: structuredClone(e.request), claimHash: e.claimHash, receiptId: e.response!.receipt!.id }))
  }

  /** Evaluate exactly now, then ask the Lean service. One check at a time (W6). */
  async check(request: ClaimRequest): Promise<EvidenceEntry | null> {
    const descriptor = describeClaim(this.app.workspace.current, request)
    const exact = parseClaimDescriptor(descriptor)
    const entry: EvidenceEntry = {
      id: this.nextId++, request, descriptor, claimHash: await claimHash(exact), label: labelOf(descriptor),
      local: evaluateExactly(exact), status: 'computed', response: null, error: null, current: true,
    }
    this.entries.unshift(entry)
    this.trim()
    this.changed()
    if (this.busy) {
      entry.status = 'not_sent'
      entry.error = 'another check was running'
      this.changed()
      return entry
    }
    this.busy = true
    entry.status = 'checking'
    this.changed()
    try {
      const res = await fetch('/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: crypto.randomUUID(), claim: descriptor }) })
      const json = (await res.json().catch(() => null)) as (CheckResponse & { code?: string; message?: string }) | null
      if (!res.ok || !json || !('status' in json)) {
        entry.status = 'error'
        entry.error = json?.message ?? `HTTP ${res.status}`
      } else if (json.claimHash !== entry.claimHash) {
        // The server checked something else than we asked about: never show it as evidence for this claim.
        entry.status = 'error'
        entry.error = 'the checked claim does not match the requested claim'
        entry.response = json
      } else {
        entry.response = json
        entry.status = json.status === 'checked' && json.receipt ? 'checked' : json.status === 'error' ? 'error' : 'not_established'
        entry.error = json.reason
      }
    } catch (e) {
      entry.status = 'error'
      entry.error = (e as Error).message
    } finally {
      this.busy = false
    }
    this.changed() // the result itself (revalidate below notifies only when `current` flips)
    await this.revalidate()
    return entry
  }

  /**
   * Keep at most MAX_ENTRIES: first drop the not_sent refusals (oldest first), then the oldest other SETTLED
   * entries. A refusal asked Lean nothing, so a burst of them never evicts a Lean result (a receipt, a "not
   * established", a checker error) while refusals remain. An entry still computed or checking is never dropped:
   * the refusals must not evict the check whose result is awaited (the status line and the assistant's check
   * line follow it by id).
   */
  private trim(): void {
    const drop = (evictable: (s: EvidenceStatus) => boolean) => {
      for (let i = this.entries.length - 1; i >= 0 && this.entries.length > MAX_ENTRIES; i--) {
        if (evictable(this.entries[i]!.status)) this.entries.splice(i, 1)
      }
    }
    drop((s) => s === 'not_sent')
    drop((s) => s !== 'computed' && s !== 'checking')
  }

  /**
   * Recompute each entry's claim from the current document; a different hash makes it historical. An
   * identical hash again (after undo, say) is the same claim about the same exact data, so the entry is
   * current again: its receipt is bound to that hash, never to a revision. A run that a newer document
   * change overtook writes nothing, so a late run for an older document cannot restore an entry.
   */
  private async revalidate(): Promise<void> {
    const gen = ++this.revalGen
    const doc = this.app.workspace.current
    const results: [EvidenceEntry, boolean][] = []
    for (const e of [...this.entries]) {
      let now: string | null = null
      try {
        now = await claimHash(parseClaimDescriptor(describeClaim(doc, e.request)))
      } catch {
        now = null // the referenced experiment or sample no longer exists
      }
      results.push([e, now === e.claimHash])
    }
    if (gen !== this.revalGen) return
    let any = false
    for (const [e, current] of results) {
      if (current !== e.current) {
        e.current = current
        any = true
      }
    }
    if (any) this.changed()
  }

  /** The scene line for the most recent entry (TeX + plain fallback), or null. */
  sceneLine(): { tex: string; plain: string; kind: 'checked' | 'pending' | 'other' } | null {
    // A request refused while another check ran does not replace the line of the check that is running.
    const e = this.entries.find((x) => x.status !== 'not_sent') ?? this.entries[0]
    if (!e) return null
    const d = e.descriptor
    // A claim that exact evaluation found false is never shown as merely unverified: the line states the
    // computed correction instead (W6: local exact evaluation provides the correction for a false claim).
    const refuted = !e.local.holds && e.status !== 'checked'
    let claimTex: string
    if (d.kind === 'same_image_witness') {
      const S = symbolOf(d.sequence)
      const u = witnessName(d.u, 'tex')
      const v = witnessName(d.v, 'tex')
      const sameInput = JSON.stringify(d.u.coords) === JSON.stringify(d.v.coords)
      claimTex = !refuted ? `${u} \\neq ${v}\\textsf{ and }${S}${u} = ${S}${v}` : sameInput ? `${u} = ${v}` : `${S}${u} \\neq ${S}${v}`
    } else if (d.kind === 'map_equality') claimTex = `${symbolOf(d.left)} ${refuted ? '\\neq' : '='} ${symbolOf(d.right)}`
    else if (d.kind === 'map_difference_witness') claimTex = `${symbolOf(d.left)}e_{${d.basisIndex + 1}} ${refuted ? '=' : '\\neq'} ${symbolOf(d.right)}e_{${d.basisIndex + 1}}`
    else claimTex = refuted ? `\\textsf{the reordering lemma does not apply to this walk}` : `\\textsf{reordering bound, this ${d.vectors.length}-arrow example}`
    const hist = e.current ? '' : '\\textsf{ (historical)}'
    const head = refuted ? 'Computed exactly: ' : e.status === 'checked' ? 'Lean checked: ' : e.status === 'checking' ? 'Checking: ' : e.status === 'computed' ? 'Computed exactly: ' : e.status === 'not_sent' ? 'Not sent to Lean: ' : 'Not verified by Lean: '
    const tail = refuted ? '\\textsf{ (the requested claim is false)}' : ''
    return { tex: `\\textsf{${head}}${claimTex}${tail}${hist}`, plain: EvidenceClient.describe(e), kind: e.status === 'checked' && e.current ? 'checked' : e.status === 'checking' && !refuted ? 'pending' : 'other' }
  }

  /** The application-owned status text for an entry (never model prose). */
  static describe(e: EvidenceEntry): string {
    const hist = e.current ? '' : ' (historical: the workspace changed since)'
    switch (e.status) {
      case 'computed':
        if (!e.local.holds) return `Computed exactly: the claim ${e.label} is false (${e.local.detail})${hist}`
        return `Computed exactly: ${e.label} holds (${e.local.detail})${hist}`
      case 'not_sent':
        return `Not sent to Lean (another check was running): ${e.label}. Computed exactly: ${e.local.holds ? 'holds' : 'does not hold'}${hist}`
      case 'checking':
        if (!e.local.holds) return `Computed exactly: the claim ${e.label} is false (${e.local.detail})${hist}`
        return `Checking: ${e.label}…${hist}`
      case 'checked':
        return `Lean checked: ${e.label}, over the exact rational data${hist}`
      case 'not_established':
        if (!e.local.holds) return `Computed exactly: the claim ${e.label} is false (${e.local.detail}), so Lean was not asked to prove it${hist}`
        return `Not verified by Lean: ${e.label}${e.error ? ` (${e.error})` : ''}. Computed exactly: holds${hist}`
      case 'error':
        return `Not verified by Lean: ${e.label} (checker error: ${e.error ?? 'unknown'}). Computed exactly: ${e.local.holds ? 'holds' : 'does not hold'}${hist}`
    }
  }
}
