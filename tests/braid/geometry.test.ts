// Worker C: strand geometry. The canonical relation family (knot tables, collars, fixed endpoints, crossing
// order at lambda = 0 and 1, depth-separated triple point), its embedding at a word's span (continuity at the
// prefix/suffix joins, agreement with the generic geometry at the phase boundaries), the inverse-cancellation
// family, rendered over/under against the exact crossing interpretation, and sampled clearances.
// Sampling supports the implementation; it is not a topology proof.
import { describe, expect, it } from 'vitest'
import type { Generator } from '../../src/algebra/braid'
import { type Clip, PoseInfo, clipDuration, clipPhases, poseClip } from '../../src/domains/braid/animator'
import { CANCEL_PATH, cancelCenterline, cancelOver } from '../../src/domains/braid/cancel'
import { centerlineClearance, crossingEvents, planClearance } from '../../src/domains/braid/clearance'
import { GEOMETRY, STRAND_NAMES } from '../../src/domains/braid/constants'
import { envelope, step } from '../../src/domains/braid/curves'
import { describeWord } from '../../src/domains/braid/derive'
import { MOTIF_CANCEL, MOTIF_RELATION, Plan, StrandEvaluator, motifLayout, setMotifPlan, staticPlan } from '../../src/domains/braid/plan'
import { RELATION_L, RELATION_R, type MotifParams, knotLevel, relationCenterline, tableX } from '../../src/domains/braid/relation'

const ev = new StrandEvaluator()
const prm: MotifParams = { epsilon: 0.12, shoulder: GEOMETRY.shoulder, h: 0.4, H: 6 }
const name = (s: number) => STRAND_NAMES[s]!
const events = (p: Plan) => crossingEvents(p, 0.0002, ev).map((e) => `${name(e.over)}>${name(e.under)}`)
const lambdas = Array.from({ length: 21 }, (_, i) => i / 20)

/** Sampled minimum distance between different strands of the normalized family (all t pairs). */
function familyMinDistance(lambda: number, samples = 400): number {
  const pts: number[][][] = [0, 1, 2].map((i) => Array.from({ length: samples }, (_, m) => relationCenterline(i, m / (samples - 1), lambda, prm, [0, 0, 0])))
  let best = Infinity
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++)
      for (const p of pts[i]!) for (const q of pts[j]!) best = Math.min(best, Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!))
  return best
}

describe('the canonical relation family (normalized, handoff section 8)', () => {
  it('matches the L and R knot tables at the four equally spaced knot levels', () => {
    for (let i = 0; i < 3; i++)
      for (let m = 0; m < 4; m++) {
        const t = knotLevel(m, prm.epsilon)
        expect(tableX(RELATION_L, i, t, prm.epsilon, prm.shoulder)).toBeCloseTo(RELATION_L[i]![m]!, 12)
        expect(tableX(RELATION_R, i, t, prm.epsilon, prm.shoulder)).toBeCloseTo(RELATION_R[i]![m]!, 12)
        expect(relationCenterline(i, t, 0, prm)[0]).toBeCloseTo(RELATION_L[i]![m]!, 12)
        expect(relationCenterline(i, t, 1, prm)[0]).toBeCloseTo(RELATION_R[i]![m]!, 12)
      }
    expect(knotLevel(0, prm.epsilon)).toBeCloseTo(prm.epsilon, 12)
    expect(knotLevel(3, prm.epsilon)).toBeCloseTo(1 - prm.epsilon, 12)
  })

  it('keeps endpoints fixed and collars constant for every lambda', () => {
    for (const l of lambdas)
      for (let i = 0; i < 3; i++) {
        const start = relationCenterline(i, 0, l, prm)
        expect(start[0]).toBeCloseTo(i - 1, 12)
        expect(Math.abs(start[1]!)).toBe(0)
        expect(start[2]).toBe(0)
        const end = relationCenterline(i, 1, l, prm)
        expect(end[0]).toBeCloseTo(1 - i, 12)
        expect(Math.abs(end[1]!)).toBe(0)
        expect(end[2]).toBe(prm.H)
        for (const t of [0.02, 0.06, prm.epsilon]) expect(relationCenterline(i, t, l, prm)[0]).toBeCloseTo(i - 1, 12)
        for (const t of [1 - prm.epsilon, 0.95]) expect(relationCenterline(i, t, l, prm)[0]).toBeCloseTo(1 - i, 12)
      }
  })

  it('has the same monotone step between knot levels and the envelope b(t)', () => {
    for (let s = 0; s < 1; s += 0.01) expect(step(s + 0.01, prm.shoulder)).toBeGreaterThanOrEqual(step(s, prm.shoulder))
    expect(envelope(0, 0.1)).toBe(0)
    expect(envelope(1, 0.1)).toBe(0)
    expect(envelope(0.1, 0.1)).toBe(1)
    expect(envelope(0.5, 0.1)).toBe(1)
    expect(envelope(0.05, 0.1)).toBeCloseTo(0.5, 12)
  })

  it('has distinct depths in the knot region and distinct horizontals in the collars (no centerline meets)', () => {
    for (const l of lambdas) {
      for (let t = prm.epsilon; t <= 1 - prm.epsilon; t += 0.01) {
        const z = [0, 1, 2].map((i) => relationCenterline(i, t, l, prm)[1]!)
        expect(new Set(z).size).toBe(3)
      }
      expect(familyMinDistance(l, 240)).toBeGreaterThan(0.39)
    }
  })

  it('degenerates to a depth-separated triple point in projection at lambda = 1/2', () => {
    const t = (knotLevel(1, prm.epsilon) + knotLevel(2, prm.epsilon)) / 2
    const pts = [0, 1, 2].map((i) => relationCenterline(i, t, 0.5, prm))
    for (const p of pts) expect(p[0]).toBeCloseTo(0, 12)
    expect(pts.map((p) => p[1])).toEqual([prm.h, 0, -prm.h])
  })
})

describe('the relation motif embedded in a word (plan.ts)', () => {
  const hero = (lambda: number, mu = 1) => {
    const p = setMotifPlan(new Plan(), [1, 2, 1], 0, 3, 1)
    p.motif = MOTIF_RELATION
    p.lambda = lambda
    p.mu = mu
    return p
  }

  it('crossing order: lambda = 0 is a over b, a over c, b over c; lambda = 1 is b over c, a over c, a over b', () => {
    expect(events(hero(0))).toEqual(['a>b', 'a>c', 'b>c'])
    expect(events(hero(1))).toEqual(['b>c', 'a>c', 'a>b'])
  })

  it('the three-way coincidence at lambda = 1/2 is separated in depth by h', () => {
    const e = crossingEvents(hero(0.5), 0.0002, ev)
    expect(e.length).toBe(3)
    const u = e[0]!.u
    for (const x of e) expect(x.u).toBeCloseTo(u, 3)
    expect(e.map((x) => +x.depthGap.toFixed(4)).sort()).toEqual([GEOMETRY.motifDepth, GEOMETRY.motifDepth, 2 * GEOMETRY.motifDepth].map((v) => +v.toFixed(4)).sort())
  })

  it('keeps the minimum centerline distance above twice the tube radius over the lambda grid', () => {
    for (const l of lambdas) {
      const c = planClearance(hero(l), ev)
      expect(c.minDistance).toBeGreaterThan(2 * c.radius + 0.008)
    }
    const long: Generator[] = [2, -1, 1, 2, 1, -2, 2]
    for (const l of lambdas) {
      const p = setMotifPlan(new Plan(), long, 2, 3, 1)
      p.motif = MOTIF_RELATION
      p.lambda = l
      p.mu = 1
      const c = planClearance(p, ev)
      expect(c.minDistance).toBeGreaterThan(2 * c.radius + 0.004)
    }
  })

  it('joins the prefix and suffix with continuous position and tangent', () => {
    const long: Generator[] = [2, -1, 1, 2, 1, -2, 2]
    const lay = motifLayout(long.length, 2, 3)
    expect(lay.collar).toBeGreaterThan(0.03)
    for (const l of [0, 0.3, 0.5, 1]) {
      const p = setMotifPlan(new Plan(), long, 2, 3, 1, lay)
      p.motif = MOTIF_RELATION
      p.lambda = l
      p.mu = 1
      ev.prepare(p)
      const fp = ev.footprint()!
      for (const u0 of [fp.start, fp.end])
        for (let s = 0; s < 3; s++) {
          const h = 1e-7
          const a = ev.at3(s, u0 - 1e-9)
          const b = ev.at3(s, u0 + 1e-9)
          expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeLessThan(1e-9)
          const ta = ev.at3(s, u0 - h).map((v, i) => (a[i]! - v) / h)
          const tb = ev.at3(s, u0 + h).map((v, i) => (v - b[i]!) / h)
          expect(Math.hypot(ta[0]! - tb[0]!, ta[2]! - tb[2]!)).toBeLessThan(1e-3)
        }
    }
  })

  it('equals the generic geometry of the source word at mu = 0 (no jump when the motif starts)', () => {
    for (const [w, k, l] of [[[1, 2, 1], 0, 0], [[2, 1, 2], 0, 1], [[2, -1, 1, 2, 1, -2, 2], 2, 0]] as [Generator[], number, number][]) {
      const generic = setMotifPlan(new Plan(), w, k, 3, 1)
      const motif = setMotifPlan(new Plan(), w, k, 3, 1)
      motif.motif = MOTIF_RELATION
      motif.lambda = l
      motif.mu = 0
      const a = new Float32Array(9 * ev.samples)
      const b = new Float32Array(9 * ev.samples)
      ev.evaluate(generic, a)
      ev.evaluate(motif, b)
      let worst = 0
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!))
      expect(worst).toBeLessThan(1e-6)
    }
  })

  it('opening the collars changes no crossing: the static and opened layouts have the same events', () => {
    const w: Generator[] = [2, -1, 1, 2, 1, -2, 2]
    const want = describeWord(w, 'word').crossings.map((c) => `${c.over}>${c.under}`)
    expect(events(staticPlan(w))).toEqual(want)
    expect(events(setMotifPlan(new Plan(), w, 2, 3, 1))).toEqual(want)
  })
})

describe('rendered over/under follows the exact crossing interpretation', () => {
  it('for every crossing of several words, in chronological order', () => {
    const words: Generator[][] = [[1], [-2], [1, 2, 1], [2, 1, 2], [1, 1], [1, -1], [-1, 1], [2, -1, 1, 2, 1, -2, 2], [1, -2, -1, 2, 2, -1, 1, -2]]
    for (const w of words) expect(events(staticPlan(w))).toEqual(describeWord(w, 'word').crossings.map((c) => `${c.over}>${c.under}`))
  })

  it('static clearance: tube surfaces stay apart up to the 24-crossing bound', () => {
    const words: Generator[][] = [[1, 2, 1], [1, 1], [1, -1], [2, -1, 1, 2, 1, -2, 2], Array.from({ length: 24 }, (_, i) => (i % 2 ? 2 : 1) as Generator), Array.from({ length: 24 }, () => -1 as Generator)]
    for (const w of words) {
      const c = planClearance(staticPlan(w), ev)
      expect(c.surfaceGap).toBeGreaterThan(w.length <= 3 ? 0.015 : 0.002)
    }
  })
})

describe('the inverse-cancellation family', () => {
  const cp = { epsilon: 0.12, shoulder: GEOMETRY.shoulder, eta: 0.3, H: 4 }

  it('keeps one physical strand over at both crossings (opposite ranking for the negative-first pair)', () => {
    expect(cancelOver(1)).toBe(0)
    expect(cancelOver(-1)).toBe(1)
    for (const sign of [1, -1]) {
      const over = cancelOver(sign)
      for (let t = 0.13; t < 0.87; t += 0.01) {
        const z0 = cancelCenterline(0, t, 0, 0, sign, cp)[1]!
        const z1 = cancelCenterline(1, t, 0, 0, sign, cp)[1]!
        expect(over === 0 ? z0 > z1 : z1 > z0).toBe(true)
      }
    }
  })

  it('straightens to the constant entry positions with endpoints fixed, then flattens', () => {
    for (const nu of [0, 0.5, 1])
      for (const j of [0, 1] as const) {
        expect(cancelCenterline(j, 0, nu, 0, 1, cp)[0]).toBe(j)
        expect(cancelCenterline(j, 1, nu, 0, 1, cp)[0]).toBeCloseTo(CANCEL_PATH[j]![2]!, 12)
      }
    for (let t = 0; t <= 1; t += 0.05) {
      for (const j of [0, 1] as const) {
        const q = cancelCenterline(j, t, 1, 1, 1, cp)
        expect(q[0]).toBe(j)
        expect(Math.abs(q[1]!)).toBe(0)
        expect(q[2]).toBeCloseTo(cp.H * t, 12)
      }
    }
  })

  it('embedded: endpoints fixed and strands separated through every phase; [1,1] stays a different picture', () => {
    for (const w of [[1, -1], [-2, 2, 1], [2, 1, -1, 2, 2]] as Generator[][]) {
      const k = w[0]! === -w[1]! ? 0 : 1
      for (let i = 0; i <= 20; i++) {
        const p = setMotifPlan(new Plan(), w, k, 2, 1)
        p.motif = MOTIF_CANCEL
        p.mu = Math.min(1, i / 5)
        p.nu = Math.min(1, Math.max(0, (i - 5) / 10))
        p.phi = Math.max(0, (i - 15) / 5)
        const c = planClearance(p, ev)
        expect(c.minDistance).toBeGreaterThan(2 * c.radius + 0.004)
        ev.prepare(p)
        for (let s = 0; s < 3; s++) {
          expect(ev.at3(s, 0)[0]).toBeCloseTo((s - 1) * GEOMETRY.spacing, 12)
          expect(ev.at3(s, GEOMETRY.length)[0]).toBeCloseTo((ev.positionBefore(p.count, s) - 1) * GEOMETRY.spacing, 12)
        }
      }
    }
    expect(events(staticPlan([1, 1]))).toEqual(['a>b', 'b>a'])
  })
})

describe('presentation clips', () => {
  const clips: Clip[] = [
    { kind: 'relation', source: [1, 2, 1], target: [2, 1, 2], at: 0, from: 0 },
    { kind: 'relation', source: [2, -1, 2, 1, 2, -2, 2], target: [2, -1, 1, 2, 1, -2, 2], at: 2, from: 1 },
    { kind: 'cancel', source: [1, -1], target: [], at: 0 },
    { kind: 'cancel', source: [2, 1, -1, 2, 2], target: [2, 2, 2], at: 1 },
    { kind: 'insert', source: [1], target: [1, 2, -2], at: 1 },
    { kind: 'append', source: [1, 2], target: [1, 2, 1] },
  ]

  it('fix both endpoint frames, stay separated, and end exactly on the target word', () => {
    const p = new Plan()
    const info = new PoseInfo()
    for (const c of clips) {
      const T = clipDuration(c)
      const arrival = describeWord(c.target, 'word').arrival
      for (let i = 0; i <= 40; i++) {
        poseClip(c, (T * i) / 40, p, info)
        const pts = new Float32Array(9 * ev.samples)
        ev.evaluate(p, pts)
        const cl = centerlineClearance(pts, ev.us, p.radius)
        expect(cl.surfaceGap).toBeGreaterThan(0.002)
        if (c.kind === 'append') continue
        for (let s = 0; s < 3; s++) {
          expect(ev.at3(s, 0)[0]).toBeCloseTo((s - 1) * GEOMETRY.spacing, 12)
          expect(STRAND_NAMES[s]).toBe(arrival[ev.positionBefore(p.count, s)])
        }
      }
      poseClip(c, T, p, info)
      const end = new Float32Array(9 * ev.samples)
      const want = new Float32Array(9 * ev.samples)
      ev.evaluate(p, end)
      ev.evaluate(staticPlan(c.target), want)
      let worst = 0
      for (let i = 0; i < end.length; i++) worst = Math.max(worst, Math.abs(end[i]! - want[i]!))
      expect(worst).toBeLessThan(1e-6)
    }
  })

  it('a relation in mid-word opens straight collars first; at the start of a word it needs none', () => {
    expect(clipPhases(clips[0]!).map((x) => x[0])).toEqual(['prepare', 'deform', 'settle'])
    expect(clipPhases(clips[1]!).map((x) => x[0])).toEqual(['open', 'prepare', 'deform', 'settle', 'close'])
    const p = new Plan()
    const info = new PoseInfo()
    poseClip(clips[1]!, 0, p, info)
    expect(info.phase).toBe('relation:open')
  })
})
