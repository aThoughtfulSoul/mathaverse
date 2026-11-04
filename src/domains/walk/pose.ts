// The staged explanation as a pure function of time: composeStage(desc, stage, t) fills a Pose (bench-local
// positions, opacities and colours of every element), and blendPose mixes two poses for stage switches and edits.
// The scene (scene.ts) only draws a Pose. Keeping this pure makes the representation rules testable:
//  - source/reordered arrows ("live") are always t·v_i with t in [0, 1] (they grow, they translate, they never
//    flip, turn or rescale beyond their own length);
//  - signed copies flip as t·v_i with t running from 1 to -1, anchored at their tail (a negation, not a turn);
//  - transport moves only tails (straight segments, illustrative arcs between settled states);
//  - the Why construction is laid head to tail from the origin and ends exactly at W_k (plus T when T ≠ 0).
// Pure module: no three.js, no DOM.

import type { WalkStage } from '../inputs'
import { benchPoint, benchVector, type P3, type WalkDesc, type WitnessDesc } from './derive'

export type V3 = [number, number, number]

/** Role colours (sRGB hex). Shapes, +/− glyphs and names carry the same information. */
export const WALK_COLORS = {
  source: 0x9cc8ff,
  plus: 0xffc95c,
  minus: 0xb9a2ff,
  signed: 0x45d0bf,
  residual: 0xff6f91,
  ghost: 0x93a3bf,
  boundB: 0x8a94a8,
  boundR: 0xeef3ff,
  boundD: 0x45d0bf,
  selected: 0xffffff,
  origin: 0xfff1cf,
} as const

export interface ArrowPose {
  tail: V3
  vec: V3
  op: number
  color: number
  /** Highlight (selection, the arrow being copied or moved, counted arrows). */
  glow: number
  tagOp: number
  badgeOp: number
  /** The sign glyph shown on the badge (0: none). */
  sign: 0 | 1 | -1
  /** The underlying vector is exactly zero: drawn as an identity marker. */
  zero: boolean
}

export interface PointPose {
  p: V3
  op: number
}

export interface SpherePose {
  /** Radius in metres (bound × scale). */
  r: number
  op: number
  emph: number
}

export interface LinePose {
  a: V3
  b: V3
  op: number
}

export interface Pose {
  live: ArrowPose[]
  ghost: ArrowPose[]
  copy: ArrowPose[]
  /** Why: the two half-sized resultants and the residual T (when T ≠ 0). */
  half: [ArrowPose, ArrowPose]
  resid: ArrowPose
  /** Assumptions (open walk): the residual vector T from the origin. */
  total: ArrowPose
  dots: { source: number; reordered: number; signed: number; numbers: number }
  origin: number
  panelOrigin: number
  /** Home pulse at the origin, 0..1 (0 = none). */
  home: number
  tracer: PointPose
  panelTracer: PointPose
  B: SpherePose
  R: SpherePose
  D: SpherePose
  peak: { source: number; reordered: number; signed: number }
  ring: { U: PointPose; S: PointPose; W: PointPose; zero: PointPose; fail: PointPose }
  guide: { U: LinePose; S: LinePose; peakSource: LinePose; peakReordered: LinePose }
  panel: number
  /** Where the signed panel's origin is drawn (presentation offset; blended when an edit moves it). */
  panelAt: V3
  text: { caption: number; hyp: [number, number, number, number]; halves: [number, number]; resid: number; total: number; fail: number; boundMark: number; ringLabels: number }
  /** The construction is still running: captions use the "moving" copy; the bound is not asserted yet. */
  moving: boolean
  step: { index: number; count: number; label: string } | null
}

/** Bench-local geometry of one description (computed once per description). */
export interface WalkGeometry {
  origin: V3
  panelOrigin: V3
  src: V3[]
  rev: V3[]
  sig: V3[]
  /** Bench vectors of the occurrences in source order. */
  vecs: V3[]
  total: V3
}

export function walkGeometry(desc: WalkDesc): WalkGeometry {
  const v = desc.view
  const o: P3 = [0, 0, 0]
  return {
    origin: benchPoint(v, 'main', o),
    panelOrigin: benchPoint(v, 'panel', o),
    src: desc.source.map((p) => benchPoint(v, 'main', p.p)),
    rev: desc.reordered.map((p) => benchPoint(v, 'main', p.p)),
    sig: desc.signed.map((p) => benchPoint(v, 'panel', p.p)),
    vecs: desc.occurrences.map((x) => benchVector(v, x.vec)),
    total: benchVector(v, desc.total.p),
  }
}

// ------------------------------------------------------------------ allocation and small helpers

const v3 = (): V3 => [0, 0, 0]
const arrow = (): ArrowPose => ({ tail: v3(), vec: v3(), op: 0, color: WALK_COLORS.source, glow: 0, tagOp: 0, badgeOp: 0, sign: 0, zero: false })
const pt = (): PointPose => ({ p: v3(), op: 0 })
const line = (): LinePose => ({ a: v3(), b: v3(), op: 0 })

export function makePose(n: number): Pose {
  return {
    live: Array.from({ length: n }, arrow),
    ghost: Array.from({ length: n }, arrow),
    copy: Array.from({ length: n }, arrow),
    half: [arrow(), arrow()],
    resid: arrow(),
    total: arrow(),
    dots: { source: 0, reordered: 0, signed: 0, numbers: 0 },
    origin: 0,
    panelOrigin: 0,
    home: 0,
    tracer: pt(),
    panelTracer: pt(),
    B: { r: 0, op: 0, emph: 0 },
    R: { r: 0, op: 0, emph: 0 },
    D: { r: 0, op: 0, emph: 0 },
    peak: { source: 0, reordered: 0, signed: 0 },
    ring: { U: pt(), S: pt(), W: pt(), zero: pt(), fail: pt() },
    guide: { U: line(), S: line(), peakSource: line(), peakReordered: line() },
    panel: 0,
    panelAt: v3(),
    text: { caption: 0, hyp: [0, 0, 0, 0], halves: [0, 0], resid: 0, total: 0, fail: 0, boundMark: 0, ringLabels: 0 },
    moving: false,
    step: null,
  }
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
/** Progress of t through [a, a + d] (a step when d = 0). */
export const seg = (t: number, a: number, d: number): number => (d <= 0 ? (t >= a ? 1 : 0) : clamp01((t - a) / d))
export const ease = (u: number): number => u * u * (3 - 2 * u)
const lerp = (a: number, b: number, w: number): number => a + (b - a) * w

function set3(o: V3, a: readonly number[]): V3 {
  o[0] = a[0]!
  o[1] = a[1]!
  o[2] = a[2]!
  return o
}
function scaled(o: V3, a: readonly number[], s: number): V3 {
  o[0] = a[0]! * s
  o[1] = a[1]! * s
  o[2] = a[2]! * s
  return o
}
function sum3(o: V3, a: readonly number[], b: readonly number[]): V3 {
  o[0] = a[0]! + b[0]!
  o[1] = a[1]! + b[1]!
  o[2] = a[2]! + b[2]!
  return o
}
const isZero3 = (a: readonly number[]) => a[0] === 0 && a[1] === 0 && a[2] === 0

/**
 * Illustrative transport from a to b: a straight blend plus an arc in the bench x-y plane (perpendicular to the
 * displacement), zero at both ends. Only the settled ends are mathematical prefixes.
 */
export function arcPoint(o: V3, a: readonly number[], b: readonly number[], u: number): V3 {
  const e = ease(u)
  const dx = b[0]! - a[0]!
  const dy = b[1]! - a[1]!
  const dz = b[2]! - a[2]!
  const len = Math.hypot(dx, dy, dz)
  const k = len > 1e-6 ? (0.18 * Math.sin(Math.PI * u)) : 0
  const pl = Math.hypot(dx, dy)
  const px = pl > 1e-9 ? -dy / pl : 0
  const py = pl > 1e-9 ? dx / pl : 1
  o[0] = a[0]! + dx * e + px * k * len
  o[1] = a[1]! + dy * e + py * k * len
  o[2] = a[2]! + dz * e
  return o
}

function resetArrow(a: ArrowPose): void {
  a.op = 0
  a.glow = 0
  a.tagOp = 0
  a.badgeOp = 0
  a.sign = 0
  a.zero = false
  a.vec[0] = a.vec[1] = a.vec[2] = 0
}

const classColor = (s: 1 | -1) => (s === 1 ? WALK_COLORS.plus : WALK_COLORS.minus)

/** Mix two sRGB hex colours channel by channel. */
export function mixColor(a: number, b: number, w: number): number {
  if (a === b || w <= 0) return a
  if (w >= 1) return b
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, w))
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, w))
  const bl = Math.round(lerp(a & 255, b & 255, w))
  return (r << 16) | (g << 8) | bl
}

// ------------------------------------------------------------------ timing

/** Seconds of each stage's construction for a step duration s (default 0.5 s). */
export function stageTiming(desc: WalkDesc, stage: WalkStage, s: number, why: WitnessDesc | null) {
  const n = desc.n
  switch (stage) {
    case 'walk': {
      const g = 0.75 * s
      const home = 0.3 + n * g
      return { duration: home + 1.0, settle: home + 0.15, g, home }
    }
    case 'signs': {
      const tp = 0.2 + 0.1 * n
      let t = tp + 0.35
      for (const o of desc.occurrences) t += (o.sign === 1 ? 0.5 : 1.3) * s
      return { duration: t + 0.9, settle: t + 0.1, g: 0, home: tp }
    }
    case 'reorder': {
      const end = 0.5 + Math.max(0, n - 1) * 0.55 * s + 1.3 * s
      return { duration: end + 1.0, settle: end + 0.1, g: 0, home: end }
    }
    case 'why': {
      if (!why) return { duration: 0.8, settle: 0, g: 0, home: 0 }
      const c = 1.4 * s
      const end = 1.4 + 2 * c + (why.residualZero ? 0 : c)
      return { duration: end + 1.0, settle: end + 0.1, g: c, home: end }
    }
    case 'assumptions':
      return desc.total.zero ? { duration: 3.2, settle: 0.9, g: 0, home: 0 } : { duration: 3.0, settle: 1.6, g: 0, home: 0 }
  }
}

/** The witness the Why step explains: the selected reordered endpoint, if any (and the recipe shows it). */
export function selectedWitness(desc: WalkDesc): WitnessDesc | null {
  if (!desc.show.correspondence || !desc.show.reordering) return null
  return desc.selection.kind === 'reordered' ? desc.witnesses[desc.selection.index] ?? null : null
}

// ------------------------------------------------------------------ composition

/** Fill `out` with the state of `stage` at construction time t (t >= duration: the settled state). */
export function composeStage(out: Pose, desc: WalkDesc, geo: WalkGeometry, stage: WalkStage, t: number, s: number): Pose {
  const n = desc.n
  const why = stage === 'why' ? selectedWitness(desc) : null
  const tm = stageTiming(desc, stage, s, why)
  const scale = desc.view.scale
  const showBounds = desc.show.bounds
  // Reset.
  for (let i = 0; i < n; i++) {
    resetArrow(out.live[i]!)
    resetArrow(out.ghost[i]!)
    resetArrow(out.copy[i]!)
  }
  resetArrow(out.half[0])
  resetArrow(out.half[1])
  resetArrow(out.resid)
  resetArrow(out.total)
  out.dots.source = out.dots.reordered = out.dots.signed = out.dots.numbers = 0
  out.origin = 1
  out.panelOrigin = 0
  out.home = 0
  out.tracer.op = 0
  out.panelTracer.op = 0
  out.B.r = Number(desc.bounds.B.value) * scale
  out.R.r = desc.bounds.R.value * scale
  out.D.r = desc.bounds.D.value * scale
  out.B.op = out.R.op = out.D.op = 0
  out.B.emph = out.R.emph = out.D.emph = 0
  out.peak.source = out.peak.reordered = out.peak.signed = 0
  for (const r of [out.ring.U, out.ring.S, out.ring.W, out.ring.zero, out.ring.fail]) r.op = 0
  for (const l of [out.guide.U, out.guide.S, out.guide.peakSource, out.guide.peakReordered]) l.op = 0
  out.panel = 0
  out.text.caption = 1
  out.text.hyp[0] = out.text.hyp[1] = out.text.hyp[2] = out.text.hyp[3] = 0
  out.text.halves[0] = out.text.halves[1] = 0
  out.text.resid = out.text.total = out.text.fail = out.text.boundMark = out.text.ringLabels = 0
  out.step = null
  out.moving = t < tm.settle
  set3(out.ring.zero.p, geo.origin)
  set3(out.panelAt, geo.panelOrigin)

  // Arrow bases: identity arrows at source tails, full length; copies at signed tails, signed.
  const base = (i: number, where: 'source' | 'reordered') => {
    const o = desc.occurrences[i]!
    const a = out.live[i]!
    set3(a.tail, where === 'source' ? geo.src[i]! : geo.rev[o.output]!)
    set3(a.vec, geo.vecs[i]!)
    a.op = 1
    a.color = classColor(o.sign)
    a.tagOp = 1
    a.badgeOp = 1
    a.sign = o.sign
    a.zero = o.zero
  }
  const ghostAt = (i: number, op: number) => {
    const g = out.ghost[i]!
    set3(g.tail, geo.src[i]!)
    set3(g.vec, geo.vecs[i]!)
    g.op = op
    g.color = WALK_COLORS.ghost
    g.zero = desc.occurrences[i]!.zero
  }
  const copyAt = (i: number, op: number) => {
    const o = desc.occurrences[i]!
    const c = out.copy[i]!
    set3(c.tail, geo.sig[i]!)
    scaled(c.vec, geo.vecs[i]!, o.sign)
    c.op = op
    c.color = classColor(o.sign)
    c.zero = o.zero
    c.sign = o.sign
  }
  const peakGuide = (l: LinePose, p: V3, op: number) => {
    set3(l.a, geo.origin)
    set3(l.b, p)
    l.op = op
  }

  if (stage === 'walk') {
    const { g, home } = tm
    out.origin = seg(t, 0, 0.3)
    let tracerSet = false
    for (let i = 0; i < n; i++) {
      const o = desc.occurrences[i]!
      const a = out.live[i]!
      const start = 0.3 + i * g
      const u = seg(t, start, 0.92 * g)
      set3(a.tail, geo.src[i]!)
      scaled(a.vec, geo.vecs[i]!, ease(u))
      a.op = u > 0 ? 1 : 0
      a.color = WALK_COLORS.source
      a.zero = o.zero
      a.tagOp = seg(t, start + 0.55 * g, 0.35)
      if (!tracerSet && t < start + g && t >= start) {
        sum3(out.tracer.p, a.tail, a.vec)
        out.tracer.op = 1
        out.step = { index: i + 1, count: n, label: `arrow ${i + 1} of ${n}` }
        tracerSet = true
      }
    }
    if (!tracerSet && t < home + 0.5 && t >= 0.3) {
      set3(out.tracer.p, geo.src[n]!)
      out.tracer.op = 1 - seg(t, home, 0.5)
    }
    out.home = desc.total.zero && t >= home ? Math.max(0, 1 - (t - home) / 0.9) : 0
    out.dots.source = seg(t, home - 0.2, 0.5)
    const pk = desc.peaks.source.at
    const pkOp = pk > 0 ? seg(t, 0.3 + (pk - 1) * g + 0.92 * g, 0.35) : seg(t, home, 0.4)
    out.peak.source = pkOp
    peakGuide(out.guide.peakSource, geo.src[pk]!, 0.55 * pkOp)
    if (showBounds) out.B.op = seg(t, home + 0.15, 0.6)
  } else if (stage === 'signs') {
    const tp = tm.home
    for (let i = 0; i < n; i++) {
      const o = desc.occurrences[i]!
      const a = out.live[i]!
      base(i, 'source')
      const u = ease(seg(t, 0.1 + 0.1 * i, 0.3))
      a.color = mixColor(WALK_COLORS.source, classColor(o.sign), u)
      a.badgeOp = u
    }
    out.dots.source = 1
    out.B.op = showBounds ? 0.55 : 0
    out.peak.source = 0.55
    peakGuide(out.guide.peakSource, geo.src[desc.peaks.source.at]!, 0.3)
    out.panel = seg(t, tp, 0.35)
    out.panelOrigin = out.panel
    let start = tp + 0.35
    let active = -1
    for (let i = 0; i < n; i++) {
      const o = desc.occurrences[i]!
      const dur = (o.sign === 1 ? 0.5 : 1.3) * s
      const appear = seg(t, start, 0.3 * dur)
      const flip = o.sign === -1 ? ease(seg(t, start + 0.35 * dur, 0.55 * dur)) : 0
      const c = out.copy[i]!
      set3(c.tail, geo.sig[i]!)
      // A negative copy is first shown as the arrow itself, then negated in place: t·v with t from 1 to -1.
      scaled(c.vec, geo.vecs[i]!, 1 - 2 * flip)
      c.op = appear
      c.color = o.sign === 1 ? classColor(1) : mixColor(WALK_COLORS.source, classColor(-1), flip)
      c.zero = o.zero
      c.sign = o.sign
      if (t >= start && t < start + dur) {
        active = i
        c.glow = 1
        c.tagOp = 1
        out.live[i]!.glow = 1
        sum3(out.panelTracer.p, c.tail, c.vec)
        out.panelTracer.op = 1
        out.step = { index: i + 1, count: n, label: `${o.sign === 1 ? 'copy' : 'copy and flip'} ${o.name} · ${i + 1} of ${n}` }
      }
      start += dur
    }
    if (active < 0 && t >= start) {
      set3(out.panelTracer.p, geo.sig[n]!)
      out.panelTracer.op = 1 - seg(t, start, 0.4)
    }
    out.dots.signed = seg(t, start, 0.4)
    if (showBounds) out.D.op = seg(t, start + 0.1, 0.6)
    out.peak.signed = seg(t, start + 0.3, 0.5)
  } else if (stage === 'reorder' || stage === 'why' || stage === 'assumptions') {
    const reorder = stage === 'reorder'
    // Reorder construction: ghost appears, the panel leaves, arrows translate in output order.
    const gIn = reorder ? seg(t, 0, 0.5) : 1
    const panelOut = reorder ? seg(t, 0, 0.4) : 1
    for (let i = 0; i < n; i++) {
      base(i, desc.show.reordering ? 'reordered' : 'source')
      ghostAt(i, desc.show.reordering ? 0.2 * gIn : 0)
    }
    if (reorder) {
      out.panel = 1 - panelOut
      out.panelOrigin = out.panel
      for (let i = 0; i < n; i++) copyAt(i, 1 - panelOut)
      out.dots.signed = 1 - panelOut
      if (showBounds) out.D.op = 1 - panelOut
      out.dots.source = 1 - panelOut
      out.peak.source = 0.55 * (1 - panelOut)
      out.B.op = showBounds ? lerp(0.55, 0.85, panelOut) : 0
      if (desc.show.reordering) {
        for (let tau = 0; tau < n; tau++) {
          const i = desc.permutation[tau]!
          const a = out.live[i]!
          const start = 0.5 + tau * 0.55 * s
          const u = seg(t, start, 1.3 * s)
          arcPoint(a.tail, geo.src[i]!, geo.rev[tau]!, u)
          if (u > 0 && u < 1) {
            a.glow = 1
            out.step = { index: tau + 1, count: n, label: `moving ${desc.occurrences[i]!.name} to position ${tau + 1} of ${n}` }
          }
        }
      }
      out.dots.reordered = seg(t, tm.home - 0.1, 0.4)
      if (showBounds) out.R.op = seg(t, tm.home + 0.1, 0.6)
      out.peak.reordered = seg(t, tm.home + 0.4, 0.5)
      peakGuide(out.guide.peakReordered, geo.rev[desc.peaks.reordered.at]!, 0.55 * out.peak.reordered)
    } else {
      out.dots.reordered = desc.show.reordering ? 1 : 0
      out.B.op = showBounds ? 0.8 : 0
      out.R.op = showBounds ? 1 : 0
    }

    if (stage === 'why') {
      out.peak.reordered = 0
      if (!why) {
        out.dots.numbers = seg(t, 0, 0.5)
      } else composeWhy(out, desc, geo, why, t, tm.g)
    } else if (stage === 'assumptions') {
      composeAssumptions(out, desc, geo, t)
    }
  }

  overlaySelection(out, desc, geo, stage)
  return out
}

function composeWhy(out: Pose, desc: WalkDesc, geo: WalkGeometry, w: WitnessDesc, t: number, c: number): void {
  const n = desc.n
  const scale = desc.view.scale
  const view = desc.view
  const A = ease(seg(t, 0, 0.8))
  const counted = new Set(w.counted)
  for (let i = 0; i < n; i++) {
    const o = desc.occurrences[i]!
    const a = out.live[i]!
    const inPrefix = o.output < w.k
    a.op = inPrefix ? 1 : lerp(1, 0.26, A)
    a.tagOp = inPrefix || counted.has(i) ? 1 : lerp(1, 0.3, A)
    a.badgeOp = a.tagOp
    const g = out.ghost[i]!
    g.op = i < w.j ? lerp(0.2, 0.62, A) : lerp(0.2, 0.08, A)
    g.color = i < w.j ? WALK_COLORS.source : WALK_COLORS.ghost
    if (counted.has(i)) {
      g.glow = A
      g.tagOp = A
      a.glow = A
    }
  }
  set3(out.ring.W.p, geo.rev[w.k]!)
  out.ring.W.op = A
  set3(out.ring.U.p, geo.src[w.j]!)
  out.ring.U.op = A
  out.text.ringLabels = A
  // The signed prefix in the panel.
  const P = ease(seg(t, 0.6, 0.8))
  out.panel = P
  out.panelOrigin = P
  for (let i = 0; i < n; i++) {
    const o = desc.occurrences[i]!
    const cp = out.copy[i]!
    set3(cp.tail, geo.sig[i]!)
    scaled(cp.vec, geo.vecs[i]!, o.sign)
    cp.op = (i < w.j ? 1 : 0.22) * P
    cp.color = classColor(o.sign)
    cp.zero = o.zero
    cp.sign = o.sign
    if (counted.has(i)) cp.glow = P
  }
  out.dots.signed = 0.5 * P
  if (desc.show.bounds) out.D.op = 0.85 * P
  set3(out.ring.S.p, geo.sig[w.j]!)
  out.ring.S.op = P
  // Guides: the full prefixes the halves are halves of.
  const t1 = 1.4
  const u1 = seg(t, t1, c)
  const u2 = seg(t, t1 + c, c)
  const u3 = w.residualZero ? 0 : seg(t, t1 + 2 * c, c)
  const gU = out.guide.U
  set3(gU.a, geo.origin)
  set3(gU.b, geo.src[w.j]!)
  gU.op = 0.75 * seg(t, t1 - 0.2, 0.4)
  const gS = out.guide.S
  set3(gS.a, geo.panelOrigin)
  set3(gS.b, geo.sig[w.j]!)
  gS.op = 0.75 * seg(t, t1 - 0.2, 0.4)
  // Halves head to tail from the origin, then T.
  const h0 = benchVector(view, w.halves[0])
  const h1 = benchVector(view, w.halves[1])
  const pos = w.branch === 'positive'
  const H0 = out.half[0]
  set3(H0.tail, geo.origin)
  scaled(H0.vec, h0, ease(u1))
  H0.op = u1 > 0 ? 1 : 0
  H0.color = pos ? WALK_COLORS.source : WALK_COLORS.signed
  H0.zero = isZero3(w.halves[0])
  H0.glow = 0.4
  const H1 = out.half[1]
  sum3(H1.tail, geo.origin, h0)
  scaled(H1.vec, h1, ease(u2))
  H1.op = u2 > 0 ? 1 : 0
  H1.color = pos ? WALK_COLORS.signed : WALK_COLORS.source
  H1.zero = isZero3(w.halves[1])
  H1.glow = 0.4
  out.text.halves[0] = seg(t, t1 + 0.7 * c, 0.3)
  out.text.halves[1] = seg(t, t1 + 1.7 * c, 0.3)
  if (!w.residualZero) {
    const T = out.resid
    sum3(T.tail, H1.tail, h1)
    scaled(T.vec, benchVector(view, w.residual), ease(u3))
    T.op = u3 > 0 ? 0.6 : 0
    T.color = WALK_COLORS.residual
    T.glow = 0.4
    out.text.resid = seg(t, t1 + 2.7 * c, 0.3)
  }
  const end = t1 + 2 * c + (w.residualZero ? 0 : c)
  const D = ease(seg(t, end + 0.1, 0.6))
  out.R.emph = D
  out.text.boundMark = D
  void scale
  out.step = u1 < 1 ? { index: 1, count: 2, label: `${w.halvesName[0]} from the origin` } : u2 < 1 ? { index: 2, count: 2, label: `then ${w.halvesName[1]}` } : null
}

function composeAssumptions(out: Pose, desc: WalkDesc, geo: WalkGeometry, t: number): void {
  const n = desc.n
  const panelIn = seg(t, 0.4, 0.5)
  out.panel = panelIn
  out.panelOrigin = panelIn
  for (let i = 0; i < n; i++) {
    const o = desc.occurrences[i]!
    const c = out.copy[i]!
    set3(c.tail, geo.sig[i]!)
    scaled(c.vec, geo.vecs[i]!, o.sign)
    c.op = panelIn
    c.color = classColor(o.sign)
    c.zero = o.zero
    c.sign = o.sign
  }
  out.dots.signed = panelIn
  if (desc.show.bounds) out.D.op = panelIn
  if (desc.total.zero) {
    out.ring.zero.op = seg(t, 0.3, 0.5)
    out.text.total = out.ring.zero.op
    for (let k = 0; k < 4; k++) out.text.hyp[k] = seg(t, 0.8 + 0.45 * k, 0.4)
    out.peak.reordered = seg(t, 0.4, 0.5)
    peakGuide2(out, geo, desc.peaks.reordered.at, 0.4 * out.peak.reordered)
  } else {
    const T = out.total
    const u = seg(t, 0.5, 1.0)
    set3(T.tail, geo.origin)
    scaled(T.vec, geo.total, ease(u))
    // Translucent: T lies over the walk itself (W_N = T); the arrows stay visible through it.
    T.op = u > 0 ? 0.5 : 0
    T.color = WALK_COLORS.residual
    T.glow = 0.5
    out.text.total = seg(t, 1.3, 0.4)
    out.R.emph = ease(seg(t, 1.2, 0.5))
    if (desc.firstFailure !== null) {
      set3(out.ring.fail.p, geo.rev[desc.firstFailure]!)
      out.ring.fail.op = seg(t, 1.6, 0.5)
      out.text.fail = out.ring.fail.op
    }
    for (let k = 0; k < 4; k++) out.text.hyp[k] = seg(t, 1.0 + 0.4 * k, 0.4)
  }
}

function peakGuide2(out: Pose, geo: WalkGeometry, at: number, op: number): void {
  set3(out.guide.peakReordered.a, geo.origin)
  set3(out.guide.peakReordered.b, geo.rev[at]!)
  out.guide.peakReordered.op = op
}

/** Selection marks outside the Why construction (which draws its own). */
function overlaySelection(out: Pose, desc: WalkDesc, geo: WalkGeometry, stage: WalkStage): void {
  const sel = desc.selection
  if (sel.kind === 'source' && (stage === 'walk' || stage === 'signs')) {
    set3(out.ring.U.p, geo.src[sel.index]!)
    out.ring.U.op = out.dots.source
    out.text.ringLabels = out.ring.U.op
  } else if (sel.kind === 'source' && (stage === 'reorder' || stage === 'assumptions') && desc.show.reordering) {
    set3(out.ring.U.p, geo.src[sel.index]!)
    out.ring.U.op = 0.7
    out.text.ringLabels = 0.7
  } else if (sel.kind === 'signed' && stage !== 'why') {
    set3(out.ring.S.p, geo.sig[sel.index]!)
    out.ring.S.op = out.panel
    out.text.ringLabels = out.panel
  } else if (sel.kind === 'reordered' && (stage === 'reorder' || stage === 'assumptions')) {
    set3(out.ring.W.p, geo.rev[sel.index]!)
    out.ring.W.op = out.dots.reordered
    out.text.ringLabels = out.dots.reordered
  } else if (sel.kind === 'vector') {
    const i = desc.sourceIds.indexOf(sel.id)
    if (i >= 0) {
      out.live[i]!.glow = Math.max(out.live[i]!.glow, 1)
      out.live[i]!.tagOp = Math.max(out.live[i]!.tagOp, out.live[i]!.op)
      out.copy[i]!.glow = 1
      out.copy[i]!.tagOp = out.copy[i]!.op
      out.ghost[i]!.glow = 1
    }
  }
}

// ------------------------------------------------------------------ blending

export type BlendMode = 'blend' | 'morph'

function blendArrow(o: ArrowPose, a: ArrowPose, b: ArrowPose, w: number, mode: BlendMode): void {
  const aVis = a.op > 0.04
  const bVis = b.op > 0.04
  if (mode === 'blend') {
    // Fade out in place, fade in at the target, or move between two visible states.
    const g = aVis && bVis ? ease(w) : bVis ? 1 : 0
    for (let k = 0; k < 3; k++) {
      o.tail[k] = lerp(a.tail[k]!, b.tail[k]!, g)
      o.vec[k] = lerp(a.vec[k]!, b.vec[k]!, g)
    }
    o.color = mixColor(a.color, b.color, w)
    o.badgeOp = lerp(a.badgeOp, b.badgeOp, w)
    o.sign = w < 0.5 ? a.sign : b.sign
  } else {
    // An edit: first the vector changes (a flip passes through zero at its tail), then tails translate.
    const w1 = ease(seg(w, 0, 0.45))
    const w2 = seg(w, 0.45, 0.55)
    if (aVis && bVis) {
      for (let k = 0; k < 3; k++) o.vec[k] = lerp(a.vec[k]!, b.vec[k]!, w1)
      arcPoint(o.tail, a.tail, b.tail, w2)
    } else {
      const src = bVis ? b : a
      set3(o.tail, src.tail)
      set3(o.vec, src.vec)
    }
    o.color = mixColor(a.color, b.color, w1)
    const flipped = a.sign !== b.sign && a.sign !== 0 && b.sign !== 0
    o.badgeOp = flipped ? b.badgeOp * Math.abs(1 - 2 * w1) : lerp(a.badgeOp, b.badgeOp, w)
    o.sign = w1 < 0.5 ? a.sign : b.sign
  }
  o.op = lerp(a.op, b.op, w)
  o.glow = Math.max(lerp(a.glow, b.glow, w), mode === 'morph' && w > 0 && w < 1 && (a.sign !== b.sign || Math.abs(a.tail[0] - b.tail[0]) + Math.abs(a.tail[1] - b.tail[1]) > 1e-5) ? 0.8 : 0)
  o.tagOp = lerp(a.tagOp, b.tagOp, w)
  o.zero = bVis ? b.zero : a.zero
}

function blendPoint(o: PointPose, a: PointPose, b: PointPose, w: number): void {
  const g = a.op > 0.04 && b.op > 0.04 ? ease(w) : b.op > 0.04 ? 1 : 0
  for (let k = 0; k < 3; k++) o.p[k] = lerp(a.p[k]!, b.p[k]!, g)
  o.op = lerp(a.op, b.op, w)
}

function blendLine(o: LinePose, a: LinePose, b: LinePose, w: number): void {
  const g = a.op > 0.04 && b.op > 0.04 ? ease(w) : b.op > 0.04 ? 1 : 0
  for (let k = 0; k < 3; k++) {
    o.a[k] = lerp(a.a[k]!, b.a[k]!, g)
    o.b[k] = lerp(a.b[k]!, b.b[k]!, g)
  }
  o.op = lerp(a.op, b.op, w)
}

function blendSphere(o: SpherePose, a: SpherePose, b: SpherePose, w: number, mode: BlendMode): void {
  const g = mode === 'morph' ? seg(w, 0.45, 0.55) : w
  o.r = a.op > 0.04 && b.op > 0.04 ? lerp(a.r, b.r, ease(g)) : b.op > 0.04 ? b.r : a.r
  o.op = lerp(a.op, b.op, w)
  o.emph = lerp(a.emph, b.emph, w)
}

/** out = mix of a (w = 0) and b (w = 1). Poses must have the same arrow count. */
export function blendPose(out: Pose, a: Pose, b: Pose, w: number, mode: BlendMode): Pose {
  const n = out.live.length
  for (let i = 0; i < n; i++) {
    blendArrow(out.live[i]!, a.live[i]!, b.live[i]!, w, mode)
    blendArrow(out.ghost[i]!, a.ghost[i]!, b.ghost[i]!, w, mode)
    blendArrow(out.copy[i]!, a.copy[i]!, b.copy[i]!, w, mode)
  }
  blendArrow(out.half[0], a.half[0], b.half[0], w, 'blend')
  blendArrow(out.half[1], a.half[1], b.half[1], w, 'blend')
  blendArrow(out.resid, a.resid, b.resid, w, 'blend')
  blendArrow(out.total, a.total, b.total, w, 'blend')
  // Endpoint dots and peak marks sit at exact prefixes of one description: during an edit they leave with the old
  // state and return only when the new one has settled (no dot is ever shown at a stale or interpolated prefix).
  const settle = mode === 'morph' ? Math.max(1 - w / 0.12, seg(w, 0.88, 0.12)) : 1
  const useB = mode !== 'morph' || w >= 0.5
  const pick = (x: number, y: number) => (mode === 'morph' ? (useB ? y : x) * settle : lerp(x, y, w))
  out.dots.source = pick(a.dots.source, b.dots.source)
  out.dots.reordered = pick(a.dots.reordered, b.dots.reordered)
  out.dots.signed = pick(a.dots.signed, b.dots.signed)
  out.dots.numbers = pick(a.dots.numbers, b.dots.numbers)
  out.origin = lerp(a.origin, b.origin, w)
  out.panelOrigin = lerp(a.panelOrigin, b.panelOrigin, w)
  out.home = lerp(a.home, b.home, w)
  blendPoint(out.tracer, a.tracer, b.tracer, w)
  blendPoint(out.panelTracer, a.panelTracer, b.panelTracer, w)
  blendSphere(out.B, a.B, b.B, w, mode)
  blendSphere(out.R, a.R, b.R, w, mode)
  blendSphere(out.D, a.D, b.D, w, mode)
  out.peak.source = pick(a.peak.source, b.peak.source)
  out.peak.reordered = pick(a.peak.reordered, b.peak.reordered)
  out.peak.signed = pick(a.peak.signed, b.peak.signed)
  blendPoint(out.ring.U, a.ring.U, b.ring.U, w)
  blendPoint(out.ring.S, a.ring.S, b.ring.S, w)
  blendPoint(out.ring.W, a.ring.W, b.ring.W, w)
  blendPoint(out.ring.zero, a.ring.zero, b.ring.zero, w)
  blendPoint(out.ring.fail, a.ring.fail, b.ring.fail, w)
  blendLine(out.guide.U, a.guide.U, b.guide.U, w)
  blendLine(out.guide.S, a.guide.S, b.guide.S, w)
  blendLine(out.guide.peakSource, a.guide.peakSource, b.guide.peakSource, w)
  blendLine(out.guide.peakReordered, a.guide.peakReordered, b.guide.peakReordered, w)
  out.panel = lerp(a.panel, b.panel, w)
  {
    const g = mode === 'morph' ? seg(w, 0.45, 0.55) : w
    for (let k = 0; k < 3; k++) out.panelAt[k] = lerp(a.panelAt[k]!, b.panelAt[k]!, ease(g))
  }
  out.text.caption = b.text.caption
  for (let k = 0; k < 4; k++) out.text.hyp[k] = lerp(a.text.hyp[k]!, b.text.hyp[k]!, w)
  out.text.halves[0] = lerp(a.text.halves[0], b.text.halves[0], w)
  out.text.halves[1] = lerp(a.text.halves[1], b.text.halves[1], w)
  out.text.resid = lerp(a.text.resid, b.text.resid, w)
  out.text.total = lerp(a.text.total, b.text.total, w)
  out.text.fail = lerp(a.text.fail, b.text.fail, w)
  out.text.boundMark = lerp(a.text.boundMark, b.text.boundMark, w)
  out.text.ringLabels = lerp(a.text.ringLabels, b.text.ringLabels, w)
  out.moving = b.moving || w < 1
  out.step = b.step
  return out
}

/** Deep copy (same arrow count). */
export function copyPose(out: Pose, a: Pose): Pose {
  return blendPose(out, a, a, 1, 'blend')
}

/** A pose with nothing visible (used to fade a new walk in). */
export function emptyPose(n: number): Pose {
  const p = makePose(n)
  p.origin = 0
  p.text.caption = 0
  return p
}
