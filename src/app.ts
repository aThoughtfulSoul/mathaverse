// R6 compatibility scene: composition and the per-frame order (RUNTIME-ADAPTER R3):
//   collect host input -> update preview or commit a validated transaction -> recompute affected
//   mathematical results -> synchronize scene objects -> advance presentation -> host renders.
// Mathematics lives in the Workspace (exact). Drag previews are snapped rationals applied to a copy
// of the committed state; nothing is committed until release, and cancel restores the committed view.

import { Ray, Vector3, Plane, Matrix4, Quaternion } from 'three'
import { Host, type FrameContext, type StageContent } from './runtime/host'
import { measureStageContent } from './runtime/stageContent'
import { Input, HoldToTalk, type PointerId, type Pointer, type PointerEventKind, type VoiceGateInput } from './runtime/input'
import { Workspace, TransactionError, type Effect } from './workspace/reducer'
import { type Doc, type SampleSet, demoDocument, findSampleSet, activeExperiment, displayedExperiment, isLinearDisplayed } from './workspace/document'
import type { Sample, Vec } from './model/linear'
import { snapEighth, format, toJson } from './model/rational'
import { vecText, type ViewDescription } from './rendering/viewDescription'
import { deriveView, tokenSetFor } from './recipes/derive'
import { displayedMatrix } from './workspace/reducer'
import { rebindTarget } from './demo/pq'
import { type DemoKind, DEMO_KINDS, demoOf, orderDemoActions, pqDemoActions, reverseRouteActions } from './demo/order'
import { FOUR_CONTROL_TEXTS, domainControls, fourDemoActions } from './demo/four'
import { proofActions } from './demo/proof'
import { deriveScene, sceneInputFor } from './domains/registry'
import type { DomainScene, SceneTransition } from './domains/scene'
import type { SceneLayout, WalkStage } from './domains/inputs'
import type { ScenePresentation, SpatialPick, UiCommand, UiView } from './ui/model'
import type { Ray as RayT } from 'three'

/** The spatial UI shell as the app hosts it (src/ui/shell; UI-REFINEMENT-SPEC section 9). */
export interface SpatialShellHost {
  mount(parent: import('three').Object3D): void
  render(view: UiView): void
  step(ctx: FrameContext): void
  pick(ray: RayT): SpatialPick | null
  setHover(id: string | null): void
  setVisible(v: boolean): void
  /** The shell's own presses that are not UiCommands (e.g. mathematics page turns); true when handled. */
  press?(id: string): boolean
  dispose(): void
}
import { comparisonOf } from './recipes/recipe'
import { findRecipe } from './workspace/document'
import type { TransitionSpec, VoiceLine } from './rendering/adapter'
import { buttonTex } from './ui/phrases'
import { profileStage, timed } from './runtime/frameProfile'
import { ManimAdapter } from './rendering/manimAdapter'
import { SpatialControls, type ControlCommand } from './ui/spatialControls'
import { CONTROLS_BACKDROP, createBackdrop, createRoomStandIn } from './ui/backdrop'
import { texStats } from './rendering/tex'
import { PHRASE, plainOf } from './ui/phrases'
import type { Space } from './rendering/glyphTokens'

const TRANSITION = { kind: 'apply_map' as const, duration: 3.0 }
/** Seconds per operation when a comparison is revealed without an explicit play_comparison. */
const COMPARE_STEP = 1.6

/** Labels the demo/rebind/talk controls can show (prepared as glyph tokens like every other label). */
const CONTROL_TEXTS = ['Use on Q', 'Reverse left', 'Order demo', 'P/Q demo', 'Talk', 'Stop', 'Cancel', 'Sending', 'No voice', ...FOUR_CONTROL_TEXTS]

/** The demo control's label: the demonstration a press shows next (the six are visited in order). */
const DEMO_BUTTON: Record<DemoKind, string> = { pq: 'P/Q demo', order: 'Order demo', sculpture: 'Sculpture', cube: 'Cube demo', quotient: 'Quotient', braid: 'Braids', proof: 'Proof' }
const nextDemo = (k: DemoKind): DemoKind => DEMO_KINDS[(DEMO_KINDS.indexOf(k) + 1) % DEMO_KINDS.length]!

type DragMode = 'fiber' | 'free'

interface Drag {
  pointer: PointerId
  sampleId: string
  mode: DragMode
  base: Doc
  preview: Vec | null
  /** Free mode: plane through the handle facing the viewer at drag start. */
  plane: Plane
  /** Where the grab started (fiber parameter or local hit). Motion is relative, so no motion = no change. */
  grab: number[] | null
  /** Host time when the ray pose became unavailable (review C2); null while tracked. */
  lostAt: number | null
  /** Set by a loss; cleared by the re-anchor on the first valid frame whose ray reaches the drag target. */
  reanchor: boolean
}

interface BenchGrab {
  pointer: PointerId
  offset: Matrix4
  lostAt: number | null
}

/**
 * A grab whose pose stays unavailable this long is cancelled (seconds of host time). Quest 3S
 * (Quest Browser 154): a two-count hide behind the back produced no loss at all; longer hides produced
 * emulated-pose episodes of 0.6-3.1 s during grabs (0.1-4.5 s overall). With 1.5 s both grabs that lost
 * tracking for longer were cancelled, one of them 90 ms before tracking returned (docs/VERIFICATION.md,
 * Headset).
 */
const TRACKING_TIMEOUT = 3

/** Workbench children that are not the experiment (desktop framing ignores them). */
const NOT_CONTENT = new Set(['shell', 'controls', 'passthrough-backdrop', 'app-lines', 'formal-readouts'])

export class App {
  readonly workspace: Workspace
  adapter: ManimAdapter
  readonly controls = new SpatialControls()
  /** Dark soft-edged panel behind the workbench, shown in passthrough sessions (src/ui/backdrop.ts). */
  private readonly backdrop = createBackdrop()
  private readonly controlsBackdrop = createBackdrop(CONTROLS_BACKDROP)
  /** DEV: a bright stand-in wall for judging passthrough readability on the desktop (never in a session). */
  private roomStandIn: ReturnType<typeof createRoomStandIn> | null = null
  readonly input: Input
  mode: DragMode = 'fiber'
  private drag: Drag | null = null
  private bench: BenchGrab | null = null
  private dirty = true
  private lastDesc: ViewDescription | null = null
  private readonly hover = new Map<PointerId, string | null>()
  private readonly ray = new Ray()
  readonly log: { t: number; event: string; detail?: unknown }[] = []
  lastError: string | null = null
  private playbackSig = ''
  readonly stats = { refreshes: 0, ignoredPresses: 0, ignoredGrips: 0, suspensions: 0, reanchors: 0 }
  /** Exposed for verification waits. */
  readonly trackingTimeout = TRACKING_TIMEOUT
  /**
   * After each re-anchor, the next 30 frames: the drag preview, or the workbench's per-frame movement in
   * metres. Device evidence that reacquisition does not jump (review C2).
   */
  readonly resumeTraces: { kind: 'drag' | 'bench'; t: number; at: string; frames: (string | number)[] }[] = []
  private resumeTrace: { trace: App['resumeTraces'][number]; prev: Vector3 } | null = null
  private readonly unsubscribe: () => void
  private readonly offFrame: () => void
  private readonly offSession: () => void
  private readonly offVisibility: () => void

  /** Per demonstration, what was shown last, so switching back restores it (presentation memory only). */
  private readonly lastShown: Record<DemoKind, { experimentId: string; sampleId: string | null; item: string | null } | null> = { pq: null, order: null, sculpture: null, cube: null, quotient: null, braid: null, proof: null }

  // ---- the four algebra demonstrations (FOUR-DEMOS): one scene per layout, mounted on first show
  private readonly scenes = new Map<SceneLayout, DomainScene<unknown>>()
  private activeScene: { layout: SceneLayout; scene: DomainScene<unknown>; desc: unknown } | null = null
  /** How the next scene sync shows its change: 'animate' after an action, 'snap' after open/undo/switch. */
  private nextSceneTransition: SceneTransition = 'snap'
  /** The proof lesson's step (transient presentation state: never in the document, its revision or Undo). */
  private lessonStage: WalkStage = 'walk'
  /** Set when the displayed experiment's scene is not available in this build (shown in the status line). */
  sceneProblem: string | null = null
  private sceneHint: string | null = null
  /** How scenes present themselves under the UI shell (last applied; re-applied to a newly shown scene). */
  private presentation: ScenePresentation | null = null
  /** The spatial UI shell (XR / passthrough) and the command dispatch its presses use. */
  private spatialShell: { shell: SpatialShellHost; dispatch: (c: UiCommand) => void } | null = null
  /** Push-to-talk: the Talk control's label and handler are set by the voice wiring (main.ts). */
  private talkLabel = 'Talk'
  onTalk: (() => void) | null = null
  /** Controller hold-to-talk (A/X held; src/runtime/input.ts), over the spatial shell's command path. */
  private readonly holdToTalk: HoldToTalk
  /** The voice part of the UI view last rendered by the spatial shell (what the XR Talk control shows). */
  private voiceView: VoiceGateInput | null = null
  /** Host time of the frame in which a ray press dispatched an assistant or inspector command: until the next published
   * view (the UI controller publishes after this app's frame), the voice state and open panel above may be out of date
   * (a hold in that frame is ignored rather than toggling the panel or recording behind it). */
  private voiceCommandAt: number | null = null

  /** Glyph tokens every scene of the current document can need (recomputed when maps or labels change). */
  private tokens: string[] = []
  private tokenKey = ''

  constructor(readonly host: Host, initial: Doc = demoDocument()) {
    this.workspace = new Workspace(initial)
    this.refreshTokens()
    this.adapter = this.mountAdapter()
    this.input = new Input(host.renderer, host.camera, host.scene)
    this.holdToTalk = new HoldToTalk({
      dispatch: () => this.spatialShell?.dispatch ?? null,
      voice: () => (this.voiceCommandAt === this.lastFrameTime ? null : this.voiceView),
      dragging: () => this.drag !== null,
      presenting: () => this.host.presenting,
      pulse: (id) => void this.input.pulse(id),
      note: (event, detail) => this.note(event, detail),
    })
    this.controls.group.add(this.controlsBackdrop)
    this.unsubscribe = this.workspace.subscribe((s, prev) => {
      this.dirty = true
      this.rememberShown(s)
      this.refreshTokens()
      this.note('commit', { revision: s.revision, mathRevision: s.mathRevision, mathChanged: s.mathRevision !== prev.mathRevision })
    })
    this.rememberShown(this.workspace.current)
    this.offFrame = host.onFrame(this.frame)
    // Leaving XR: nothing may stay grabbed, and the desktop view comes back (review F5, F8).
    this.offVisibility = host.onVisibility((visible) => {
      this.input.setSuspended(!visible)
      // A hidden session may run no frames at all: mark grabs lost now, from the last frame's time, so the
      // loss is never missed and its duration is measured across the gap (review C2-1).
      if (!visible) {
        // A recording started by a held A/X must not keep running behind the system UI (the release may never be seen).
        this.holdToTalk.end('session-hidden')
        if (this.drag && this.drag.lostAt === null) {
          this.drag.lostAt = this.lastFrameTime
          this.drag.reanchor = true
        }
        if (this.bench && this.bench.lostAt === null) this.bench.lostAt = this.lastFrameTime
        this.refreshControls()
      }
      this.note('sessionVisibility', { visible })
    })
    this.offSession = host.onSession((presenting) => {
      this.input.setSuspended(false)
      this.setBackdrops(presenting && host.sessionMode === 'passthrough')
      this.spatialShell?.shell.setVisible(presenting)
      if (presenting && this.roomStandIn) this.setPassthroughPreview(false)
      if (presenting) return
      // A recording started by a held A/X ends with the session (nothing is uploaded or sent).
      this.holdToTalk.end('session-end')
      if (this.drag) this.cancelDrag('session-end')
      if (this.bench) this.endBench()
      this.input.restoreDesktopCamera()
    })
    this.refreshControls()
  }

  private mountAdapter(): ManimAdapter {
    const a = new ManimAdapter()
    a.mount(this.host.stage)
    a.bench.add(this.controls.group)
    a.bench.add(this.backdrop)
    return a
  }

  /** Resolves when the full readout token set and equations are prepared (failures listed). */
  prepared: Promise<{ ok: boolean; failures?: string[] }> = Promise.resolve({ ok: true })

  /**
   * Show the scene at once (slots request exactly what they need first, and show plain-text pending
   * states meanwhile), prepare the remaining readout tokens in the background, and play the
   * transformation once the visible text is ready (or after 4 s regardless).
   */
  async start(): Promise<void> {
    if (this.syncScene()) {
      this.dirty = false
      this.refreshControls()
      this.note('start', { scene: this.activeScene?.layout ?? null })
      return
    }
    const desc = this.describeCurrent()
    this.adapter.apply(desc)
    this.lastDesc = desc
    this.dirty = false
    this.refreshControls()
    this.prepared = this.adapter.prepare(desc).then((r) => (r.ok ? { ok: true } : { ok: false, failures: r.failures }))
    const t0 = performance.now()
    while (performance.now() - t0 < 4000 && this.textPending()) await new Promise((r) => setTimeout(r, 50))
    if (!this.drag) {
      const now = this.describeCurrent()
      this.adapter.apply(now, now.comparison ? { kind: 'compare_steps', stepDuration: COMPARE_STEP } : TRANSITION)
      this.lastDesc = now
    }
    this.refreshControls()
    this.note('start', { waitedMs: Math.round(performance.now() - t0), pendingLeft: this.textPending() })
  }

  /** Any visible scene/control text still waiting for its typeset form. */
  textPending(): boolean {
    return [...this.adapter.slotReport(), ...this.controls.report()].some((r) => r.visible && r.state === 'pending')
  }

  /** The description currently shown (a preview while dragging). */
  currentDescription(): ViewDescription | null {
    return this.lastDesc
  }

  describeCurrent(previewDoc?: Doc, previewSample?: string): ViewDescription {
    const desc = deriveView(previewDoc ?? this.workspace.current, { previewSample: previewSample ?? null, tokenSet: this.tokens })
    return desc
  }

  /**
   * Prepare glyph tokens for every scene this document can show (new map symbols, labels, group sizes),
   * outside the frame path. Until they are ready, slots show truthful plain-text pending states (C1).
   */
  private refreshTokens(): void {
    const doc = this.workspace.current
    const key = `${doc.mathRevision}|${doc.maps.map((m) => m.label).join(',')}|${doc.sampleSets.map((s) => s.samples.map((x) => x.label).join('')).join('|')}`
    if (key === this.tokenKey) return
    this.tokenKey = key
    // Button labels the rebind control can show for this document (prepared like every other token).
    this.tokens = [...tokenSetFor(doc), ...CONTROL_TEXTS.map(buttonTex), ...doc.maps.map((m) => buttonTex(`Show ${m.label}`))]
    if (this.adapter && isLinearDisplayed(doc)) void this.adapter.prepare(this.describeCurrent())
  }

  /** The displayed experiment's sample set. */
  activeSet(doc: Doc = this.workspace.current): SampleSet {
    return findSampleSet(doc, activeExperiment(doc).sampleSetId)
  }

  activeSamples(doc: Doc = this.workspace.current): Sample[] {
    return this.activeSet(doc).samples
  }

  /**
   * Commit one transaction from a local control or a validated proposal (W3): all or nothing, then run its
   * presentation effects. Returns the plan summary, or throws TransactionError with nothing changed.
   */
  transact(actions: unknown, source: string): { summary: string[]; effects: Effect[] } {
    if (this.drag) this.cancelDrag(`transaction:${source}`)
    if (this.adapter.playback().active) this.adapter.finishTransition()
    const before = this.workspace.current
    const { doc, plan } = this.workspace.commit({ baseRevision: before.revision, actions })
    this.note('transaction', { source, summary: plan.summary })
    // A group or braid experiment is shown by its scene: animated from the previous description.
    if (!isLinearDisplayed(doc)) {
      this.nextSceneTransition = 'animate'
      this.syncScene()
      this.dirty = false
      const stage = plan.effects.find((e) => e.kind === 'show_walk_stage')
      if (stage) this.setWalkStage(stage.stage)
      const steps = plan.effects.find((e) => e.kind === 'play_steps')
      if (steps && this.activeScene) {
        this.activeScene.scene.setStepDuration?.(steps.stepDuration)
        this.activeScene.scene.setPlayback('replay')
      }
      this.refreshControls()
      return { summary: plan.summary, effects: plan.effects }
    }
    // A new map or a different displayed experiment is revealed by playing its transformation (S10 step 5):
    // presentation only, started after the commit succeeded (W3).
    const reveal = doc.selection.experimentId !== before.selection.experimentId || doc.mathRevision !== before.mathRevision
    const compare = plan.effects.find((e) => e.kind === 'play_comparison')
    if (reveal || plan.effects.some((e) => e.kind === 'play') || compare) {
      this.replayCommitted(compare ? { kind: 'compare_steps', stepDuration: compare.stepDuration } : undefined)
    }
    this.refreshControls()
    return { summary: plan.summary, effects: plan.effects }
  }

  /** Show the committed state now (used before playback so a transition never starts from a preview). */
  private applyCommitted(): void {
    if (this.syncScene()) {
      this.dirty = false
      return
    }
    const desc = this.describeCurrent()
    this.adapter.apply(desc)
    this.lastDesc = desc
    this.dirty = false
  }

  /**
   * Show the committed state and play it: a comparison step by step (both routes), linked views as one map.
   * With a spec (a play_comparison effect) its timing is used; otherwise the adapter's last timing.
   */
  private replayCommitted(spec?: TransitionSpec): void {
    // Linear views come back (and any group or braid scene is hidden) before the linear scene is shown.
    if (this.syncScene()) {
      this.dirty = false
      return
    }
    const desc = this.describeCurrent()
    this.lastDesc = desc
    this.dirty = false
    if (spec && desc.comparison) this.adapter.apply(desc, spec)
    else {
      this.adapter.apply(desc)
      this.adapter.setPlayback('replay')
    }
  }

  /** The demonstration on the workbench (from the displayed experiment's recipe layout). */
  get demo(): DemoKind {
    const doc = this.workspace.current
    return demoOf(doc, displayedExperiment(doc))
  }

  private rememberShown(doc: Doc): void {
    this.lastShown[demoOf(doc, displayedExperiment(doc))] = { ...doc.selection }
  }

  /**
   * Show the displayed group or braid experiment through its scene (derive from exact input, apply with the
   * pending transition) and hide the linear views; or, for a linear experiment, hide any scene and show the
   * linear views again. Returns true when a group or braid experiment is displayed.
   */
  private syncScene(): boolean {
    const input = sceneInputFor(this.workspace.current)
    if (!input) {
      if (this.activeScene) {
        this.activeScene.scene.setVisible(false)
        this.activeScene = null
      }
      this.adapter.setLinearVisible(true)
      this.sceneProblem = null
      return false
    }
    this.adapter.setLinearVisible(false)
    if (this.adapter.playback().active) this.adapter.finishTransition()
    const derived = deriveScene(input)
    if (!derived) {
      this.activeScene?.scene.setVisible(false)
      this.activeScene = null
      this.sceneProblem = `the ${input.layout} scene is not in this build`
      this.nextSceneTransition = 'snap'
      return true
    }
    this.sceneProblem = null
    let scene = this.scenes.get(derived.layout)
    if (!scene) {
      scene = derived.create()
      scene.mount(this.adapter.bench)
      this.scenes.set(derived.layout, scene)
    }
    const same = this.activeScene?.layout === derived.layout
    if (this.activeScene && !same) this.activeScene.scene.setVisible(false)
    scene.setVisible(true)
    if (this.presentation) scene.setPresentation?.(this.presentation)
    scene.apply(derived.desc, same ? this.nextSceneTransition : 'snap')
    if (!same && derived.layout === 'walk') scene.setStage?.(this.lessonStage, 'snap')
    this.activeScene = { layout: derived.layout, scene, desc: derived.desc }
    this.nextSceneTransition = 'snap'
    return true
  }

  /** The proof lesson's current step (Walk, Signs, Reorder, Why, Assumptions). */
  get walkStage(): WalkStage {
    return this.lessonStage
  }

  /**
   * Show one step of the proof lesson: presentation only (a step strip press or a validated show_walk_stage
   * effect). The document, its revision and Undo are untouched, so a pending assistant request stays current.
   */
  setWalkStage(stage: WalkStage, transition: SceneTransition = 'animate'): void {
    const changed = stage !== this.lessonStage
    this.lessonStage = stage
    if (this.activeScene?.layout === 'walk') this.activeScene.scene.setStage?.(stage, changed ? transition : 'snap')
    if (changed) this.note('lesson-stage', { stage })
  }

  /** Apply the shell's presentation options to the linear adapter and the shown scene (idempotent). */
  applyPresentation(p: ScenePresentation): void {
    const prev = this.presentation
    this.presentation = p
    if (prev && prev.inSceneControls === p.inSceneControls && prev.detailsOpen === p.detailsOpen) return
    ;(this.adapter as unknown as { setPresentation?(p: ScenePresentation): void }).setPresentation?.(p)
    this.activeScene?.scene.setPresentation?.(p)
  }

  /**
   * Host the spatial UI shell on the workbench (it replaces the old two-row spatial controls, which hide).
   * It is visible only while presenting; its picks come before the scene's, so UI presses never reach
   * mathematical objects, and a hidden shell has no hit targets.
   */
  attachSpatialShell(shell: SpatialShellHost, dispatch: (c: UiCommand) => void): void {
    this.spatialShell?.shell.dispose()
    this.spatialShell = { shell, dispatch }
    shell.mount(this.adapter.bench)
    shell.setVisible(this.host.presenting)
    this.controls.group.visible = false
  }

  renderSpatialShell(view: UiView): void {
    const a = view.assistant
    this.voiceView = { open: a.open, voice: a.voice, voiceAcquiring: a.voiceAcquiring, capability: a.capability }
    this.voiceCommandAt = null
    // A hold's recording that ended some other way (panel Cancel or Close, the limit, an error) lets go of its A/X.
    this.holdToTalk.viewed(this.voiceView)
    this.spatialShell?.shell.render(view)
  }

  /**
   * Desktop framing: the extent of what the shown experiment draws on the workbench, as tangents from the desktop
   * camera's axis (the corners of every visible mesh, line and point set; the UI shell, the retired controls, the
   * backdrops and the old app lines are not content). Null when nothing is drawn.
   */
  stageContent(): StageContent | null {
    return measureStageContent(this.adapter.bench, this.host.camera, NOT_CONTENT)
  }

  private shellPick(ray: Ray): SpatialPick | null {
    return this.spatialShell && this.host.presenting ? this.spatialShell.shell.pick(ray) : null
  }

  /** The scene showing the displayed group or braid experiment, if any (verification and the HUD). */
  get scene(): { layout: SceneLayout; scene: DomainScene<unknown>; desc: unknown } | null {
    return this.activeScene
  }

  /**
   * Switch demonstrations through ordinary validated actions: select the other demonstration's experiment
   * (restoring what it showed last), or create the operation-order comparison the first time.
   */
  showDemo(kind: DemoKind, source = 'control'): { summary: string[] } | null {
    const doc = this.workspace.current
    if (this.demo === kind) return null
    const last = this.lastShown[kind]
    let actions: unknown[]
    if (kind === 'order') actions = orderDemoActions(doc, last?.sampleId ?? undefined)
    else if (kind === 'pq') actions = pqDemoActions(doc, last?.experimentId ?? null, last?.sampleId ?? 's(1,0,1)')
    else if (last && doc.experiments.some((e) => e.id === last.experimentId && demoOf(doc, e) === kind)) actions = [{ kind: 'select_item', experimentId: last.experimentId, item: last.item }]
    else if (kind === 'proof') actions = proofActions(doc)
    else actions = fourDemoActions(doc, kind)
    if (!actions.length) return null
    // A demonstration switch shows the other scene as committed (no motion from an unrelated scene).
    const r = this.transact(actions, source)
    return r
  }

  /** The displayed comparison's branch for a side (from the bound recipe's ports), or null outside a comparison. */
  comparedBranch(side: 'left' | 'right', doc: Doc = this.workspace.current): { experimentId: string; branchId: string } | null {
    const e = activeExperiment(doc)
    const cmp = e.binding ? comparisonOf(findRecipe(doc, e.binding.recipeId)) : null
    return cmp ? { experimentId: e.id, branchId: e.binding!.ports[cmp[side]]! } : null
  }

  /** Reverse one route of the displayed comparison (set_branch, then the comparison replays). */
  reverseRoute(side: 'left' | 'right', source = 'control'): { summary: string[] } | null {
    const b = this.comparedBranch(side)
    if (!b) return null
    return this.transact(reverseRouteActions(activeExperiment(this.workspace.current), b.branchId), source)
  }

  /** Voice wiring: the Talk control's label (Talk / Stop / Cancel / Sending / No voice). */
  setTalkLabel(text: string): void {
    if (text === this.talkLabel) return
    this.talkLabel = text
    this.refreshControls()
  }

  /** The in-scene push-to-talk caption (application events only). */
  setVoiceLine(line: VoiceLine | null): void {
    this.adapter.setVoiceLine(line)
  }

  get playback() {
    return this.activeScene ? this.activeScene.scene.playback() : this.adapter.playback()
  }

  command(cmd: ControlCommand | 'play' | 'pause' | 'cancel'): void {
    this.controls.flash(cmd === 'play' || cmd === 'pause' ? 'toggle' : cmd === 'cancel' ? 'undo' : cmd)
    // Playback is presentation of committed state: an active drag is cancelled first (review F3).
    if ((cmd === 'toggle' || cmd === 'play' || cmd === 'pause' || cmd === 'replay') && this.drag) {
      this.cancelDrag(cmd)
      this.applyCommitted()
    }
    if (this.activeScene || !isLinearDisplayed(this.workspace.current)) {
      this.domainCommand(cmd)
      this.note('command', cmd)
      this.refreshControls()
      return
    }
    switch (cmd) {
      case 'toggle':
      case 'play':
      case 'pause': {
        const pb = this.adapter.playback()
        if (!pb.active) this.adapter.setPlayback('replay')
        else this.adapter.setPlayback(cmd === 'toggle' ? 'toggle' : cmd)
        break
      }
      case 'replay':
        if (this.dirty) this.applyCommitted()
        this.adapter.setPlayback('replay')
        break
      case 'demo':
        try {
          this.showDemo(nextDemo(this.demo))
        } catch (err) {
          this.lastError = err instanceof TransactionError ? `not applied: ${err.message}` : String(err)
          this.note('demoRefused', this.lastError)
        }
        break
      case 'talk':
        this.onTalk?.()
        break
      case 'mode':
        this.mode = this.mode === 'fiber' ? 'free' : 'fiber'
        break
      case 'undo':
        if (this.drag) this.cancelDrag('undo')
        else this.workspace.undo()
        break
      case 'cancel':
        if (this.drag) this.cancelDrag('cancel')
        break
      case 'rebind': {
        const target = rebindTarget(this.workspace.current)
        try {
          // In the comparison the same control reverses the left route (an order edit through set_branch).
          if (this.demo === 'order') this.reverseRoute('left')
          else if (target.actions.length) this.transact(target.actions, 'control')
        } catch (err) {
          this.lastError = err instanceof TransactionError ? `not applied: ${err.message}` : String(err)
          this.note('rebindRefused', this.lastError)
        }
        break
      }
    }
    this.note('command', cmd)
    this.refreshControls()
  }

  /** Controls while a group or braid demonstration is shown: playback drives its scene; `mode` and `rebind`
   * become the demonstration's Reset and its own control (src/demo/four.ts); undo and talk are unchanged. */
  private domainCommand(cmd: ControlCommand | 'play' | 'pause' | 'cancel'): void {
    const scene = this.activeScene?.scene ?? null
    const run = (actions: unknown[], what: string) => {
      if (!actions.length) return
      try {
        this.transact(actions, `control:${what}`)
      } catch (err) {
        this.lastError = err instanceof TransactionError ? `not applied: ${err.message}` : String(err)
        this.note(`${what}Refused`, this.lastError)
      }
    }
    switch (cmd) {
      case 'toggle':
      case 'play':
      case 'pause': {
        if (!scene) break
        const pb = scene.playback()
        if (!pb.active) scene.setPlayback('replay')
        else scene.setPlayback(cmd === 'toggle' ? 'toggle' : cmd)
        break
      }
      case 'replay':
        scene?.setPlayback('replay')
        break
      case 'demo':
        try {
          this.showDemo(nextDemo(this.demo))
        } catch (err) {
          this.lastError = err instanceof TransactionError ? `not applied: ${err.message}` : String(err)
          this.note('demoRefused', this.lastError)
        }
        break
      case 'talk':
        this.onTalk?.()
        break
      case 'mode':
        run(domainControls(this.workspace.current, displayedExperiment(this.workspace.current)).reset.actions, 'reset')
        break
      case 'rebind':
        run(domainControls(this.workspace.current, displayedExperiment(this.workspace.current)).extra.actions, 'extra')
        break
      case 'undo':
        this.workspace.undo()
        break
      case 'cancel':
        break
    }
  }

  /**
   * DEV: preview the passthrough look on the desktop: transparent clear, environment hidden, the backing panel
   * shown, and a bright stand-in wall where the room would be. Off restores the normal look. Not available
   * while a session runs (the session decides its own look).
   */
  setPassthroughPreview(on: boolean): void {
    if (this.host.presenting) return
    this.host.setPassthroughLook(on)
    this.setBackdrops(on)
    if (on && !this.roomStandIn) {
      this.roomStandIn = createRoomStandIn()
      this.host.scene.add(this.roomStandIn)
    } else if (!on && this.roomStandIn) {
      this.roomStandIn.removeFromParent()
      this.roomStandIn.geometry.dispose()
      this.roomStandIn = null
    }
  }

  private setBackdrops(on: boolean): void {
    this.backdrop.visible = on
    this.controlsBackdrop.visible = on
  }

  get passthroughBackdropVisible(): boolean {
    return this.backdrop.visible
  }

  /** A mathematical drag preview is on screen (assistant proposals must not apply now, W5). */
  isPreviewing(): boolean {
    return this.drag !== null
  }

  /** The spatial evidence line under the map caption (application-owned text; null hides it). */
  setEvidenceLine(line: { tex: string; plain: string; kind: 'checked' | 'pending' | 'other' } | null): void {
    this.adapter.setEvidenceLine(line)
  }

  setAssistantLine(line: { text: string; synthetic: boolean } | null): void {
    this.adapter.setAssistantLine(line)
  }

  /** Open a validated document as a new workspace (import / reopen): history starts empty (W3). */
  openDocument(doc: Doc, source: string): void {
    if (this.drag) this.cancelDrag(`open:${source}`)
    if (this.bench) this.endBench()
    if (this.adapter.playback().active) this.adapter.finishTransition()
    this.workspace.replace(doc)
    this.note('open', { source, workspaceId: doc.workspaceId, revision: doc.revision })
    this.nextSceneTransition = 'snap'
    if (this.syncScene()) this.dirty = false
    else this.replayCommitted()
    this.refreshControls()
  }

  dispose(): void {
    this.offFrame()
    this.offSession()
    this.offVisibility()
    this.unsubscribe()
    for (const sc of this.scenes.values()) sc.dispose()
    this.scenes.clear()
    this.activeScene = null
    this.spatialShell?.shell.dispose()
    this.adapter.dispose()
    this.controls.dispose()
    this.input.dispose()
  }

  /** Dev: replace the adapter (mount/dispose cycle) keeping the committed workspace. */
  async remount(): Promise<void> {
    for (const sc of this.scenes.values()) sc.dispose()
    this.scenes.clear()
    this.activeScene = null
    this.adapter.dispose()
    this.adapter = this.mountAdapter()
    if (this.spatialShell) {
      this.spatialShell.shell.mount(this.adapter.bench)
      this.controls.group.visible = false
    }
    if (this.presentation) {
      const p = this.presentation
      this.presentation = null
      this.applyPresentation(p)
    }
    if (this.syncScene()) {
      this.dirty = false
      return
    }
    await this.adapter.prepare(this.describeCurrent())
    const desc = this.describeCurrent()
    this.adapter.apply(desc)
    this.lastDesc = desc
    this.dirty = false
  }

  // ------------------------------------------------------------------ frame

  private lastFrameTime = 0

  private readonly frame = (ctx: FrameContext): void => {
    this.lastFrameTime = ctx.time
    // 1. host input
    const tIn = performance.now()
    const events = this.input.update(ctx.presenting, ctx.time)
    const hoveredControls: ControlCommand[] = []
    for (const p of this.input.pointers.values()) {
      if (!p.active) continue
      const c = this.updateHover(p)
      if (c) hoveredControls.push(c)
    }
    this.controls.setHover(hoveredControls)
    for (const e of events) this.onEvent(e.pointer, e.kind)
    const tDrag = performance.now()
    profileStage('app.input', tDrag - tIn)
    // 2. preview / bench move (suspended while the needed pose is unavailable)
    if (this.drag) this.updateDrag(ctx.time)
    if (this.bench) this.updateBench(ctx.time)
    this.recordResumeTrace()
    // 3-4. recompute + synchronize when committed state changed
    if (this.dirty && !this.drag && this.syncScene()) {
      this.dirty = false
      this.refreshControls()
    }
    if (this.dirty && !this.drag) {
      const desc = timed('app.derive', () => this.describeCurrent())
      timed('adapter.apply', () => this.adapter.apply(desc))
      this.lastDesc = desc
      this.dirty = false
      this.refreshControls()
    }
    const tStep = performance.now()
    profileStage('app.update', tStep - tDrag)
    // 5. presentation (animations, labels, sync to three); the host renders after this returns
    this.adapter.step(ctx)
    if (this.activeScene) this.activeScene.scene.step(ctx)
    this.spatialShell?.shell.step(ctx)
    profileStage('adapter.step', performance.now() - tStep)
    // Review C4: the transition can finish on its own; refresh controls only when playback state flips.
    const pb = this.playback
    if (`${pb.active}:${pb.playing}` !== this.playbackSig) this.refreshControls()
    this.controls.step(ctx.time, ctx.dt)
  }

  private rayOf(p: Pointer): Ray {
    return this.ray.set(p.origin, p.direction)
  }

  private updateHover(p: Pointer): ControlCommand | null {
    if (this.drag?.pointer === p.id) return null
    const ray = this.rayOf(p)
    const ui = this.shellPick(ray)
    this.spatialShell?.shell.setHover(ui?.id ?? null)
    if (ui) {
      this.activeScene?.scene.setHover(null)
      this.hover.set(p.id, `ui:${ui.id}`)
      if (p.id !== 'mouse') this.input.setRayLength(p.id, ui.distance, true)
      return null
    }
    const ctl = this.spatialShell ? null : this.controls.pick(ray)
    if (this.activeScene) {
      const sp = ctl ? null : this.activeScene.scene.pick(ray)
      this.activeScene.scene.setHover(sp?.id ?? null)
      const hint = sp?.hint ?? null
      if (hint !== this.sceneHint) {
        this.sceneHint = hint
        this.refreshControls()
      }
      this.hover.set(p.id, ctl ? `ctl:${ctl.command}` : sp?.id ?? null)
      if (p.id !== 'mouse') this.input.setRayLength(p.id, ctl ? ctl.distance : sp ? sp.distance : null, !!(sp || ctl))
      return ctl?.command ?? null
    }
    const hit = ctl ? null : this.adapter.pick(ray)
    this.hover.set(p.id, ctl ? `ctl:${ctl.command}` : hit?.id ?? null)
    if (p.id !== 'mouse') this.input.setRayLength(p.id, ctl ? ctl.distance : hit ? hit.distance : null, !!(hit || ctl))
    return ctl?.command ?? null
  }

  private onEvent(pointer: PointerId, kind: PointerEventKind): void {
    const p = this.input.pointers.get(pointer)
    if (!p) return
    // Controller buttons: A/X held = push-to-talk, B/Y while recording = cancel it (src/runtime/input.ts HoldToTalk).
    if (this.holdToTalk.handle(pointer, kind)) return
    if (kind === 'press') {
      // Review C2: a press needs a valid target-ray pose this frame; a stale pose never starts anything.
      if (!p.rayValid) {
        this.stats.ignoredPresses++
        this.note('pressIgnored', { pointer, rayPose: p.rayPose, suspended: this.input.isSuspended })
        return
      }
      const ray = this.rayOf(p)
      const ui = this.shellPick(ray)
      if (ui) {
        this.note('uiPress', { id: ui.id, command: ui.command?.kind ?? null })
        if (this.spatialShell!.shell.press?.(ui.id)) return
        // Assistant and inspector commands change what the published view says about voice and the open panel.
        if (ui.command?.kind === 'assistant' || ui.command?.kind === 'inspector') this.voiceCommandAt = this.lastFrameTime
        if (ui.command) this.spatialShell!.dispatch(ui.command)
        return
      }
      const ctl = this.spatialShell ? null : this.controls.pick(ray)
      if (ctl) return this.command(ctl.command)
      if (this.activeScene) return this.scenePress(pointer, ray)
      // While one pointer drags, other pointers cannot start edits or selections (review F4).
      if (this.drag) return
      const hit = this.adapter.pick(ray)
      if (!hit) {
        if (pointer === 'mouse') this.input.beginOrbitFromPendingPress()
        return
      }
      const sel = this.workspace.current.selection.sampleId
      if (hit.view === 'input' && hit.sourceId === sel) {
        if (this.bench) return // moving the workbench and editing a sample are exclusive modes (M4)
        return this.beginDrag(pointer, hit.sourceId)
      }
      if (hit.sourceId === sel) return
      this.workspace.commit({ baseRevision: this.workspace.current.revision, actions: [{ kind: 'select', experimentId: this.workspace.current.selection.experimentId, sampleId: hit.sourceId }] })
      this.note('select', hit.sourceId)
    } else if (kind === 'release') {
      if (this.drag?.pointer === pointer) {
        // Released while tracking was lost: the last preview may not be what the user meant. Cancel.
        // (The desktop mouse has no pose to lose: its release always commits - review C2-2.)
        if (pointer !== 'mouse' && (this.drag.lostAt !== null || !p.rayValid)) this.cancelDrag('released-while-tracking-lost')
        else this.commitDrag()
      }
    } else if (kind === 'cancel' || kind === 'buttonB') {
      if (this.drag && (kind === 'buttonB' || this.drag.pointer === pointer)) this.cancelDrag(kind)
      // With the refined UI, the controller shortcuts go through the toolbar's own availability (one command gate).
      else if (kind === 'buttonB') this.spatialShell ? this.spatialShell.dispatch({ kind: 'replay' }) : this.command('replay')
      if (kind === 'cancel' && this.bench?.pointer === pointer) this.endBench()
    } else if (kind === 'buttonA' || kind === 'buttonAHoldEnd') {
      // A tap of A/X (sent on release since hold-to-talk: a press held for HOLD_TO_TALK is push-to-talk instead). A held
      // press reaches here only when hold-to-talk declined it (legacy controls, no spatial shell): it is the old tap.
      if (this.spatialShell) this.spatialShell.dispatch({ kind: 'playPause' })
      else this.command('toggle')
    } else if (kind === 'grip') {
      if (!p.gripValid) {
        this.stats.ignoredGrips++
        this.note('gripIgnored', { pointer, gripPose: p.gripPose, suspended: this.input.isSuspended })
        return
      }
      if (!this.drag && !this.bench) this.beginBench(p)
    } else if (kind === 'gripRelease') {
      if (this.bench?.pointer === pointer) this.endBench()
    }
  }

  /** A press on a group or braid scene: its proposed actions go through the planner (all or nothing). */
  private scenePress(pointer: PointerId, ray: Ray): void {
    const hit = this.activeScene!.scene.pick(ray)
    if (!hit) {
      if (pointer === 'mouse') this.input.beginOrbitFromPendingPress()
      return
    }
    this.note('scenePress', { id: hit.id, actions: hit.actions.length, presentation: hit.presentation ?? null })
    if (hit.presentation) {
      this.activeScene!.scene.setPlayback(hit.presentation)
      this.refreshControls()
      return
    }
    if (!hit.actions.length) return
    try {
      this.transact(hit.actions, 'scene')
    } catch (err) {
      this.lastError = err instanceof TransactionError ? `not applied: ${err.message}` : String(err)
      this.note('sceneRefused', this.lastError)
    }
  }

  // ------------------------------------------------------------------ drag (preview -> commit once)

  private beginDrag(pointer: PointerId, sampleId: string): void {
    // R5 / M7: a semantic edit cancels the active transition and shows its committed target first.
    if (this.adapter.playback().active) this.adapter.finishTransition()
    const base = this.workspace.current
    const fiberOk = this.lastDesc?.fiberAvailable ?? false
    const mode: DragMode = this.mode === 'fiber' && fiberOk ? 'fiber' : 'free'
    const handle = this.handleWorld(sampleId)
    const p = this.input.pointers.get(pointer)!
    const plane = new Plane().setFromNormalAndCoplanarPoint(p.direction.clone().negate(), handle)
    this.drag = { pointer, sampleId, mode, base, preview: null, plane, grab: null, lostAt: null, reanchor: false }
    this.drag.grab = this.pointerTarget(this.drag)
    this.input.setOrbitAllowed(false)
    this.note('dragStart', { sampleId, mode })
    this.refreshControls()
  }

  private handleWorld(sampleId: string): Vector3 {
    const s = this.activeSamples().find((x) => x.id === sampleId)!
    const math = this.adapter.viewMathGroup('input')
    math.updateMatrixWorld()
    return math.localToWorld(new Vector3(...s.coords.map((c) => Number(c.n) / Number(c.d))))
  }

  /** Raw pointer position for a drag: the fiber parameter (one number) or the local hit (x, y, z). */
  private pointerTarget(d: Drag): number[] | null {
    const p = this.input.pointers.get(d.pointer)
    if (!p || !p.active || !p.rayValid) return null
    const math = this.adapter.viewMathGroup('input')
    const base = this.activeSamples(d.base).find((x) => x.id === d.sampleId)!
    const baseF = base.coords.map((c) => Number(c.n) / Number(c.d))
    if (d.mode === 'fiber') {
      const j = this.lastDesc!.fiberAxis!
      const origin = math.localToWorld(new Vector3(...baseF))
      const axisEnd = math.localToWorld(new Vector3(...baseF.map((v, i) => v + (i === j ? 1 : 0))))
      const t = closestOnLine(origin, axisEnd.clone().sub(origin), p.origin, p.direction)
      return t === null ? null : [t]
    }
    const hit = this.rayOf(p).intersectPlane(d.plane, new Vector3())
    return hit ? math.worldToLocal(hit).toArray() : null
  }

  private updateDrag(time: number): void {
    const d = this.drag!
    const p = this.input.pointers.get(d.pointer)
    // Review C2: without a valid ray pose (none, emulated, or reacquired but not yet settled) the drag is
    // suspended: the preview freezes, nothing is read from the pose, and a long loss cancels without
    // committing.
    if (!p?.rayValid) {
      if (d.lostAt === null) {
        d.lostAt = time
        d.reanchor = true
        this.stats.suspensions++
        this.note('dragSuspended', { pointer: d.pointer, rayPose: p?.rayPose ?? 'none', preview: d.preview ? vecText(d.preview) : null })
        this.refreshControls()
      } else if (time - d.lostAt > TRACKING_TIMEOUT) this.cancelDrag('tracking-lost-timeout')
      return
    }
    if (d.lostAt !== null) {
      if (time - d.lostAt > TRACKING_TIMEOUT) {
        // Back after longer than the timeout (e.g. frames stopped while hidden): never resume an old grab.
        this.cancelDrag('tracking-lost-timeout')
        return
      }
      // Tracking is back. The preview stays frozen until the ray reaches the drag target again.
      d.lostAt = null
      this.refreshControls()
    }
    const base = this.activeSamples(d.base).find((x) => x.id === d.sampleId)!
    const baseF = base.coords.map((c) => Number(c.n) / Number(c.d))
    const now = this.pointerTarget(d)
    if (!now) return
    if (d.reanchor) {
      // Re-anchor so the current (settled) pose maps to the preview already shown: no jump.
      const shown = (d.preview ?? base.coords).map((c) => Number(c.n) / Number(c.d))
      d.grab = d.mode === 'fiber' ? [now[0]! - (shown[this.lastDesc!.fiberAxis!]! - baseF[this.lastDesc!.fiberAxis!]!)] : now.map((v, i) => v - (shown[i]! - baseF[i]!))
      d.reanchor = false
      this.stats.reanchors++
      const at = vecText(d.preview ?? base.coords)
      this.note('dragResumed', { pointer: d.pointer, preview: at })
      this.startResumeTrace('drag', time, at)
      return
    }
    if (!d.grab) d.grab = now
    // Motion relative to the grab point, so a press without motion never changes the value (review
    // F1). The changing coordinate snaps to 1/8 within [-4, 4]; a change under 1/16 keeps the exact
    // committed value; every other coordinate stays exact.
    const delta = d.mode === 'fiber' ? [0, 1, 2].map((i) => (i === this.lastDesc!.fiberAxis ? now[0]! - d.grab![0]! : 0)) : now.map((v, i) => v - d.grab![i]!)
    const coords = base.coords.map((c, i) => (Math.abs(delta[i]!) < 1 / 16 ? c : snapEighth(Number(c.n) / Number(c.d) + delta[i]!)))
    if (d.preview && d.preview.every((c, i) => c.n === coords[i]!.n && c.d === coords[i]!.d)) return
    d.preview = coords
    const setId = this.activeSet(d.base).id
    const previewDoc: Doc = { ...d.base, sampleSets: d.base.sampleSets.map((set) => (set.id === setId ? { ...set, samples: set.samples.map((s) => (s.id === d.sampleId ? { ...s, coords } : s)) } : set)) }
    const desc = timed('app.derive', () => this.describeCurrent(previewDoc, d.sampleId))
    timed('adapter.apply', () => this.adapter.apply(desc))
    this.lastDesc = desc
    timed('app.controls', () => this.refreshControls())
  }

  private commitDrag(): void {
    const d = this.drag!
    this.drag = null
    this.input.setOrbitAllowed(true)
    const set = this.activeSet(d.base)
    const base = set.samples.find((x) => x.id === d.sampleId)!
    const changed = d.preview && !d.preview.every((c, i) => c.n === base.coords[i]!.n && c.d === base.coords[i]!.d)
    if (changed) {
      try {
        this.workspace.commit({ baseRevision: d.base.revision, actions: [{ kind: 'update_sample', sampleSetId: set.id, sampleId: d.sampleId, coords: d.preview!.map(toJson) }] })
        this.note('dragCommit', { sampleId: d.sampleId, coords: vecText(d.preview!) })
      } catch (err) {
        // The edit is refused whole (stale revision or capacity); show the committed state again.
        this.dirty = true
        this.lastError = err instanceof TransactionError ? `edit not applied: ${err.message}` : String(err)
        this.note('dragRefused', this.lastError)
      }
    } else {
      this.dirty = true
      this.note('dragNoChange', d.sampleId)
    }
    this.refreshControls()
  }

  private cancelDrag(reason: string): void {
    this.drag = null
    this.input.setOrbitAllowed(true)
    this.dirty = true
    this.note('dragCancel', reason)
    this.refreshControls()
  }

  // ------------------------------------------------------------------ workbench (presentation only)

  private benchOffset(p: Pointer): Matrix4 {
    const grip = new Matrix4().compose(p.gripPosition, p.gripQuaternion, new Vector3(1, 1, 1))
    this.adapter.bench.updateMatrixWorld()
    return grip.invert().multiply(this.adapter.bench.matrixWorld)
  }

  private beginBench(p: Pointer): void {
    this.bench = { pointer: p.id, offset: this.benchOffset(p), lostAt: null }
    this.note('benchStart', { mathRevision: this.workspace.current.mathRevision })
    this.refreshControls()
  }

  private updateBench(time: number): void {
    const b = this.bench!
    const p = this.input.pointers.get(b.pointer)
    // Review C2: grip pose lost => the bench holds still; reacquired => re-anchor (no jump); a long loss
    // ends the move (presentation only: there is nothing to commit or roll back).
    if (!p?.gripValid) {
      if (b.lostAt === null) {
        b.lostAt = time
        this.stats.suspensions++
        this.note('benchSuspended', { pointer: b.pointer, gripPose: p?.gripPose ?? 'none' })
        this.refreshControls()
      } else if (time - b.lostAt > TRACKING_TIMEOUT) this.endBench()
      return
    }
    if (b.lostAt !== null && time - b.lostAt > TRACKING_TIMEOUT) {
      this.endBench()
      return
    }
    if (b.lostAt !== null) {
      b.offset = this.benchOffset(p)
      b.lostAt = null
      this.stats.reanchors++
      const at = this.adapter.bench.position.toArray().map((v) => +v.toFixed(4)).join(', ')
      this.note('benchResumed', { pointer: b.pointer, position: at })
      this.startResumeTrace('bench', time, at)
      this.refreshControls()
      return
    }
    const m = new Matrix4().compose(p.gripPosition, p.gripQuaternion, new Vector3(1, 1, 1)).multiply(b.offset)
    const pos = new Vector3()
    const q = new Quaternion()
    m.decompose(pos, q, new Vector3())
    // Keep the bench upright: translation plus yaw only (comfort; no roll/pitch of the workspace).
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
    this.adapter.bench.position.copy(pos)
    this.adapter.bench.rotation.set(0, yaw, 0)
  }

  private endBench(): void {
    this.bench = null
    this.note('benchEnd', { mathRevision: this.workspace.current.mathRevision })
    this.refreshControls()
  }

  // ------------------------------------------------------------------ status

  private refreshControls(): void {
    const pb = this.playback
    this.playbackSig = `${pb.active}:${pb.playing}`
    this.stats.refreshes++
    const doc = this.workspace.current
    if (!isLinearDisplayed(doc)) {
      const dc = domainControls(doc, displayedExperiment(doc))
      this.controls.setLabels({
        toggle: pb.active && pb.playing ? 'Pause' : 'Play',
        replay: 'Replay',
        mode: dc.reset.label,
        undo: 'Undo',
        rebind: dc.extra.label,
        demo: DEMO_BUTTON[nextDemo(this.demo)],
        talk: this.talkLabel,
      })
      const scene = this.activeScene?.scene
      this.controls.setStatusPlain(this.sceneProblem ? `Not available: ${this.sceneProblem}` : this.sceneHint ?? scene?.status() ?? '')
      return
    }
    this.controls.setLabels({
      toggle: pb.active && pb.playing ? 'Pause' : 'Play',
      replay: 'Replay',
      // A comparison has no fiber view: drags are free there whatever the mode setting.
      mode: this.mode === 'fiber' && !this.lastDesc?.comparison ? 'Mode: fiber' : 'Mode: free',
      undo: this.drag ? 'Cancel' : 'Undo',
      rebind: this.demo === 'order' ? 'Reverse left' : rebindTarget(this.workspace.current).label,
      demo: DEMO_BUTTON[nextDemo(this.demo)],
      talk: this.talkLabel,
    })
    const st = this.status()
    this.controls.setStatus(st.tokens, st.plain)
  }

  /** Display name of a sample as the scene shows it (fixed labels, or w, w_2 ... in the selected group). */
  private nameOf(id: string): string {
    const p = this.lastDesc?.primitives.find((x) => x.kind === 'point' && x.view === 'input' && x.sourceId === id)
    const label = p && p.kind === 'point' ? p.label : null
    if (label) return label
    const s = this.activeSamples().find((x) => x.id === id)
    return s ? vecText(s.coords) : id
  }

  /**
   * The status line as prebuilt glyph tokens (phrases + names + axis letters), so changing it during a drag
   * never typesets (review C1). Names come from the scene's own labels.
   */
  status(): { tokens: { tex: string; space?: Space }[]; plain: string } {
    const W = (tex: string, space: Space = 'word') => ({ tex, space })
    const N = (tex: string) => ({ tex })
    let t: { tex: string; space?: Space }[]
    // A drag is checked first: if one is active, mathematics is being previewed (review F6).
    if (this.drag && this.drag.lostAt !== null) t = [W(PHRASE.lostDrag)]
    else if (this.bench && this.bench.lostAt !== null) t = [W(PHRASE.lostBench)]
    else if (this.drag) {
      const n = this.nameOf(this.drag.sampleId)
      const cancel = this.drag.pointer === 'mouse' ? PHRASE.escCancels : PHRASE.bCancels
      t = this.drag.mode === 'fiber'
        ? [W(PHRASE.previewSliding), N(n), W(PHRASE.previewAlong), W(cancel)]
        : [W(PHRASE.previewMoving), N(n), W(PHRASE.previewMovingEnd, 'close'), W(cancel)]
    } else if (this.bench) t = [W(PHRASE.bench)]
    else if (this.lastDesc?.comparison) {
      // The comparison writes its own status (both routes' order in words); shown as given.
      const c = this.lastDesc.comparison
      return { tokens: c.statusTokens.map((x) => ({ tex: x.tex, space: x.space })), plain: c.statusPlain }
    } else {
      const sel = this.workspace.current.selection.sampleId
      const sym = this.lastDesc?.mapSymbol ?? ''
      if (!sel) t = [W(PHRASE.select)]
      else {
        const n = this.nameOf(sel)
        const axis = this.lastDesc?.fiberAxis
        const axisName = axis === null || axis === undefined ? null : ['x', 'y', 'z'][axis]!
        if (this.mode === 'fiber' && axisName) t = [W(PHRASE.drag), N(n), W(PHRASE.alongFiber), N(sym), N(n), W(PHRASE.stays)]
        // Free mode: the truthful statement depends on the map (review V5).
        else if (axisName) t = [W(PHRASE.drag), N(n), W(PHRASE.freely), N(sym), N(n), W(PHRASE.changesUnless), N(axisName)]
        else t = [W(PHRASE.drag), N(n), W(PHRASE.freelyOnly)]
      }
    }
    // Plain fallback: words separated by spaces; "P" + name adjacent; no space before a closing phrase.
    const plain = t.map((x, i) => (i === 0 || x.space === 'close' || (x.space === undefined && t[i - 1]!.space === undefined) ? '' : ' ') + plainOf(x.tex)).join('')
    return { tokens: t, plain }
  }

  private startResumeTrace(kind: 'drag' | 'bench', t: number, at: string): void {
    const trace = { kind, t: +t.toFixed(3), at, frames: [] }
    this.resumeTraces.push(trace)
    if (this.resumeTraces.length > 20) this.resumeTraces.shift()
    this.resumeTrace = { trace, prev: this.adapter.bench.position.clone() }
  }

  private recordResumeTrace(): void {
    const r = this.resumeTrace
    if (!r) return
    const { trace } = r
    if (trace.kind === 'drag') trace.frames.push(this.drag ? (this.drag.preview ? vecText(this.drag.preview) : trace.at) : 'ended')
    else if (this.bench) {
      const pos = this.adapter.bench.position
      trace.frames.push(+pos.distanceTo(r.prev).toFixed(4))
      r.prev.copy(pos)
    } else trace.frames.push('ended')
    if (trace.frames.length >= 30 || trace.frames[trace.frames.length - 1] === 'ended') this.resumeTrace = null
  }

  private note(event: string, detail?: unknown): void {
    this.log.push({ t: +performance.now().toFixed(1), event, detail })
    if (this.log.length > 400) this.log.shift()
  }

  snapshot() {
    const s = this.workspace.current
    if (!isLinearDisplayed(s)) {
      const sc = this.activeScene
      return {
        revision: s.revision,
        mathRevision: s.mathRevision,
        experimentId: s.selection.experimentId,
        demo: this.demo,
        domain: displayedExperiment(s).domain,
        item: s.selection.item,
        selection: null,
        scene: sc ? { layout: sc.layout, status: sc.scene.status() } : null,
        sceneProblem: this.sceneProblem,
        playback: this.playback,
        canUndo: this.workspace.canUndo,
        comparison: null,
        mapSymbol: null,
        map: null,
        selected: null,
        mode: this.mode,
        dragging: null,
        benchMoving: !!this.bench,
        collisions: [],
        tex: { ...texStats },
      }
    }
    const sel = s.selection.sampleId ? this.activeSamples(s).find((x) => x.id === s.selection.sampleId) : null
    return {
      revision: s.revision,
      mathRevision: s.mathRevision,
      experimentId: s.selection.experimentId,
      demo: this.demo,
      domain: 'linear' as const,
      item: null,
      comparison: this.lastDesc?.comparison ? { left: this.lastDesc.comparison.left, right: this.lastDesc.comparison.right, mapsEqual: this.lastDesc.comparison.mapsEqual } : null,
      mapSymbol: this.lastDesc?.mapSymbol ?? null,
      map: displayedMatrix(s).map((r) => r.map(format)),
      selection: s.selection.sampleId,
      selected: sel ? vecText(sel.coords) : null,
      mode: this.mode,
      dragging: this.drag ? { sampleId: this.drag.sampleId, mode: this.drag.mode, preview: this.drag.preview ? vecText(this.drag.preview) : null, lost: this.drag.lostAt !== null } : null,
      benchMoving: !!this.bench,
      collisions: this.lastDesc?.collisions ?? [],
      playback: this.adapter.playback(),
      canUndo: this.workspace.canUndo,
      tex: { ...texStats },
    }
  }
}

/** Parameter t on the line origin + t*dir closest to the ray (o, d); null when parallel. */
function closestOnLine(origin: Vector3, dir: Vector3, o: Vector3, d: Vector3): number | null {
  const w0 = origin.clone().sub(o)
  const a = dir.dot(dir)
  const b = dir.dot(d)
  const c = d.dot(d)
  const dd = dir.dot(w0)
  const e = d.dot(w0)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-9) return null
  return (b * e - c * dd) / denom
}
