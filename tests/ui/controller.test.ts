// The UI controller's command rules (UI-REFINEMENT-SPEC sections 7 and 9): UI-only commands never touch the
// mathematical document or its revision; context items are activated by ID from the current view and a
// disabled one is refused; toolbar commands follow the toolbar's enablement; closing the assistant, switching
// to the mathematics inspector or choosing another experiment cancels voice capture and a pending request.
// A minimal App wraps the real Workspace; the clients are stand-ins with spies. Node only; no rendering.

import { describe, expect, it, vi } from 'vitest'
import { demoDocument } from '../../src/workspace/document'
import { Workspace } from '../../src/workspace/reducer'
import { UiController, type ControllerDeps } from '../../src/ui/controller'
import { ASSISTANT_NAME, type DomainPresentation, type Presenter, type PresenterInput } from '../../src/ui/model'
import type { DemoKind } from '../../src/demo/order'

const V = 's(1,0,-1)'
const SELECT_V = [{ kind: 'select', experimentId: 'exp-p', sampleId: V }]
const BAD = [{ kind: 'select', experimentId: 'exp-p', sampleId: 'no-such-sample' }]

/** A presenter with one valid, one disabled and one invalid context item; play is off, replay on. */
const testPresenter: Presenter = (input: PresenterInput): DomainPresentation => ({
  subtitle: { plain: 'Test' },
  context: {
    title: 'Choose',
    hint: null,
    groups: [{ id: 'g', layout: 'actions', items: [
      { id: 'select-v', label: { plain: 'Select v' }, role: 'primary', enabled: true, run: { kind: 'actions', actions: SELECT_V } },
      { id: 'off', label: { plain: 'Disabled' }, role: 'secondary', enabled: false, reason: 'Not now', run: { kind: 'actions', actions: SELECT_V } },
      { id: 'bad', label: { plain: 'Invalid' }, role: 'secondary', enabled: true, run: { kind: 'actions', actions: BAD } },
      { id: 'replay-scene', label: { plain: 'Replay' }, role: 'secondary', enabled: true, run: { kind: 'playback', command: 'replay' } },
    ] }],
  },
  status: { phase: 'ready', text: `Ready (rev ${input.doc.revision})`, tone: 'normal' },
  playback: { play: { enabled: false, reason: 'Nothing to play' }, replay: { enabled: true } },
  resets: [{ id: 'reset', label: 'Reset experiment', helper: '', enabled: false, reason: 'Nothing to reset', run: { kind: 'actions', actions: SELECT_V } }],
  detail: { sections: [{ title: 'Detail', items: [{ kind: 'action', id: 'detail-select', label: { plain: 'Select v' }, enabled: true, run: { kind: 'actions', actions: SELECT_V } }] }] },
  scene: { inSceneControls: false, detailsOpen: input.detailsOpen },
})

function setup(opts: { pending?: boolean; voiceBusy?: boolean } = {}) {
  const workspace = new Workspace(demoDocument())
  let demo: DemoKind = 'pq'
  const commands: string[] = []
  const transacts: unknown[] = []
  const app = {
    workspace,
    get demo() {
      return demo
    },
    mode: 'fiber',
    sceneProblem: null,
    scene: null,
    playback: { active: false, playing: false, step: null, phase: 'idle', time: 0, duration: 0 },
    snapshot: () => ({ dragging: null }),
    currentDescription: () => null,
    applyPresentation: vi.fn(),
    transact(actions: unknown, _source: string) {
      transacts.push(actions)
      const { plan } = workspace.commit({ baseRevision: workspace.current.revision, actions })
      return { summary: plan.summary, effects: plan.effects }
    },
    command: (c: string) => commands.push(c),
    showDemo: vi.fn((kind: DemoKind) => {
      demo = kind
      return { summary: [] }
    }),
  }
  const frames: (() => void)[] = []
  const host = { presenting: false, sessionMode: null, onSession: () => () => {}, onFrame: (fn: () => void) => (frames.push(fn), () => {}), passthroughSupported: async () => false }
  const assistant = {
    state: opts.pending ? { kind: 'pending', prompt: 'hello' } : { kind: 'idle' },
    busy: !!opts.pending,
    subscribe: () => () => {},
    cancel: vi.fn(),
    ask: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
  }
  const voice = {
    state: { kind: opts.voiceBusy ? 'recording' : 'idle' },
    busy: !!opts.voiceBusy,
    acquiring: false,
    subscribe: () => () => {},
    cancel: vi.fn(),
    toggle: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    edit: vi.fn(),
    submit: vi.fn(),
    requestMicrophone: vi.fn(async () => true),
  }
  const evidence = { entries: [], subscribe: () => () => {}, check: vi.fn(async () => {}) }
  const deps = {
    app, host, assistant, voice, evidence,
    workspace: { save: async () => 'saved', reopen: async () => 'reopened', exportJson: () => 'exported', importJson: () => {} },
    capabilities: () => null,
  } as unknown as ControllerDeps
  const ui = new UiController(deps)
  const presenters = Object.fromEntries((['pq', 'order', 'sculpture', 'cube', 'quotient', 'braid'] as const).map((k) => [k, testPresenter])) as Record<DemoKind, Presenter>
  ui.setPresenters(presenters)
  const frame = () => frames.forEach((f) => f())
  return { ui, app, workspace, assistant, voice, evidence, commands, transacts, frame }
}

describe('UI controller', () => {
  it('names the assistant "Ask Meta Muse AI" in the toolbar', () => {
    const { ui } = setup()
    expect(ui.view.toolbar.find((t) => t.id === 'assistant')!.label).toBe(ASSISTANT_NAME)
    expect(ASSISTANT_NAME).toBe('Ask Meta Muse AI')
  })

  it('UI-only commands never change the document, its revision or the Undo stack', () => {
    const { ui, workspace } = setup()
    const doc = workspace.current
    const undo = workspace.canUndo
    ui.dispatch({ kind: 'popover', which: 'experiments' })
    ui.dispatch({ kind: 'popover', which: 'more' })
    ui.dispatch({ kind: 'popover', which: null })
    ui.dispatch({ kind: 'inspector', which: 'math' })
    ui.dispatch({ kind: 'inspector', which: 'assistant' })
    ui.dispatch({ kind: 'inspector', which: null })
    ui.dispatch({ kind: 'assistant', action: { kind: 'draft', text: 'Use the same experiment on V4' } })
    expect(workspace.current).toBe(doc)
    expect(workspace.current.revision).toBe(doc.revision)
    expect(workspace.canUndo).toBe(undo)
    expect(ui.store.state.draft).toBe('Use the same experiment on V4')
  })

  it('opening the mathematics inspector is presentation only (detailsOpen), not a commit', () => {
    const { ui, app, workspace } = setup()
    const rev = workspace.current.revision
    ui.dispatch({ kind: 'inspector', which: 'math' })
    expect(ui.view.inspector).toBe('math')
    expect(ui.view.presentation.scene.detailsOpen).toBe(true)
    expect(app.applyPresentation).toHaveBeenLastCalledWith({ inSceneControls: false, detailsOpen: true })
    expect(workspace.current.revision).toBe(rev)
  })

  it('activates an enabled context item by ID through a validated transaction', () => {
    const { ui, workspace, transacts } = setup()
    const rev = workspace.current.revision
    ui.dispatch({ kind: 'context', id: 'select-v' })
    expect(transacts).toEqual([SELECT_V])
    expect(workspace.current.revision).toBe(rev + 1)
    expect(workspace.current.selection.sampleId).toBe(V)
  })

  it('refuses a disabled item, an unknown ID and a disabled reset (nothing runs, nothing changes)', () => {
    const { ui, workspace, transacts } = setup()
    const doc = workspace.current
    ui.dispatch({ kind: 'context', id: 'off' })
    ui.dispatch({ kind: 'context', id: 'no-such-item' })
    ui.dispatch({ kind: 'more', id: 'reset:reset' })
    expect(transacts).toEqual([])
    expect(workspace.current).toBe(doc)
  })

  it('reports a refused transaction in the status line and leaves the document unchanged', () => {
    const { ui, workspace } = setup()
    const doc = workspace.current
    ui.dispatch({ kind: 'context', id: 'bad' })
    expect(workspace.current).toBe(doc)
    expect(ui.view.presentation.status.tone).toBe('error')
    expect(ui.view.presentation.status.text).toMatch(/^Not applied: /)
    // The next successful commit clears it.
    ui.dispatch({ kind: 'context', id: 'select-v' })
    expect(ui.view.presentation.status.tone).toBe('normal')
  })

  it('detail actions are looked up by ID like context items', () => {
    const { ui, workspace } = setup()
    ui.dispatch({ kind: 'context', id: 'detail-select' })
    expect(workspace.current.selection.sampleId).toBe(V)
  })

  it('toolbar commands follow the toolbar: Play off is refused, Replay and Undo run', () => {
    const { ui, commands, workspace } = setup()
    expect(ui.view.toolbar.find((t) => t.id === 'play')).toMatchObject({ enabled: false, reason: 'Nothing to play' })
    ui.dispatch({ kind: 'playPause' })
    expect(commands).toEqual([])
    ui.dispatch({ kind: 'replay' })
    expect(commands).toEqual(['replay'])
    // Undo is off until there is something to undo.
    expect(ui.view.toolbar.find((t) => t.id === 'undo')!.enabled).toBe(false)
    ui.dispatch({ kind: 'undo' })
    expect(commands).toEqual(['replay'])
    ui.dispatch({ kind: 'context', id: 'select-v' })
    expect(workspace.canUndo).toBe(true)
    ui.dispatch({ kind: 'undo' })
    expect(commands).toEqual(['replay', 'undo'])
  })

  it('a playback context item drives the scene playback, not the document', () => {
    const { ui, commands, workspace } = setup()
    const doc = workspace.current
    ui.dispatch({ kind: 'context', id: 'replay-scene' })
    expect(commands).toEqual(['replay'])
    expect(workspace.current).toBe(doc)
  })

  it('closing the assistant panel cancels a pending request and voice capture', () => {
    const { ui, assistant, voice } = setup({ pending: true, voiceBusy: true })
    expect(ui.view.inspector).toBe('assistant')
    ui.dispatch({ kind: 'inspector', which: 'assistant' }) // toggle closed
    expect(ui.view.inspector).toBe(null)
    expect(assistant.cancel).toHaveBeenCalledWith('panel-closed')
    expect(voice.cancel).toHaveBeenCalledTimes(1)
    expect(ui.store.state.assistantDismissed).toBe(true)
  })

  it('switching to the mathematics inspector cancels assistant work', () => {
    const { ui, assistant } = setup({ pending: true })
    ui.dispatch({ kind: 'inspector', which: 'math' })
    expect(assistant.cancel).toHaveBeenCalledWith('switched-to-details')
  })

  it('choosing another experiment cancels assistant work and goes through showDemo', () => {
    const { ui, app, assistant, voice } = setup({ pending: true, voiceBusy: true })
    ui.dispatch({ kind: 'experiment', demo: 'sculpture' })
    expect(assistant.cancel).toHaveBeenCalledWith('experiment-change')
    expect(voice.cancel).toHaveBeenCalled()
    expect(app.showDemo).toHaveBeenCalledWith('sculpture', 'picker')
    // Choosing the experiment already shown does nothing.
    ui.dispatch({ kind: 'experiment', demo: 'sculpture' })
    expect(app.showDemo).toHaveBeenCalledTimes(1)
  })

  it('does not cancel anything when the panel was not doing anything', () => {
    const { ui, assistant, voice } = setup()
    ui.dispatch({ kind: 'inspector', which: null })
    ui.dispatch({ kind: 'experiment', demo: 'braid' })
    expect(assistant.cancel).not.toHaveBeenCalled()
    expect(voice.cancel).not.toHaveBeenCalled()
  })

  it('an empty question is not sent; a sent draft is cleared', () => {
    const { ui, assistant } = setup()
    ui.dispatch({ kind: 'assistant', action: { kind: 'ask', text: '   ' } })
    expect(assistant.ask).not.toHaveBeenCalled()
    ui.dispatch({ kind: 'assistant', action: { kind: 'draft', text: 'Use this on Q' } })
    ui.dispatch({ kind: 'assistant', action: { kind: 'ask', text: 'Use this on Q' } })
    expect(assistant.ask).toHaveBeenCalledWith('Use this on Q')
    expect(ui.store.state.draft).toBe('')
  })

  it('renderers are notified once per change, even when the view was read between frames', () => {
    const { ui, frame } = setup()
    const seen: (string | null)[] = []
    ui.subscribe((v) => seen.push(v.popover))
    frame()
    expect(seen).toEqual([null])
    ui.dispatch({ kind: 'popover', which: 'experiments' })
    expect(ui.view.popover).toBe('experiments') // a read between frames (e.g. a command handler)
    frame()
    frame()
    expect(seen).toEqual([null, 'experiments'])
  })

  it('the view key changes with UI state but the document is the same object', () => {
    const { ui, workspace } = setup()
    const k0 = ui.view.key
    const doc = workspace.current
    ui.dispatch({ kind: 'popover', which: 'more' })
    expect(ui.view.key).not.toBe(k0)
    expect(ui.view.popover).toBe('more')
    expect(workspace.current).toBe(doc)
  })
})
