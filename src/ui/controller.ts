// The UI controller (UI-REFINEMENT-SPEC section 9): builds the one derived UiView both renderers read, and
// executes UiCommands. UI-only commands change the UiStore (never the document); mathematical selection and
// edits go through the app's validated transaction path; playback through the scene's presentation API;
// workspace, voice, assistant and evidence commands through their existing clients. A context item, detail
// action or More entry is activated by ID from the CURRENT view, and a disabled one is refused here, so no
// input route (mouse, keyboard, controller ray) can fire it.

import type { App } from '../app'
import type { Host } from '../runtime/host'
import type { AssistantClient, AssistantState } from '../assistant/client'
import type { VoiceClient } from '../voice/client'
import type { EvidenceClient } from '../evidence/client'
import type { AssistantCapability, SpeechCapability } from '../../server/types'
import type { DemoKind } from '../demo/order'
import { activeExperiment, displayedExperiment, findRecipe, isLinearDisplayed } from '../workspace/document'
import { WHAT_GETS_LOST, layoutOf } from '../recipes/recipe'
import { bindingsFor } from '../demo/pq'
import { TransactionError } from '../workspace/reducer'
import { UiStore } from './store'
import { type CheckHold, applyCheckStatus, checkScope, linkedEntry, newestEvidenceId, requestedCheck, statusEntry } from './assistant/checkStatus'
import {
  ASSISTANT_NAME, EXPERIMENTS, withTitle,
  type AnswerCheckLink, type ContextItem, type ContextRun, type DetailItem, type DomainPresentation, type EvidenceItem, type MoreView, type Presenter,
  type PresenterInput, type ToolbarItem, type UiCommand, type UiView,
} from './model'

export interface ControllerDeps {
  app: App
  host: Host
  assistant: AssistantClient
  voice: VoiceClient
  evidence: EvidenceClient
  /** Workspace file operations (the existing persistence functions, wrapped by the entry). */
  workspace: {
    save(): Promise<string>
    reopen(): Promise<string>
    exportJson(): string
    importJson(): void
  }
  capabilities(): { assistant: AssistantCapability | null; speech: SpeechCapability | null } | null
  /** Clock for how long a settled Lean result stays in the status line (default performance.now; tests inject one). */
  now?: () => number
}

/** A minimal presentation when the presenters are not loaded (the app keeps working, truthfully sparse). */
function fallbackPresentation(input: PresenterInput): DomainPresentation {
  const copy = EXPERIMENTS.find((e) => e.kind === input.demo)!
  const p = input.playback
  return {
    subtitle: { plain: copy.topic },
    context: { title: null, groups: [], hint: null },
    status: { phase: p.active ? (p.playing ? 'animating' : 'paused') : 'ready', text: input.sceneProblem ? `Not available: ${input.sceneProblem}` : p.active ? (p.playing ? 'Animating' : 'Paused') : 'Ready', tone: input.sceneProblem ? 'error' : 'normal' },
    playback: { play: { enabled: true }, replay: { enabled: true } },
    resets: [],
    detail: { sections: [] },
    scene: { inSceneControls: true, detailsOpen: input.detailsOpen },
  }
}

export class UiController {
  readonly store = new UiStore()
  private presenters: Record<DemoKind, Presenter> | null = null
  private current: UiView | null = null
  private sig = ''
  private dirty = true
  private readonly listeners = new Set<(v: UiView) => void>()
  /** Last workspace-operation result for More, and the last refused command for the status line. */
  private notice: { text: string; tone: 'normal' | 'error' } | null = null
  private refused: string | null = null
  private support = { vr: false, passthrough: false }
  /** Lean check visibility (src/ui/assistant/checkStatus.ts): the status-line hold of a settled result, when
   * each entry was first seen settled, and which entry the latest answer's request_check created. */
  private hold: CheckHold | null = null
  private readonly settledAt = new Map<number, number>()
  private checkLink: AnswerCheckLink | null = null
  private readonly now: () => number

  constructor(private readonly d: ControllerDeps) {
    this.now = d.now ?? (() => performance.now())
    const mark = () => this.invalidate()
    // Results that settled before this controller existed are not news: they never take the status line.
    for (const e of d.evidence.entries) if (e.status !== 'computed' && e.status !== 'checking') this.settledAt.set(e.id, -Infinity)
    d.app.workspace.subscribe(() => {
      this.refused = null
      mark()
    })
    this.store.subscribe(mark)
    d.assistant.subscribe((s) => {
      this.noteAssistant(s)
      mark()
    })
    d.voice.subscribe(mark)
    d.evidence.subscribe(() => {
      this.noteEvidence()
      mark()
    })
    d.host.onSession(mark)
    // Playback, drags and scene status change without a commit: rebuild when their signature changes.
    d.host.onFrame(() => {
      const pb = d.app.playback
      const s = d.app.snapshot()
      const sig = `${pb.active}|${pb.playing}|${pb.step?.index ?? ''}|${s.dragging ? `${s.dragging.sampleId}:${s.dragging.preview}:${s.dragging.lost}` : ''}|${d.app.mode}|${d.app.sceneProblem ?? ''}|${d.app.scene?.layout ?? ''}|${d.app.walkStage}`
      if (sig !== this.sig) {
        this.sig = sig
        this.dirty = true
      }
      // A settled Lean result leaves the status line after HOLD_MS (no event marks that moment).
      if (this.hold && !this.hold.ended && this.now() >= this.hold.until) this.dirty = true
      this.publish()
    })
    void d.host.passthroughSupported().then((ar) => {
      this.support.passthrough = ar
      mark()
    })
    void (globalThis.navigator?.xr?.isSessionSupported('immersive-vr').catch(() => false) ?? Promise.resolve(false)).then((vr) => {
      this.support.vr = !!vr
      mark()
    })
  }

  setPresenters(p: Record<DemoKind, Presenter> | null): void {
    this.presenters = p
    this.invalidate()
  }

  get view(): UiView {
    if (this.dirty || !this.current) this.rebuild()
    return this.current!
  }

  subscribe(fn: (v: UiView) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  invalidate(): void {
    this.dirty = true
  }

  /** The key renderers last received (reading `view` between frames rebuilds without notifying). */
  private publishedKey: string | null = null

  /** Rebuild if needed and notify renderers (called once per frame by the host loop). */
  private publish(): void {
    if (this.dirty || !this.current) this.rebuild()
    if (this.current!.key === this.publishedKey) return
    this.publishedKey = this.current!.key
    this.listeners.forEach((fn) => fn(this.current!))
  }

  // ------------------------------------------------------------------ view

  private evidenceItems(): EvidenceItem[] {
    return this.d.evidence.entries.map((e) => ({
      id: e.id,
      claim: e.request,
      label: e.label,
      status: e.status,
      current: e.current,
      statement: e.response?.statement ?? null,
      provenance: e.response?.provenance ? `${e.response.provenance.toolchain} · ${e.response.provenance.theorem} · receipt ${e.response.receipt?.id ?? '—'}` : null,
      message: e.error ?? e.response?.reason ?? (e.status === 'computed' ? `Computed exactly: ${e.local.detail}` : null),
      holds: e.local.holds,
    }))
  }

  /** Record when each evidence entry was first seen settled (its result's moment for the status line). */
  private noteEvidence(): void {
    const now = this.now()
    const live = new Set<number>()
    for (const e of this.d.evidence.entries) {
      live.add(e.id)
      if (e.status !== 'computed' && e.status !== 'checking' && !this.settledAt.has(e.id)) this.settledAt.set(e.id, now)
    }
    for (const id of [...this.settledAt.keys()]) if (!live.has(id)) this.settledAt.delete(id)
  }

  /**
   * An applied (or answered) proposal with request_check: remember the newest evidence entry at that moment.
   * The assistant notifies before it hands the check effect to the evidence client, so the check this proposal
   * starts is the first entry for its claim with a larger ID.
   */
  private noteAssistant(s: AssistantState): void {
    if (requestedCheck(s) && 'requestId' in s) {
      if (this.checkLink?.requestId !== s.requestId) this.checkLink = { requestId: s.requestId, afterId: newestEvidenceId(this.d.evidence.entries), entryId: null }
    } else if (this.checkLink && (!('requestId' in s) || s.requestId !== this.checkLink.requestId)) this.checkLink = null
  }

  /** The answer card's link, pinned to its evidence entry once that entry exists. */
  private answerCheckLink(state: AssistantState, items: EvidenceItem[]): AnswerCheckLink | null {
    this.noteAssistant(state)
    const link = this.checkLink
    const claim = requestedCheck(state)
    if (!link || !claim || link.entryId !== null) return link
    const e = linkedEntry(claim, link, items)
    if (e) this.checkLink = { ...link, entryId: e.id }
    return this.checkLink
  }

  /** The status line with the displayed experiment's Lean check (running, or a settled result for a while). */
  private withCheckStatus(presentation: DomainPresentation, input: PresenterInput, items: EvidenceItem[]): DomainPresentation {
    this.noteEvidence()
    // The most recently settled entry, by when each was first seen settled: a request refused while another
    // check ran (not_sent, newer ID) never replaces the result of the check that settled after it.
    const entry = statusEntry(items, checkScope(input.doc, input.demo, input.experimentId), this.settledAt)
    const r = applyCheckStatus(presentation.status, entry, { now: this.now(), settledAt: entry ? this.settledAt.get(entry.id) ?? null : null, hold: this.hold, dragging: input.drag !== null, evidence: items })
    this.hold = r.hold
    return r.status === presentation.status ? presentation : { ...presentation, status: r.status }
  }

  presenterInput(): PresenterInput {
    const { app } = this.d
    const doc = app.workspace.current
    const s = app.snapshot()
    const linear = isLinearDisplayed(doc)
    return {
      doc,
      demo: app.demo,
      experimentId: doc.selection.experimentId,
      linear: linear ? app.currentDescription() : null,
      scene: app.scene ? { layout: app.scene.layout, desc: app.scene.desc } : null,
      sceneProblem: app.sceneProblem,
      playback: app.playback,
      drag: s.dragging ? { sampleId: s.dragging.sampleId, mode: s.dragging.mode, preview: s.dragging.preview, lost: s.dragging.lost } : null,
      dragMode: app.mode,
      evidence: linear || app.demo === 'proof' ? this.evidenceItems() : [],
      detailsOpen: this.store.state.inspector === 'math',
      lesson: app.demo === 'proof' ? { stage: app.walkStage } : null,
    }
  }

  private present(input: PresenterInput): DomainPresentation {
    const p = this.presenters?.[input.demo]
    if (!p) return fallbackPresentation(input)
    try {
      return p(input)
    } catch (err) {
      const fb = fallbackPresentation(input)
      return { ...fb, status: { phase: fb.status.phase, text: `Presentation error: ${(err as Error).message}`, tone: 'error' } }
    }
  }

  private rebuild(): void {
    const { app, host, assistant, voice } = this.d
    const ui = this.store.state
    const input = this.presenterInput()
    const items = this.evidenceItems()
    let presentation = this.withCheckStatus(this.present(input), input, items)
    if (this.refused) presentation = { ...presentation, status: { ...presentation.status, text: this.refused, tone: 'error' } }
    app.applyPresentation(presentation.scene)
    const copy = EXPERIMENTS.find((e) => e.kind === input.demo)!
    const pb = app.playback
    const snap = app.snapshot()
    const dragging = !!snap.dragging
    const playing = pb.active && pb.playing
    const toolbar: ToolbarItem[] = [
      { id: 'experiments', label: 'Experiments', ariaLabel: 'Experiments: choose an experiment', enabled: true, active: ui.popover === 'experiments' },
      { id: 'assistant', label: ASSISTANT_NAME, ariaLabel: ASSISTANT_NAME, enabled: true, active: ui.inspector === 'assistant' },
      { id: 'play', label: playing ? 'Pause' : 'Play', ariaLabel: playing ? 'Pause the animation' : 'Play the animation', enabled: playing || presentation.playback.play.enabled, reason: playing ? undefined : presentation.playback.play.reason, active: playing },
      { id: 'replay', label: 'Replay', ariaLabel: 'Replay the construction', enabled: presentation.playback.replay.enabled, reason: presentation.playback.replay.reason, active: false },
      { id: 'undo', label: dragging ? 'Cancel drag' : 'Undo', ariaLabel: dragging ? 'Cancel drag' : 'Undo last workspace change', enabled: dragging || app.workspace.canUndo, reason: dragging || app.workspace.canUndo ? undefined : 'Nothing to undo yet', active: false },
      { id: 'more', label: 'More', ariaLabel: 'More: workspace, representation, experiment and session', enabled: true, active: ui.popover === 'more' },
    ]
    const surface = host.presenting ? 'xr' : 'desktop'
    const view: UiView = {
      surface,
      sessionMode: host.presenting ? host.sessionMode : null,
      experiment: { kind: input.demo, question: copy.question, subtitle: withTitle(copy.title, presentation.subtitle) },
      experiments: EXPERIMENTS.map((e) => ({ kind: e.kind, question: e.question, field: e.field, title: e.title, topic: e.topic, selected: e.kind === input.demo })),
      toolbar,
      popover: ui.popover,
      more: this.moreView(presentation, surface),
      presentation,
      inspector: ui.inspector,
      assistant: {
        open: ui.inspector === 'assistant',
        surface,
        assistant: assistant.state,
        voice: voice.state,
        voiceAcquiring: voice.acquiring,
        capability: this.d.capabilities(),
        draft: ui.draft,
        doc: input.doc,
        demo: input.demo,
        experimentId: input.experimentId,
        presentation,
        evidence: items,
        checkLink: this.answerCheckLink(assistant.state, items),
      },
      key: '',
    }
    view.key = JSON.stringify({ ...view, assistant: { ...view.assistant, doc: input.doc.revision, presentation: undefined }, rev: input.doc.revision, t: pb.active ? Math.round(pb.time * 4) : 0 })
    this.current = view
    this.dirty = false
  }

  private moreView(p: DomainPresentation, surface: 'desktop' | 'xr'): MoreView {
    const { app, host } = this.d
    const doc = app.workspace.current
    let representation: MoreView['representation'] = null
    if (isLinearDisplayed(doc)) {
      const e = activeExperiment(doc)
      const r = e.binding ? findRecipe(doc, e.binding.recipeId) : null
      if (r && layoutOf(r) === 'linked_views') representation = { recipeName: r.name, operations: WHAT_GETS_LOST.operations.map((o) => ({ kind: o.kind, label: o.kind.replace(/_/g, ' '), on: r.operations.some((x) => x.kind === o.kind) })) }
    }
    const desktop = surface === 'desktop'
    return {
      sections: [
        { id: 'workspace', title: 'Workspace', items: [
          { id: 'save', label: 'Save workspace', enabled: true },
          { id: 'reopen', label: 'Reopen saved workspace', enabled: true },
          ...(desktop ? [{ id: 'export' as const, label: 'Export workspace JSON', enabled: true }, { id: 'import' as const, label: 'Import workspace JSON', enabled: true }] : []),
        ] },
        { id: 'representation', title: 'Representation', items: [
          { id: 'saveRepresentation', label: 'Save representation…', helper: 'Save the bound recipe (with the operations you choose) and keep using it; "Use on Q" and "Use on V₄" reuse a saved representation on another experiment', enabled: desktop && representation !== null, reason: !desktop ? 'Available on the desktop' : representation ? undefined : 'Available for the P → Q representation' },
        ] },
        { id: 'experiment', title: 'This experiment', items: p.resets.map((r) => ({ id: `reset:${r.id}` as const, label: r.label, helper: r.helper, enabled: r.enabled, reason: r.reason })) },
        { id: 'session', title: 'Session', items: host.presenting
          ? [{ id: 'exitSession', label: host.sessionMode === 'passthrough' ? 'Exit passthrough' : 'Exit VR', enabled: true }]
          : [
              { id: 'enterVR', label: 'Enter VR', enabled: this.support.vr, reason: this.support.vr ? undefined : 'VR is not available in this browser' },
              { id: 'enterPassthrough', label: 'Enter passthrough', helper: 'Your room behind the workbench', enabled: this.support.passthrough, reason: this.support.passthrough ? undefined : 'Passthrough is not available in this browser' },
              { id: 'enableVoice', label: 'Enable voice', helper: 'Ask for the microphone now; nothing is recorded or sent', enabled: true },
            ] },
      ],
      representation,
      notice: this.notice,
    }
  }

  // ------------------------------------------------------------------ commands

  private findItem(id: string): { enabled: boolean; reason?: string; run: ContextRun } | null {
    const p = this.view.presentation
    for (const g of p.context.groups) {
      const it = g.items.find((x: ContextItem) => x.id === id)
      if (it) return it
    }
    for (const s of p.detail.sections) {
      const it = s.items.find((x: DetailItem): x is Extract<DetailItem, { kind: 'action' }> => x.kind === 'action' && x.id === id)
      if (it) return it
    }
    return null
  }

  private refuse(text: string): void {
    this.refused = text
    this.invalidate()
  }

  private run(run: ContextRun, source: string): void {
    const { app, evidence } = this.d
    try {
      switch (run.kind) {
        case 'actions':
          // A different prepared case is a case change (spec section 3): pending voice/model work is cancelled; the draft stays.
          if (run.actions.some((a) => (a as { kind?: unknown }).kind === 'set_vector_walk')) this.cancelAssistantWork('case-change')
          app.transact(run.actions, source)
          this.refused = null
          break
        case 'playback':
          app.command(run.command)
          break
        case 'dragMode':
          app.command('mode')
          break
        case 'check':
          void evidence.check(run.claim)
          break
        case 'stage':
          app.setWalkStage(run.stage)
          break
        case 'none':
          break
      }
    } catch (err) {
      this.refuse(err instanceof TransactionError ? `Not applied: ${err.message}` : String(err))
    }
    this.invalidate()
  }

  /** Cancel voice capture, transcript auto-submit and a pending assistant request (spec section 7: on explicit
   * close, switching to the mathematics inspector, or choosing another experiment). Committed actions stay. */
  private cancelAssistantWork(reason: string): void {
    if (this.d.voice.busy || this.d.voice.state.kind === 'transcript') this.d.voice.cancel()
    if (this.d.assistant.busy) this.d.assistant.cancel(reason)
  }

  readonly dispatch = (cmd: UiCommand): void => {
    const { app, assistant, voice, host } = this.d
    const ui = this.store.state
    switch (cmd.kind) {
      case 'popover':
        this.store.set({ popover: cmd.which })
        break
      case 'experiment':
        this.store.set({ popover: null })
        if (cmd.demo === app.demo) break
        this.cancelAssistantWork('experiment-change')
        try {
          app.showDemo(cmd.demo, 'picker')
          this.refused = null
        } catch (err) {
          this.refuse(err instanceof TransactionError ? `Not opened: ${err.message}` : String(err))
        }
        break
      case 'inspector': {
        const next = cmd.which === ui.inspector ? null : cmd.which
        if (ui.inspector === 'assistant' && next !== 'assistant') this.cancelAssistantWork(next === 'math' ? 'switched-to-details' : 'panel-closed')
        this.store.set({ inspector: next, popover: null, assistantDismissed: next === 'assistant' ? false : ui.inspector === 'assistant' ? true : ui.assistantDismissed })
        break
      }
      case 'playPause': {
        const t = this.view.toolbar.find((x) => x.id === 'play')!
        if (t.enabled) app.command('toggle')
        break
      }
      case 'replay': {
        const t = this.view.toolbar.find((x) => x.id === 'replay')!
        if (t.enabled) app.command('replay')
        break
      }
      case 'undo': {
        const t = this.view.toolbar.find((x) => x.id === 'undo')!
        if (t.enabled) app.command('undo')
        break
      }
      case 'context': {
        const it = this.findItem(cmd.id)
        if (!it || !it.enabled) break
        this.run(it.run, 'ui')
        break
      }
      case 'more':
        this.more(cmd.id)
        break
      case 'saveRepresentation':
        this.saveRepresentation(cmd.operations)
        break
      case 'assistant': {
        const a = cmd.action
        switch (a.kind) {
          case 'ask':
            if (a.text.trim()) {
              void assistant.ask(a.text)
              if (a.text === ui.draft) this.store.set({ draft: '' })
            }
            break
          case 'cancel':
            assistant.cancel()
            break
          case 'retry':
            void assistant.retry()
            break
          case 'draft':
            this.store.set({ draft: a.text })
            break
          case 'voiceToggle':
            voice.toggle(host.presenting ? { autoSubmitMs: 2500 } : {})
            break
          case 'voiceStart':
            void voice.start()
            break
          case 'voiceStop':
            voice.stop()
            break
          case 'voiceCancel':
            voice.cancel()
            break
          case 'transcriptEdit':
            voice.edit(a.text)
            break
          case 'transcriptSubmit':
            voice.submit(a.text)
            break
        }
        break
      }
    }
    this.invalidate()
  }

  private more(id: string): void {
    const { host, voice } = this.d
    const view = this.view
    const item = view.more.sections.flatMap((s) => s.items).find((x) => x.id === id)
    if (!item || !item.enabled) return
    this.store.set({ popover: null })
    const done = (p: Promise<string>) => p.then((text) => this.setNotice(text, 'normal'), (e: unknown) => this.setNotice(String((e as Error)?.message ?? e), 'error'))
    switch (id) {
      case 'save':
        void done(this.d.workspace.save())
        break
      case 'reopen':
        this.cancelAssistantWork('reopen')
        void done(this.d.workspace.reopen())
        break
      case 'export':
        this.setNotice(this.d.workspace.exportJson(), 'normal')
        break
      case 'import':
        this.cancelAssistantWork('import')
        this.d.workspace.importJson()
        break
      case 'enterVR':
        void host.enterXR('vr').catch((e: unknown) => this.setNotice(String(e), 'error'))
        break
      case 'enterPassthrough':
        void host.enterXR('passthrough').catch((e: unknown) => this.setNotice(String(e), 'error'))
        break
      case 'exitSession':
        void host.exitXR()
        break
      case 'enableVoice':
        void voice.requestMicrophone().then((ok) => this.setNotice(ok ? 'Microphone allowed (nothing was recorded or sent)' : 'Microphone not available; typed and controller use still work', ok ? 'normal' : 'error'))
        break
      default:
        if (id.startsWith('reset:')) {
          const r = view.presentation.resets.find((x) => `reset:${x.id}` === id)
          if (r && r.enabled) this.run(r.run, 'ui:reset')
        }
    }
  }

  setNotice(text: string, tone: 'normal' | 'error'): void {
    this.notice = { text, tone }
    this.invalidate()
  }

  /** Save the bound P → Q recipe with the chosen operations as a new representation, bound to the shown experiment. */
  private saveRepresentation(operations: string[]): void {
    const { app } = this.d
    const doc = app.workspace.current
    if (!isLinearDisplayed(doc) || !operations.length) return this.setNotice('A representation needs at least one operation', 'error')
    const e = activeExperiment(doc)
    const ops = WHAT_GETS_LOST.operations.filter((o) => operations.includes(o.kind))
    let n = 1
    while (doc.recipes.some((r) => r.id === `recipe-adapted${n}`)) n++
    const name = `adapted${n}`
    const rule = { name: `What gets lost (adapted ${n})`, inputs: WHAT_GETS_LOST.inputs, operations: ops }
    try {
      app.transact([
        { kind: 'save_recipe', name, recipe: rule },
        { kind: 'bind_recipe', experimentId: e.id, recipeId: `$${name}`, bindings: bindingsFor({ ...doc, recipes: [...doc.recipes, { schemaVersion: 1, id: `recipe-${name}`, ...rule }] }, `recipe-${name}`, e.sampleSetId, e.branches[0]!.id, doc.selection.sampleId) },
      ], 'ui:representation')
      this.setNotice(`Saved representation "${rule.name}" and bound it to ${e.id}`, 'normal')
    } catch (err) {
      this.setNotice(err instanceof TransactionError ? `Not saved: ${err.message}` : String(err), 'error')
    }
  }

  /** The displayed experiment's ID and kind (diagnostics and tests). */
  get displayed() {
    const doc = this.d.app.workspace.current
    return { experimentId: doc.selection.experimentId, domain: displayedExperiment(doc).domain, demo: this.d.app.demo }
  }
}
