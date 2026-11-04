// Presentation clips of the braid scene and their playback (pure: no three.js, no DOM). A clip turns
// presentation time into a Plan (plan.ts) plus a reveal parameter; the committed exact words are always
// the clip's end state. Clips:
//   relation  prepare (generic depths -> canonical ranks, mu), deform (lambda), settle (ranks -> generic)
//   cancel    prepare (mu), straighten (nu), flatten (phi), close (the straight span shrinks to nothing)
//   insert    the cancel clip of the resulting word, played backwards
//   append    retract the old tail, then weave the new crossing down to the second endpoint frame
//   replay    the construction drawn crossing by crossing from the first endpoint frame
// The animator itself never edits a word; apply() always ends a running clip at its exact end first.

import { type Generator, type RewriteStep, applyRewrite, wordEq, wordText } from '../../algebra/braid'
import type { PlaybackCommand, PlaybackState } from '../../rendering/adapter'
import { GEOMETRY } from './constants'
import { ease, lerp } from './curves'
import { MOTIF_CANCEL, MOTIF_NONE, MOTIF_RELATION, type MotifLayout, Plan, motifLayout, pitchFor, radiusFor, setMotifPlan, setStaticPlan } from './plan'

export type Clip =
  | { kind: 'relation'; source: Generator[]; target: Generator[]; at: number; from: 0 | 1 }
  | { kind: 'cancel'; source: Generator[]; target: Generator[]; at: number }
  | { kind: 'insert'; source: Generator[]; target: Generator[]; at: number }
  | { kind: 'append'; source: Generator[]; target: Generator[] }
  | { kind: 'replay'; source: Generator[]; target: Generator[]; /** Seconds per crossing. */ unit: number }

/** Phase durations (seconds of presentation time). Open/close run only when straight collars must be made. */
export const DURATIONS = {
  open: 0.45,
  relation: { prepare: 0.6, deform: 2.6, settle: 0.6 },
  cancel: { prepare: 0.5, straighten: 1.3, flatten: 0.6, close: 0.8 },
  append: [0.3, 0.9],
  replayLead: 0.35,
  replayUnit: 0.75,
  replayTail: 0.4,
} as const

type Phase = readonly [name: string, duration: number]

/** The phases of a clip, in order (zero-length phases are dropped). Insert uses the cancel phases. */
export function clipPhases(c: Clip): Phase[] {
  return clipData(c).phases
}

interface ClipData {
  phases: Phase[]
  duration: number
  /** Motif layout (relation, cancel, insert). */
  layout: MotifLayout | null
  /** Phase labels as reported ("relation:deform"), precomputed so posing never builds strings. */
  labels: string[]
}

/** Per-clip constants, computed once per clip (posing a frame then allocates nothing). */
const clipCache = new WeakMap<Clip, ClipData>()
const INSERT_NAMES: Record<string, string> = { open: 'close', prepare: 'settle', straighten: 'bend', flatten: 'raise', close: 'open' }

function clipData(c: Clip): ClipData {
  const hit = clipCache.get(c)
  if (hit) return hit
  const o = DURATIONS.open
  let ph: Phase[]
  let layout: MotifLayout | null = null
  switch (c.kind) {
    case 'relation': {
      layout = motifLayout(c.source.length, c.at, 3)
      const open = layout.before + layout.after > 1e-9 ? o : 0
      const r = DURATIONS.relation
      ph = [['open', open], ['prepare', r.prepare], ['deform', r.deform], ['settle', r.settle], ['close', open]]
      break
    }
    case 'cancel':
    case 'insert': {
      const w = c.kind === 'cancel' ? c.source : c.target
      layout = motifLayout(w.length, c.at, 2)
      const r = DURATIONS.cancel
      ph = [['open', layout.before + layout.after > 1e-9 ? o : 0], ['prepare', r.prepare], ['straighten', r.straighten], ['flatten', r.flatten], ['close', r.close]]
      break
    }
    case 'append':
      ph = [['retract', DURATIONS.append[0]], ['weave', DURATIONS.append[1]]]
      break
    case 'replay':
      ph = [['replay', DURATIONS.replayLead + c.target.length * c.unit + DURATIONS.replayTail]]
      break
  }
  const phases = ph.filter((p) => p[1] > 0)
  const labels = phases.map(([n]) => (c.kind === 'replay' ? 'replay' : `${c.kind}:${c.kind === 'insert' ? INSERT_NAMES[n] : n}`))
  const d: ClipData = { phases, duration: phases.reduce((a, p) => a + p[1], 0), layout, labels }
  clipCache.set(c, d)
  return d
}

export function clipDuration(c: Clip): number {
  return clipData(c).duration
}

/** Reusable per-pose information (no allocation per frame). */
export class PoseInfo {
  /** Strands are drawn from u = 0 to u = reveal (GEOMETRY.length = complete). */
  reveal: number = GEOMETRY.length
  phase = 'idle'
  /** Phase or crossing index for step info; -1 = none. */
  stepIndex = -1
  stepCount = 0
  /** Which word the plan's units show (for labels). */
  showsTarget = true
}

/** Phase lookup result (module scratch: no allocation per frame). */
const PH = { i: 0, f: 0 }

/** Which phase a time falls in: PH.i and local progress PH.f in 0..1. */
function phaseOf(phases: readonly Phase[], t: number): typeof PH {
  let acc = 0
  for (let i = 0; i < phases.length; i++) {
    const d = phases[i]![1]
    if (t < acc + d || i === phases.length - 1) {
      PH.i = i
      PH.f = Math.min(1, Math.max(0, (t - acc) / d))
      return PH
    }
    acc += d
  }
  PH.i = phases.length - 1
  PH.f = 1
  return PH
}

/** The cancel clip of `word` at span k, at time t on its own timeline (used forwards and backwards). Returns the phase index. */
function poseCancel(word: readonly Generator[], k: number, data: ClipData, t: number, out: Plan): number {
  const { i, f } = phaseOf(data.phases, t)
  const name = data.phases[i]![0]
  const e = ease(f)
  const n = word.length
  const lay = data.layout!
  if (name === 'open') {
    setMotifPlan(out, word, k, 2, e, lay)
    return i
  }
  setMotifPlan(out, word, k, 2, 1, lay)
  if (name !== 'close') {
    out.motif = MOTIF_CANCEL
    out.mu = name === 'prepare' ? e : 1
    out.nu = name === 'prepare' ? 0 : name === 'straighten' ? e : 1
    out.phi = name === 'flatten' ? e : 0
    return i
  }
  // Close: the straightened pair and the opened collars shrink to nothing; every other unit relaxes to the
  // shorter word's static pitch (a longitudinal reparametrization of straight and unchanged pieces).
  const pTgt = pitchFor(n - 2)
  const span0 = k + 1
  out.gen[span0] = 0
  out.gen[span0 + 1] = 0
  for (let j = 0; j < out.count; j++) {
    const straight = j === k || j === span0 || j === span0 + 1 || j === span0 + 2
    out.len[j] = lerp(out.len[j]!, straight ? 0 : pTgt, e)
  }
  out.lead = lerp(out.lead, GEOMETRY.lead, e)
  out.radius = lerp(out.radius, radiusFor(pTgt), e)
  out.motif = MOTIF_NONE
  return i
}

/** Write the plan of clip c at presentation time t (clamped to the clip) into out. Allocation-free. */
export function poseClip(c: Clip, t: number, out: Plan, info: PoseInfo): void {
  const data = clipData(c)
  const phases = data.phases
  const T = data.duration
  t = Math.min(T, Math.max(0, t))
  info.reveal = GEOMETRY.length
  info.stepIndex = -1
  info.stepCount = 0
  switch (c.kind) {
    case 'relation': {
      const { i, f } = phaseOf(phases, t)
      const name = phases[i]![0]
      const e = ease(f)
      const l0 = c.from
      const l1 = 1 - c.from
      const lay = data.layout!
      if (name === 'open') setMotifPlan(out, c.source, c.at, 3, e, lay)
      else if (name === 'close') setMotifPlan(out, c.target, c.at, 3, 1 - e, lay)
      else {
        const useTarget = name === 'settle' || (name === 'deform' && e >= 0.5)
        setMotifPlan(out, useTarget ? c.target : c.source, c.at, 3, 1, lay)
        out.motif = MOTIF_RELATION
        out.lambda = name === 'prepare' ? l0 : name === 'deform' ? lerp(l0, l1, e) : l1
        out.mu = name === 'prepare' ? e : name === 'deform' ? 1 : 1 - e
      }
      info.phase = data.labels[i]!
      info.stepIndex = i
      info.stepCount = phases.length
      info.showsTarget = name === 'close' || name === 'settle' || (name === 'deform' && e >= 0.5)
      return
    }
    case 'cancel':
    case 'insert': {
      // Insert = the cancel clip of its target word played backwards (its source is the cancelled word).
      const forward = c.kind === 'cancel'
      const i = poseCancel(forward ? c.source : c.target, c.at, data, forward ? t : T - t, out)
      info.phase = data.labels[i]!
      info.stepIndex = forward ? i : phases.length - 1 - i
      info.stepCount = phases.length
      info.showsTarget = forward ? phases[i]![0] === 'close' : phases[i]![0] !== 'close'
      return
    }
    case 'append': {
      const { i: ph, f } = phaseOf(phases, t)
      const e = ease(f)
      const n = c.source.length
      if (ph === 0) {
        setStaticPlan(out, c.source)
        const end = out.lead + out.unitsLength()
        info.reveal = lerp(GEOMETRY.length, end, e)
        info.phase = 'append:retract'
        info.showsTarget = false
      } else {
        setStaticPlan(out, c.target)
        const pSrc = pitchFor(n)
        const pTgt = pitchFor(c.target.length)
        let before = 0
        for (let j = 0; j < n; j++) {
          out.len[j] = lerp(pSrc, pTgt, e)
          before += out.len[j]!
        }
        out.len[n] = Math.max(0, Math.min(pTgt, GEOMETRY.length - out.lead - GEOMETRY.tailMin - before))
        out.radius = lerp(radiusFor(pSrc), radiusFor(pTgt), e)
        const startNew = out.lead + before
        info.reveal = startNew + (GEOMETRY.length - startNew) * e
        info.phase = 'append:weave'
        info.showsTarget = true
      }
      info.stepIndex = ph
      info.stepCount = 2
      return
    }
    case 'replay': {
      setStaticPlan(out, c.target)
      const n = c.target.length
      const lead = DURATIONS.replayLead
      const unit = (T - DURATIONS.replayLead - DURATIONS.replayTail) / Math.max(1, n)
      let reveal: number
      if (t < lead) {
        reveal = out.lead * ease(t / lead)
        info.stepIndex = 0
      } else if (t < lead + n * unit) {
        const w = (t - lead) / unit
        const j = Math.min(n - 1, Math.floor(w))
        reveal = out.unitStart(j) + out.len[j]! * ease(w - j)
        info.stepIndex = j
      } else {
        const end = out.lead + out.unitsLength()
        reveal = end + (GEOMETRY.length - end) * ease((t - lead - n * unit) / DURATIONS.replayTail)
        info.stepIndex = n
      }
      info.reveal = t >= T ? GEOMETRY.length : reveal
      info.stepCount = n
      info.phase = 'replay'
      info.showsTarget = true
      return
    }
  }
}

/** How a committed change of one word is shown: the clip, or null for a jump. */
export function classifyChange(prev: { word: readonly Generator[]; origin: readonly Generator[]; rewrites: readonly RewriteStep[] }, next: { word: readonly Generator[]; origin: readonly Generator[]; rewrites: readonly RewriteStep[] }): Clip | null {
  const pw = [...prev.word]
  const nw = [...next.word]
  const grew = next.rewrites.length === prev.rewrites.length + 1 && wordEq(prev.origin, next.origin) && prev.rewrites.every((r, i) => r.rule === next.rewrites[i]!.rule && r.at === next.rewrites[i]!.at && r.generator === next.rewrites[i]!.generator)
  if (grew) {
    const step = next.rewrites[next.rewrites.length - 1]!
    let applied: Generator[] | null = null
    try {
      applied = applyRewrite(pw, step)
    } catch {
      applied = null
    }
    if (applied && wordEq(applied, nw)) {
      if (step.rule === 'braid_relation') return { kind: 'relation', source: pw, target: nw, at: step.at, from: pw[step.at] === 1 ? 0 : 1 }
      if (step.rule === 'cancel_pair') return { kind: 'cancel', source: pw, target: nw, at: step.at }
      if (step.rule === 'insert_pair') return { kind: 'insert', source: pw, target: nw, at: step.at }
    }
  }
  if (nw.length === pw.length + 1 && wordEq(nw.slice(0, pw.length), pw)) return { kind: 'append', source: pw, target: nw }
  return null
}

/** One braid's presentation track: its committed word, the running clip and the posed plan. */
export class Track {
  word: Generator[] = []
  clip: Clip | null = null
  readonly plan = new Plan()
  readonly info = new PoseInfo()

  snap(word: readonly Generator[]): void {
    this.word = [...word]
    this.clip = null
    setStaticPlan(this.plan, this.word)
    this.info.reveal = GEOMETRY.length
    this.info.phase = 'idle'
    this.info.stepIndex = -1
    this.info.stepCount = 0
    this.info.showsTarget = true
  }

  start(clip: Clip): void {
    this.word = [...clip.target]
    this.clip = clip
  }

  /** Pose at time t; ends the clip (static committed plan) when t reaches its duration. */
  pose(t: number): void {
    if (!this.clip) return
    if (t >= clipDuration(this.clip)) this.snap(this.word)
    else poseClip(this.clip, t, this.plan, this.info)
  }
}

/**
 * Playback over the two tracks (main word and comparison). One clock; a replay runs on both tracks
 * crossing by crossing; edit clips run on the track whose word changed.
 */
export class BraidAnimator {
  readonly main = new Track()
  readonly compare = new Track()
  time = 0
  duration = 0
  playing = false
  /** Pose changed since the last consume (the scene rewrites tube geometry only then). */
  dirty = true

  get active(): boolean {
    return this.main.clip !== null || this.compare.clip !== null
  }

  /** Jump to the exact end of whatever is running. */
  finish(): void {
    if (!this.active) return
    this.main.snap(this.main.word)
    this.compare.snap(this.compare.word)
    this.time = this.duration = 0
    this.playing = false
    this.dirty = true
  }

  snap(main: readonly Generator[], compare: readonly Generator[] | null): void {
    this.finish()
    this.main.snap(main)
    this.compare.snap(compare ?? [])
    this.dirty = true
  }

  /** Start clips (null = jump that track to its word). */
  begin(main: Clip | null, mainWord: readonly Generator[], compare: Clip | null, compareWord: readonly Generator[]): void {
    this.finish()
    if (main) this.main.start(main)
    else this.main.snap(mainWord)
    if (compare) this.compare.start(compare)
    else this.compare.snap(compareWord)
    this.time = 0
    this.duration = Math.max(main ? clipDuration(main) : 0, compare ? clipDuration(compare) : 0)
    this.playing = this.duration > 0
    this.pose()
  }

  replay(): void {
    const m = this.main.word
    const c = this.compare.word
    const unit = this.stepDuration
    this.begin({ kind: 'replay', source: m, target: m, unit }, m, this.compareShown ? { kind: 'replay', source: c, target: c, unit } : null, c)
  }

  /** Whether the comparison braid is displayed (set by the scene; replay includes it). */
  compareShown = false
  /** Seconds per crossing in the construction replay (play_steps stepDuration). */
  stepDuration: number = DURATIONS.replayUnit

  advance(dt: number): void {
    if (!this.active || !this.playing) return
    this.time = Math.min(this.duration, this.time + dt)
    this.pose()
    if (this.time >= this.duration) this.finish()
  }

  seek(t: number): void {
    if (!this.active) return
    this.time = Math.min(this.duration, Math.max(0, t))
    this.pose()
  }

  private pose(): void {
    this.main.pose(this.time)
    this.compare.pose(this.time)
    this.dirty = true
  }

  command(cmd: PlaybackCommand): PlaybackState {
    if (cmd === 'replay') this.replay()
    else if (cmd === 'toggle') {
      if (this.active) this.playing = !this.playing
      else this.replay()
    } else if (cmd === 'play') {
      if (this.active) this.playing = true
      else this.replay()
    } else if (cmd === 'pause') this.playing = false
    else if (cmd === 'finish') this.finish()
    else if (typeof cmd === 'object' && 'seek' in cmd) this.seek(cmd.seek)
    return this.state()
  }

  state(): PlaybackState {
    if (!this.active) return { active: false, playing: false, time: 0, duration: 0, phase: 'idle', step: null }
    const tr = this.main.clip ? this.main : this.compare
    const info = tr.info
    const clip = tr.clip!
    let step: PlaybackState['step'] = null
    if (clip.kind === 'replay') {
      const k = Math.max(0, info.stepIndex)
      step = { index: k, count: info.stepCount, label: k < clip.target.length ? `crossing ${k + 1}: ${wordText([clip.target[k]!])}` : 'second endpoint frame' }
    } else if (info.stepCount) {
      step = { index: info.stepIndex, count: info.stepCount, label: info.phase }
    }
    return { active: true, playing: this.playing, time: this.time, duration: this.duration, phase: info.phase, step }
  }
}
