// Exact rationals (MATHEMATICAL-CONTRACT M1). Integer arithmetic only; floats appear only in toFloat()
// for display. Every result is normalized: positive denominator, coprime, canonical zero 0/1.

export interface Q {
  readonly n: bigint
  readonly d: bigint
}

/** Serialized form `{ "n": "-3", "d": "8" }`. */
export interface QJson {
  n: string
  d: string
}

export class CapacityError extends Error {
  override name = 'CapacityError'
}

export class RationalFormatError extends Error {
  override name = 'RationalFormatError'
}

/** M1 engineering limits. */
export const LIMITS = {
  authoredMin: -4n,
  authoredMax: 4n,
  maxDenominator: 1_000_000n,
  maxBits: 256,
} as const

const INT_RE = /^(0|-?[1-9][0-9]*)$/

function abs(a: bigint): bigint {
  return a < 0n ? -a : a
}

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a)
  b = abs(b)
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function bitLength(a: bigint): number {
  return abs(a).toString(2).length
}

function checkBudget(n: bigint, d: bigint): void {
  if (bitLength(n) > LIMITS.maxBits || bitLength(d) > LIMITS.maxBits) {
    throw new CapacityError(`rational exceeds the ${LIMITS.maxBits}-bit arithmetic budget`)
  }
}

export function q(n: bigint | number, d: bigint | number = 1n): Q {
  const bn = typeof n === 'number' ? toBigIntStrict(n) : n
  const bd = typeof d === 'number' ? toBigIntStrict(d) : d
  if (bd === 0n) throw new RationalFormatError('zero denominator')
  if (bn === 0n) return ZERO
  const sign = bd < 0n ? -1n : 1n
  const g = gcd(bn, bd)
  const rn = (sign * bn) / g
  const rd = (sign * bd) / g
  checkBudget(rn, rd)
  return { n: rn, d: rd }
}

function toBigIntStrict(x: number): bigint {
  if (!Number.isInteger(x)) throw new RationalFormatError(`not an integer: ${x}`)
  return BigInt(x)
}

export const ZERO: Q = Object.freeze({ n: 0n, d: 1n })
export const ONE: Q = Object.freeze({ n: 1n, d: 1n })
export const NEG_ONE: Q = Object.freeze({ n: -1n, d: 1n })

export const add = (a: Q, b: Q): Q => q(a.n * b.d + b.n * a.d, a.d * b.d)
export const sub = (a: Q, b: Q): Q => q(a.n * b.d - b.n * a.d, a.d * b.d)
export const mul = (a: Q, b: Q): Q => q(a.n * b.n, a.d * b.d)
export const neg = (a: Q): Q => (a.n === 0n ? ZERO : { n: -a.n, d: a.d })
export const eq = (a: Q, b: Q): boolean => a.n === b.n && a.d === b.d
export const isZero = (a: Q): boolean => a.n === 0n
export const cmp = (a: Q, b: Q): number => {
  const l = a.n * b.d
  const r = b.n * a.d
  return l < r ? -1 : l > r ? 1 : 0
}

/** Display only. Never feed the result back into committed state. */
export const toFloat = (a: Q): number => Number(a.n) / Number(a.d)

export function toJson(a: Q): QJson {
  return { n: a.n.toString(), d: a.d.toString() }
}

/** Strict import: decimal integer strings, positive denominator, already coprime, zero as 0/1. */
export function fromJson(j: unknown): Q {
  if (typeof j !== 'object' || j === null) throw new RationalFormatError('rational must be an object')
  const keys = Object.keys(j)
  if (keys.length !== 2 || !keys.includes('n') || !keys.includes('d')) {
    throw new RationalFormatError('rational must have exactly the fields n and d')
  }
  const { n, d } = j as Record<string, unknown>
  if (typeof n !== 'string' || typeof d !== 'string' || !INT_RE.test(n) || !INT_RE.test(d)) {
    throw new RationalFormatError('n and d must be decimal integer strings')
  }
  const bn = BigInt(n)
  const bd = BigInt(d)
  if (bd <= 0n) throw new RationalFormatError('denominator must be positive')
  if (bn === 0n && bd !== 1n) throw new RationalFormatError('zero must be encoded as 0/1')
  if (gcd(bn, bd) !== 1n) throw new RationalFormatError('numerator and denominator must be coprime')
  checkBudget(bn, bd)
  return { n: bn, d: bd }
}

/** M1 authored-input bounds: value in [-4, 4] and denominator at most 1,000,000. */
export function checkAuthored(a: Q, what = 'value'): void {
  if (a.d > LIMITS.maxDenominator) throw new CapacityError(`${what}: denominator above ${LIMITS.maxDenominator}`)
  if (cmp(a, q(LIMITS.authoredMin)) < 0 || cmp(a, q(LIMITS.authoredMax)) > 0) {
    throw new CapacityError(`${what}: outside the authored range [-4, 4]`)
  }
}

/** M5 default snapping: nearest multiple of 1/8, clamped to the authored range. */
export function snapEighth(x: number): Q {
  if (!Number.isFinite(x)) throw new RationalFormatError('cannot snap a non-finite value')
  const k = Math.max(-32, Math.min(32, Math.round(x * 8)))
  return q(k, 8)
}

/** Plain-text form: "3/8", "-1", "0". */
export function format(a: Q): string {
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`
}

/** TeX form: "\\tfrac{3}{8}", "-\\tfrac{1}{2}", "1". */
export function tex(a: Q): string {
  if (a.d === 1n) return a.n.toString()
  const sign = a.n < 0n ? '-' : ''
  return `${sign}\\tfrac{${abs(a.n)}}{${a.d}}`
}
