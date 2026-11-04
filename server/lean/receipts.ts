// Bounded, session-scoped receipt registry (WORKSPACE-AND-AI W6). Only the check route issues receipts,
// and only after a successful compile and audit. Each receipt is bound to the claim hash the server
// recomputed, the template version, toolchain, theorem and audited axioms. Nothing a browser sends can
// create or extend one; lookups must present the matching claim hash.

import { randomUUID } from 'node:crypto'

export interface ReceiptRecord {
  id: string
  claimHash: string
  templateVersion: string
  toolchain: string
  theorem: string
  axioms: string[]
  issuedAt: string
}

export type ReceiptBinding = Omit<ReceiptRecord, 'id' | 'issuedAt'>

export interface ReceiptRegistry {
  issue(binding: ReceiptBinding): ReceiptRecord
  /** The receipt if it exists and is bound to exactly this claim hash, else null. */
  resolve(id: string, claimHash: string): ReceiptRecord | null
  readonly size: number
}

/** Oldest receipts are evicted beyond `limit`; the registry lives as long as the server module. */
export function createReceiptRegistry({ limit = 64, now = () => new Date() }: { limit?: number; now?: () => Date } = {}): ReceiptRegistry {
  const records = new Map<string, ReceiptRecord>()
  return {
    issue(b) {
      const r: ReceiptRecord = { ...b, axioms: [...b.axioms], id: randomUUID(), issuedAt: now().toISOString() }
      records.set(r.id, Object.freeze(r))
      while (records.size > limit) records.delete(records.keys().next().value!)
      return structuredClone(r)
    },
    resolve(id, claimHash) {
      const r = records.get(id)
      return r && r.claimHash === claimHash ? structuredClone(r) : null
    },
    get size() {
      return records.size
    },
  }
}
