// BraidScene: the bounded three-strand braid workspace (FOUR-DEMOS-PARALLEL-HANDOFF sections 8, 9). It shows a
// BraidDesc (derive.ts): the main word and, when set, the comparison word side by side, each between fixed
// endpoint frames with its word (chronological, TeX) and invariants underneath, the supported-check status
// line and the viewing convention. Presses return validated workspace actions (ScenePick.actions); the scene
// never edits state. Motion is derived presentation (animator.ts): a committed braid_relation rewrite plays
// the canonical deformation at its span, cancel_pair the cancellation deformation, insert_pair the same in
// reverse, one appended crossing grows the braid; anything else jumps. An apply during an animation first
// finishes it at its exact end.
//
// Bench-local layout (metres): braids hang from y = 0.255 to y = -0.075; the append/edit column is at
// x = -0.42, the rewrite options for the selected crossing at x = +0.42; text below the braids down to
// y = -0.215; depth stays within z in [-0.05, 0.03].

import { Group, Matrix4, Ray, Vector3, type Object3D } from 'three'
import type { Generator } from '../../algebra/braid'
import type { PlaybackCommand, PlaybackState } from '../../rendering/adapter'
import { TextSlot } from '../../rendering/textSlot'
import type { FrameContext } from '../../runtime/host'
import { palette } from '../../ui/palette'
import type { DomainScene, ScenePick, SceneTransition } from '../scene'
import { BraidAnimator, classifyChange } from './animator'
import { centerlineClearance } from './clearance'
import { GEOMETRY, STRAND_NAMES } from './constants'
import type { BraidDesc } from './derive'
import { LANE_X0, LANE_X1, BraidView } from './view'
import { Plate, plain, tex } from './widgets'
import { primaryRewrite, rewriteSpan } from './span'
import type { ScenePresentation } from '../../ui/model'

const TOP_Y = 0.255
const MAIN_X_PAIRED = -0.15
const COMPARE_X = 0.15
const COLUMN_X = 0.42
const OPTION_SLOTS = 4

interface Rect {
  id: string
  x0: number
  x1: number
  y0: number
  y1: number
}

export class BraidScene implements DomainScene<BraidDesc> {
  readonly layout = 'braid' as const
  readonly root = new Group()
  private readonly main = new BraidView('word')
  private readonly compare = new BraidView('compare')
  private readonly animator = new BraidAnimator()
  private readonly statusLine = new TextSlot('braid:status')
  private readonly convention = new TextSlot('braid:convention')
  private readonly appendHeader = new TextSlot('braid:append-header')
  private readonly optionHeader = new TextSlot('braid:option-header')
  private readonly appendPlates: Plate[] = []
  private readonly editPlates: Plate[] = []
  private readonly optionPlates: Plate[] = []
  private desc: BraidDesc | null = null
  private hovered: string | null = null
  /** Crossing index of the hovered lane, or null (parsed once in setHover). */
  private hoveredCrossing: number | null = null
  /** Fixed lists iterated every frame (no per-frame array literals). */
  private allPlates: Plate[] = []
  private freeText: TextSlot[] = []
  private visible = true
  /** Under the UI shell (inSceneControls false) the append/edit column, the rewrite plates, their headers and
   * the in-scene status line are the shell's; strands, endpoints, words, crossing labels, the selection lane,
   * the highlighted rewrite span and the viewing convention stay. Invariant lines move to the inspector. */
  private presentation: ScenePresentation = { inSceneControls: true, detailsOpen: false }
  private readonly inv = new Matrix4()
  private readonly localRay = new Ray()
  private readonly hit = new Vector3()
  /** Applies and the transition chosen (verification). */
  readonly stats = { applies: 0, animated: 0, snapped: 0, interrupted: 0, geometryUpdates: 0 }
  lastTransition: string = 'none'

  constructor() {
    this.root.name = 'braid-scene'
    this.root.add(this.main.group, this.compare.group)
    this.main.group.position.set(0, TOP_Y, 0)
    this.compare.group.position.set(COMPARE_X, TOP_Y, 0)
    this.compare.group.visible = false
    this.statusLine.anchor.position.set(0, -0.19, 0)
    this.convention.anchor.position.set(0, -0.216, 0)
    this.appendHeader.anchor.position.set(-COLUMN_X, 0.232, 0)
    this.appendHeader.set(plain('append', 0.0115, palette.textDim))
    this.optionHeader.anchor.position.set(COLUMN_X, 0.232, 0)
    const gens: Generator[] = [1, 2, -1, -2]
    gens.forEach((g, i) => {
      const p = new Plate(`append:${g}`, -COLUMN_X, 0.195 - i * 0.045, 0.074, 0.036)
      p.setLabel(tex(`\\sigma_{${Math.abs(g)}}${g < 0 ? '^{-1}' : ''}`, 0.0175, palette.text, `σ${Math.abs(g)}${g < 0 ? '⁻¹' : ''}`))
      p.hint = `Append ${g < 0 ? `σ${-g}⁻¹` : `σ${g}`}`
      this.appendPlates.push(p)
    })
    const inverse = new Plate('invert', -COLUMN_X, 0.0, 0.074, 0.034)
    inverse.setLabel(plain('inverse', 0.0128, palette.text))
    inverse.hint = 'Replace the word by its inverse (reversed, signs flipped)'
    const reset = new Plate('reset', -COLUMN_X, -0.044, 0.074, 0.034)
    reset.setLabel(plain('reset', 0.0128, palette.text))
    reset.hint = 'Reset the word to the identity braid'
    this.editPlates.push(inverse, reset)
    for (let i = 0; i < OPTION_SLOTS; i++) {
      const p = new Plate(`option:${i}`, COLUMN_X, 0.195 - i * 0.045, 0.13, 0.036)
      p.setVisible(false)
      this.optionPlates.push(p)
    }
    this.allPlates = [...this.appendPlates, ...this.editPlates, ...this.optionPlates]
    this.freeText = [this.statusLine, this.convention, this.appendHeader, this.optionHeader]
    for (const p of this.allPlates) this.root.add(p.mesh, p.label.anchor)
    for (const s of this.freeText) this.root.add(s.anchor)
  }

  private plates(): Plate[] {
    return this.allPlates
  }

  /** The crossing being drawn by a construction replay on this track, or null. */
  private replayStep(t: BraidAnimator['main']): number | null {
    return t.clip?.kind === 'replay' && t.info.stepIndex < t.info.stepCount ? t.info.stepIndex : null
  }

  mount(parent: Object3D): void {
    parent.add(this.root)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.root.visible = visible
  }

  /** Presentation options from the shell (src/ui/model.ts ScenePresentation): never changes the mathematics. */
  setPresentation(p: ScenePresentation): void {
    if (p.inSceneControls === this.presentation.inSceneControls && p.detailsOpen === this.presentation.detailsOpen) return
    this.presentation = { ...p }
    this.applyPresentation()
  }

  private applyPresentation(): void {
    const own = this.presentation.inSceneControls
    for (const p of [...this.appendPlates, ...this.editPlates]) p.setVisible(own)
    this.appendHeader.setWanted(own)
    this.optionHeader.setWanted(own)
    this.statusLine.setWanted(own)
    const d = this.desc
    this.optionPlates.forEach((p, i) => p.setVisible(own && d !== null && d.options[i] !== undefined))
    // Under the shell the invariants are in the mathematics inspector (not over the stage).
    const inv = (d?.show.invariants ?? true) && own
    this.main.invariants.setWanted(inv)
    this.compare.invariants.setWanted(inv)
  }

  apply(desc: BraidDesc, transition: SceneTransition): void {
    this.stats.applies++
    const prev = this.desc
    if (this.animator.active) {
      this.stats.interrupted++
      this.animator.finish()
    }
    this.desc = desc
    const sameExperiment = prev !== null && prev.experimentId === desc.experimentId
    const compareWord = desc.compare?.word ?? []
    const prevCompare = prev?.compare?.word ?? []
    const compareShownChanged = (prev?.compare === null) !== (desc.compare === null)
    let mainClip = null
    let compareClip = null
    if (transition === 'animate' && sameExperiment && prev) {
      mainClip = classifyChange({ word: prev.main.word, origin: prev.origin, rewrites: prev.rewrites }, { word: desc.main.word, origin: desc.origin, rewrites: desc.rewrites })
      if (!compareShownChanged) compareClip = classifyChange({ word: prevCompare, origin: prevCompare, rewrites: [] }, { word: compareWord, origin: compareWord, rewrites: [] })
    }
    this.layoutViews(desc)
    this.main.setDesc(desc.main, desc.show.invariants)
    if (desc.compare) this.compare.setDesc(desc.compare, desc.show.invariants)
    this.animator.compareShown = desc.compare !== null
    if (mainClip || compareClip) {
      this.stats.animated++
      this.lastTransition = [mainClip?.kind, compareClip ? `compare:${compareClip.kind}` : null].filter(Boolean).join('+')
      this.animator.begin(mainClip, desc.main.word, compareClip, compareWord)
    } else {
      this.stats.snapped++
      this.lastTransition = 'snap'
      this.animator.snap(desc.main.word, compareWord)
    }
    this.statusLine.set(plain(desc.statusText, 0.0132, palette.text))
    this.convention.set(plain(desc.convention, 0.0104, palette.textDim))
    this.updateControls(desc)
    this.applyPresentation()
    this.renderTracks()
  }

  private layoutViews(desc: BraidDesc): void {
    this.main.group.position.x = desc.compare ? MAIN_X_PAIRED : 0
    this.main.textWidth = desc.compare ? 0.27 : 0.62
    this.compare.group.visible = desc.compare !== null
  }

  private updateControls(desc: BraidDesc): void {
    const id = desc.experimentId
    for (const p of this.appendPlates) {
      const g = Number(p.id.split(':')[1]) as Generator
      p.enabled = desc.canAppend
      p.actions = desc.canAppend ? [{ kind: 'append_crossing', experimentId: id, target: 'word', generator: g }] : []
    }
    const [inverse, reset] = this.editPlates
    inverse!.actions = [{ kind: 'invert_braid', experimentId: id, target: 'word' }]
    inverse!.enabled = desc.main.word.length > 0
    reset!.actions = [{ kind: 'set_braid', experimentId: id, target: 'word', word: [] }]
    reset!.enabled = desc.main.word.length > 0 || desc.rewrites.length > 0
    const k = desc.selectedCrossing
    if (k === null) this.optionHeader.set(plain(desc.main.word.length ? 'pick a crossing to rewrite' : 'rewrites', 0.0112, palette.textDim))
    else this.optionHeader.set(plain(`at crossing ${k + 1} (${desc.main.crossings[k]!.text})`, 0.0115, palette.text))
    this.optionPlates.forEach((p, i) => {
      const o = desc.options[i]
      p.setVisible(o !== undefined)
      if (!o) {
        p.actions = []
        return
      }
      p.setLabel(tex(o.tex, 0.0128, palette.text, o.hint))
      p.hint = o.hint
      p.actions = [{ kind: 'rewrite_braid', experimentId: id, rule: o.rule, at: o.at, generator: o.generator }]
    })
  }

  private renderTracks(): void {
    if (!this.desc) return
    this.stats.geometryUpdates++
    this.main.render(this.animator.main.plan, this.animator.main.info)
    if (this.desc.compare) this.compare.render(this.animator.compare.plan, this.animator.compare.info)
    this.animator.dirty = false
    const idle = !this.animator.active
    // During the construction replay the lane follows the crossing being drawn.
    this.main.setSelection(idle ? this.desc.selectedCrossing : this.replayStep(this.animator.main))
    if (this.desc.compare) this.compare.setSelection(this.replayStep(this.animator.compare))
    this.main.setHoverLane(idle ? this.hoveredCrossing : null)
    // Before a rewrite: the exact crossings the offered rule affects (the presenter names the same rule).
    const offered = idle ? primaryRewrite(this.desc.options) : null
    const span = offered ? rewriteSpan(offered) : null
    this.main.setSpan(span ? span.at : null, span ? span.length : 0)
    const strand = this.desc.selectedStrand ? STRAND_NAMES.indexOf(this.desc.selectedStrand) : null
    this.main.setStrandEmphasis(strand)
  }

  step(ctx: FrameContext): void {
    if (!this.visible || !this.desc) return
    this.animator.advance(ctx.dt)
    if (this.animator.dirty) this.renderTracks()
    this.main.step(ctx.time, ctx.head)
    if (this.desc.compare) this.compare.step(ctx.time, ctx.head)
    for (const s of this.freeText) {
      s.frame(ctx.time)
      if (s.anchor.visible) s.anchor.lookAt(ctx.head)
    }
    this.statusLine.anchor.scale.setScalar(this.statusLine.width > 0.86 ? 0.86 / this.statusLine.width : 1)
    this.convention.anchor.scale.setScalar(this.convention.width > 0.86 ? 0.86 / this.convention.width : 1)
    for (const p of this.allPlates) {
      p.hover = p.id === this.hovered && p.enabled
      p.frame(ctx.time)
    }
  }

  setPlayback(cmd: PlaybackCommand): PlaybackState {
    const s = this.animator.command(cmd)
    if (this.animator.dirty) this.renderTracks()
    return s
  }

  /** play_steps: seconds per crossing for the next construction replay (clamped to 0.3-5 s). */
  setStepDuration(seconds: number): void {
    if (Number.isFinite(seconds)) this.animator.stepDuration = Math.min(5, Math.max(0.3, seconds))
  }

  playback(): PlaybackState {
    return this.animator.state()
  }

  /** Crossing lanes of the main braid (scene-root coordinates), when idle. */
  private crossingRects(): Rect[] {
    const d = this.desc
    if (!d || this.animator.active) return []
    const out: Rect[] = []
    const ox = this.main.group.position.x
    for (let k = 0; k < d.main.word.length; k++) {
      const lane = this.main.laneOf(k)
      if (!lane) continue
      out.push({ id: `crossing:${k}`, x0: ox + LANE_X0, x1: ox + LANE_X1, y0: TOP_Y + lane.y - lane.h / 2, y1: TOP_Y + lane.y + lane.h / 2 })
    }
    return out
  }

  pick(ray: Ray): ScenePick | null {
    const d = this.desc
    if (!d || !this.visible) return null
    this.root.updateWorldMatrix(true, false)
    this.inv.copy(this.root.matrixWorld).invert()
    this.localRay.copy(ray).applyMatrix4(this.inv)
    const o = this.localRay.origin
    const dir = this.localRay.direction
    if (Math.abs(dir.z) < 1e-9) return null
    const t = (0 - o.z) / dir.z
    if (t <= 0) return null
    const px = o.x + dir.x * t
    const py = o.y + dir.y * t
    this.hit.set(px, py, 0).applyMatrix4(this.root.matrixWorld)
    const distance = this.hit.distanceTo(ray.origin)
    for (const p of this.plates()) {
      if (!p.contains(px, py)) continue
      return { id: p.id, distance, actions: p.enabled ? p.actions : [], hint: p.enabled ? p.hint : `${p.hint} (unavailable)` }
    }
    for (const r of this.crossingRects()) {
      if (px < r.x0 || px > r.x1 || py < r.y0 || py > r.y1) continue
      const k = Number(r.id.split(':')[1])
      const c = d.main.crossings[k]!
      const selected = d.selectedCrossing === k
      return {
        id: r.id,
        distance,
        actions: [{ kind: 'select_item', experimentId: d.experimentId, item: selected ? null : r.id }],
        hint: selected ? `Deselect crossing ${k + 1}` : `Crossing ${k + 1}: ${c.text} (${c.over} over ${c.under})`,
      }
    }
    return null
  }

  setHover(id: string | null): void {
    if (id === this.hovered) return
    this.hovered = id
    this.hoveredCrossing = id?.startsWith('crossing:') ? Number(id.slice(9)) : null
    if (this.desc && !this.animator.active) this.main.setHoverLane(this.hoveredCrossing)
  }

  status(): string {
    return this.desc?.summary ?? 'Braids: no word shown'
  }

  report(): Record<string, unknown> {
    const d = this.desc
    const views = [this.main, ...(d?.compare ? [this.compare] : [])]
    const tracks = [this.animator.main, this.animator.compare]
    return {
      layout: this.layout,
      longitudinal: 'top to bottom (time runs downward); over = nearer the viewer (+z)',
      experimentId: d?.experimentId ?? null,
      word: d?.main.word ?? null,
      compare: d?.compare?.word ?? null,
      summary: this.status(),
      statusText: d?.statusText ?? null,
      lastTransition: this.lastTransition,
      playback: this.playback(),
      stats: { ...this.stats },
      geometry: { ...GEOMETRY },
      braids: views.map((v, i) => {
        const plan = tracks[i]!.plan
        const c = centerlineClearance(v.centers, v.evaluator.us, plan.radius)
        return {
          role: v.role,
          x: v.group.position.x,
          units: plan.count,
          pitch: plan.count ? plan.len[0] : null,
          radius: plan.radius,
          motif: plan.motif,
          lambda: plan.lambda,
          reveal: v.reveal,
          drawnRings: v.drawnRings,
          clearance: { minDistance: +c.minDistance.toFixed(5), surfaceGap: +c.surfaceGap.toFixed(5), strands: c.strands.map((s) => STRAND_NAMES[s]), u: c.u.map((u) => +u.toFixed(4)) },
          text: { word: v.word.report(), invariants: v.invariants.report() },
        }
      }),
      options: d?.options.map((o) => o.id) ?? [],
      selectedCrossing: d?.selectedCrossing ?? null,
      highlightedSpan: this.main.span,
      presentation: { ...this.presentation, platesVisible: this.allPlates.filter((p) => p.visible).length },
      status: this.statusLine.report(),
    }
  }

  dispose(): void {
    this.main.dispose()
    this.compare.dispose()
    for (const p of this.plates()) p.dispose()
    for (const s of this.freeText) s.dispose()
    this.root.removeFromParent()
  }
}
