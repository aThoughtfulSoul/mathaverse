// Local persistence (SPEC S7, WORKSPACE W3): one schema-versioned document in IndexedDB with explicit
// save status, plus validated JSON export/import. Imported JSON is validated and opened as a new
// workspace; it never runs code or makes a network request. If storage fails, the in-memory workspace is
// kept, the status says "Not saved", and export stays available. Browser storage is origin-specific:
// export before moving to a different development origin.

import { type Doc, docFromJson, docToJson, docBytes, DOC_LIMITS, DocumentError } from '../workspace/document'

const DB = 'math-workspace'
const STORE = 'documents'
const KEY = 'current'

export interface SavedRecord {
  savedAt: string
  revision: number
  json: unknown
}

export type SaveStatus =
  | { kind: 'never' }
  | { kind: 'saved'; at: string; revision: number }
  | { kind: 'failed'; reason: string }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const r = f(t.objectStore(STORE))
      t.oncomplete = () => resolve(r.result)
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'))
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}

/** Test seam: make the next save fail (ACCEPTANCE A3 "simulate storage failure"). */
export const storageDebug = { failNextSave: false }

export async function saveDocument(doc: Doc): Promise<SaveStatus> {
  try {
    if (storageDebug.failNextSave) {
      storageDebug.failNextSave = false
      throw new Error('simulated storage failure')
    }
    const json = docToJson(doc)
    if (docBytes(json) > DOC_LIMITS.maxBytes) throw new Error('document above 256 KiB')
    const rec: SavedRecord = { savedAt: new Date().toISOString(), revision: doc.revision, json }
    await tx('readwrite', (s) => s.put(rec, KEY))
    return { kind: 'saved', at: rec.savedAt, revision: doc.revision }
  } catch (e) {
    return { kind: 'failed', reason: (e as Error).message }
  }
}

/** The last saved document, validated; null when nothing was saved. Throws DocumentError if invalid. */
export async function loadSaved(): Promise<{ doc: Doc; savedAt: string } | null> {
  const rec = (await tx('readonly', (s) => s.get(KEY))) as SavedRecord | undefined
  if (!rec) return null
  return { doc: docFromJson(rec.json), savedAt: rec.savedAt }
}

export function exportText(doc: Doc): string {
  return `${JSON.stringify(docToJson(doc), null, 2)}\n`
}

/** Validate imported JSON text (size first, then the strict document validator). */
export function importText(text: string): Doc {
  if (new TextEncoder().encode(text).length > DOC_LIMITS.maxBytes) throw new DocumentError('import: file above 256 KiB')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new DocumentError('import: not JSON')
  }
  return docFromJson(json)
}
