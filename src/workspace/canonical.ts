// Canonical JSON and hashing shared by browser and server (WORKSPACE-AND-AI W5): object keys sorted,
// array order kept, rationals already in normalized QJson form, UTF-8, SHA-256. A client-supplied hash
// never substitutes for the server recomputing it with this same code.

export class CanonicalError extends Error {
  override name = 'CanonicalError'
}

function encode(value: unknown, path: string): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalError(`${path}: non-finite number`)
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(',')}]`
      const proto = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) throw new CanonicalError(`${path}: not a plain object`)
      const keys = Object.keys(value as object).sort()
      const parts: string[] = []
      for (const k of keys) {
        const v = (value as Record<string, unknown>)[k]
        if (v === undefined) continue
        parts.push(`${JSON.stringify(k)}:${encode(v, `${path}.${k}`)}`)
      }
      return `{${parts.join(',')}}`
    }
    default:
      throw new CanonicalError(`${path}: ${typeof value} is not JSON`)
  }
}

/** Deterministic JSON text: sorted keys, no whitespace, `undefined` fields omitted. */
export function canonicalJson(value: unknown): string {
  return encode(value, '$')
}

/** Lowercase hex SHA-256 of the UTF-8 text (WebCrypto: browsers and Node >= 19). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Versioned hash payloads: a context hash and a claim hash can never collide by construction. */
export const HASH_VERSION = { context: 'context-v1', claim: 'claim-v1' } as const

export async function versionedHash(version: string, payload: unknown): Promise<string> {
  return sha256Hex(canonicalJson({ version, payload }))
}
