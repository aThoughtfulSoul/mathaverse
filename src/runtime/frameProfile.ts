// Per-stage JavaScript timing of the frame path (R6 follow-up F1: profile drag/playback before changing
// anything). Each stage keeps a ring of its last 900 samples (ms), so p50/p95/max over ~10 s can be read
// at any time. This is JavaScript callback time only: it is not GPU or compositor time (keep J-level
// evidence separate from Perfetto). Cost: two performance.now() calls per stage per frame.

const N = 900

interface Ring {
  values: Float32Array
  next: number
  count: number
}

const rings = new Map<string, Ring>()
let enabled = true

export function profileStage(stage: string, ms: number): void {
  if (!enabled) return
  let r = rings.get(stage)
  if (!r) rings.set(stage, (r = { values: new Float32Array(N), next: 0, count: 0 }))
  r.values[r.next] = ms
  r.next = (r.next + 1) % N
  r.count = Math.min(N, r.count + 1)
}

/** Time `f` as `stage` (returns f's result). */
export function timed<T>(stage: string, f: () => T): T {
  const t0 = performance.now()
  try {
    return f()
  } finally {
    profileStage(stage, performance.now() - t0)
  }
}

export function profileReport(): Record<string, { n: number; mean: number; p50: number; p95: number; max: number }> {
  const out: Record<string, { n: number; mean: number; p50: number; p95: number; max: number }> = {}
  for (const [k, r] of rings) {
    const xs = Array.from(r.values.subarray(0, r.count)).sort((a, b) => a - b)
    if (!xs.length) continue
    const q = (p: number) => +xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!.toFixed(3)
    out[k] = { n: xs.length, mean: +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(3), p50: q(0.5), p95: q(0.95), max: +xs[xs.length - 1]!.toFixed(3) }
  }
  return out
}

export function profileReset(): void {
  rings.clear()
}

export function profileEnable(on: boolean): void {
  enabled = on
}
