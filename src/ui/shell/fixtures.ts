// FIXTURE UiViews for the shell harness (ui-harness.html) and its captures. Hand-written to exercise the shell's
// layouts: they are NOT derived from the application and never stand in for app evidence. Copy follows the spec
// (section 2 reference state, section 5 picker copy); availability, values and evidence are illustrative.

import { ASSISTANT_NAME, EXPERIMENTS, withTitle, type AssistantPanelInput, type Availability, type ContextGroup, type ContextItem, type DetailSection, type DomainPresentation, type EvidenceItem, type MoreView, type StatusView, type ToolbarItem, type UiView } from '../model'
import type { DemoKind } from '../../demo/order'
import { demoDocument, type Doc } from '../../workspace/document'

const L = (plain: string, tex?: string) => (tex ? { plain, tex } : { plain })
const none = { kind: 'none' } as const
const on: Availability = { enabled: true }
const off = (reason: string): Availability => ({ enabled: false, reason })

let doc: Doc | null = null
function fixtureDoc(): Doc {
  if (!doc) doc = demoDocument('ws-fixture')
  return doc
}

interface Ui {
  inspector: UiView['inspector']
  popover: UiView['popover']
  surface?: 'desktop' | 'xr'
  playing?: boolean
  dragging?: boolean
  undo?: boolean
  notice?: MoreView['notice']
  representation?: boolean
}

function toolbar(p: DomainPresentation, ui: Ui): ToolbarItem[] {
  const playing = !!ui.playing
  const dragging = !!ui.dragging
  const canUndo = dragging || !!ui.undo
  return [
    { id: 'experiments', label: 'Experiments', ariaLabel: 'Experiments: choose an experiment', enabled: true, active: ui.popover === 'experiments' },
    { id: 'assistant', label: ASSISTANT_NAME, ariaLabel: ASSISTANT_NAME, enabled: true, active: ui.inspector === 'assistant' },
    { id: 'play', label: playing ? 'Pause' : 'Play', ariaLabel: playing ? 'Pause the animation' : 'Play the animation', enabled: playing || p.playback.play.enabled, reason: playing ? undefined : p.playback.play.reason, active: playing },
    { id: 'replay', label: 'Replay', ariaLabel: 'Replay the construction', enabled: p.playback.replay.enabled, reason: p.playback.replay.reason, active: false },
    { id: 'undo', label: dragging ? 'Cancel drag' : 'Undo', ariaLabel: dragging ? 'Cancel drag' : 'Undo last workspace change', enabled: canUndo, reason: canUndo ? undefined : 'Nothing to undo yet', active: false },
    { id: 'more', label: 'More', ariaLabel: 'More: workspace, representation, experiment and session', enabled: true, active: ui.popover === 'more' },
  ]
}

function more(p: DomainPresentation, ui: Ui): MoreView {
  const desktop = (ui.surface ?? 'desktop') === 'desktop'
  const representation = ui.representation
    ? { recipeName: 'What gets lost', operations: [
        { kind: 'linked_views', label: 'linked views', on: true },
        { kind: 'exact_groups', label: 'exact output groups', on: true },
        { kind: 'highlight_selection', label: 'highlight selection', on: true },
        { kind: 'fiber_segment', label: 'selected fiber segment', on: true },
        { kind: 'equation_caption', label: 'equation caption', on: false },
      ] }
    : null
  return {
    sections: [
      { id: 'workspace', title: 'Workspace', items: [
        { id: 'save', label: 'Save workspace', enabled: true },
        { id: 'reopen', label: 'Reopen saved workspace', enabled: true },
        ...(desktop ? [{ id: 'export' as const, label: 'Export workspace JSON', enabled: true }, { id: 'import' as const, label: 'Import workspace JSON', enabled: true }] : []),
      ] },
      { id: 'representation', title: 'Representation', items: [
        { id: 'saveRepresentation', label: 'Save representation…', helper: 'Save the bound recipe with the operations you choose; "Use on Q" and "Use on V₄" reuse a saved representation', enabled: desktop && !!representation, reason: !desktop ? 'Available on the desktop' : representation ? undefined : 'Available for the P → Q representation' },
      ] },
      { id: 'experiment', title: 'This experiment', items: p.resets.map((r) => ({ id: `reset:${r.id}` as const, label: r.label, helper: r.helper, enabled: r.enabled, reason: r.reason })) },
      { id: 'session', title: 'Session', items: desktop
        ? [
            { id: 'enterVR', label: 'Enter VR', enabled: true },
            { id: 'enterPassthrough', label: 'Enter passthrough', helper: 'Your room behind the workbench', enabled: false, reason: 'Passthrough is not available in this browser' },
            { id: 'enableVoice', label: 'Enable voice', helper: 'Ask for the microphone now; nothing is recorded or sent', enabled: true },
          ]
        : [{ id: 'exitSession', label: 'Exit VR', enabled: true }] },
    ],
    representation,
    notice: ui.notice ?? null,
  }
}

function assistant(kind: DemoKind, p: DomainPresentation, ui: Ui): AssistantPanelInput {
  return {
    open: ui.inspector === 'assistant',
    surface: ui.surface ?? 'desktop',
    assistant: { kind: 'idle' },
    voice: { kind: 'idle' },
    voiceAcquiring: false,
    capability: {
      assistant: { configured: false, authenticated: false, liveValidated: false, model: null, mode: 'synthetic' },
      speech: { configured: false, liveValidated: false, mode: 'unavailable', provider: null, model: null, acceptedMimeTypes: [], problem: 'No speech provider configured (fixture)' },
    },
    draft: '',
    doc: fixtureDoc(),
    demo: kind,
    experimentId: `exp-fixture-${kind}`,
    presentation: p,
  }
}

function view(kind: DemoKind, p: DomainPresentation, ui: Ui): UiView {
  const copy = EXPERIMENTS.find((e) => e.kind === kind)!
  const v: UiView = {
    surface: ui.surface ?? 'desktop',
    sessionMode: ui.surface === 'xr' ? 'vr' : null,
    experiment: { kind, question: copy.question, subtitle: withTitle(copy.title, p.subtitle) },
    experiments: EXPERIMENTS.map((e) => ({ kind: e.kind, question: e.question, field: e.field, title: e.title, topic: e.topic, selected: e.kind === kind })),
    toolbar: toolbar(p, ui),
    popover: ui.popover,
    more: more(p, ui),
    presentation: { ...p, scene: { inSceneControls: false, detailsOpen: ui.inspector === 'math' } },
    inspector: ui.inspector,
    assistant: assistant(kind, p, ui),
    key: '',
  }
  v.key = JSON.stringify({ ...v, assistant: { ...v.assistant, doc: 0, presentation: 0 } })
  return v
}

const status = (text: string, phase: StatusView['phase'] = 'ready', tone: StatusView['tone'] = 'normal'): StatusView => ({ phase, text, tone })
const choice = (id: string, label: string, selected = false, tex?: string): ContextItem => ({ id, label: L(label, tex), role: 'choice', selected, enabled: true, run: none })

// ------------------------------------------------------------------ the six experiments

function sculpture(o: { selected?: string; moves?: number; v4?: boolean } = {}): DomainPresentation {
  const sel = o.selected ?? 'c1'
  const v4 = !!o.v4
  const ops = v4
    ? [choice('op:v00', '(0,0)', sel === 'v00'), choice('op:v10', '(1,0)', sel === 'v10'), choice('op:v01', '(0,1)', sel === 'v01'), choice('op:v11', '(1,1)', sel === 'v11')]
    : [0, 1, 2, 3].map((k) => choice(`op:c${k}`, String(k), sel === `c${k}`))
  const selLabel = ops.find((x) => x.selected)?.label.plain ?? '1'
  const moves = o.moves ?? 0
  const groups: ContextGroup[] = [
    { id: 'ops', layout: 'choices', items: ops },
    { id: 'apply', layout: 'actions', items: [
      { id: 'apply', label: L(v4 ? `Apply ${selLabel}` : `Apply +${selLabel}`), role: 'primary', enabled: true, run: none },
      { id: 'rebind', label: L(v4 ? 'Use on C₄' : 'Use on V₄'), role: 'secondary', enabled: true, hint: 'Reuse this representation on the other group (recipe reuse)', run: none },
    ] },
  ]
  const orders: DetailSection = {
    title: 'Element orders', provenance: 'computed exactly',
    items: [{ kind: 'pairs', rows: v4
      ? [{ key: L('(0,0)'), value: L('order 1') }, { key: L('(1,0)'), value: L('order 2') }, { key: L('(0,1)'), value: L('order 2') }, { key: L('(1,1)'), value: L('order 2') }]
      : [{ key: L('0'), value: L('order 1') }, { key: L('1'), value: L('order 4') }, { key: L('2'), value: L('order 2') }, { key: L('3'), value: L('order 4') }] }],
  }
  return {
    subtitle: L(v4 ? 'Cycle experiment · V₄' : 'Cycle experiment · C₄', v4 ? '\\text{Cycle experiment} \\cdot V_4' : '\\text{Cycle experiment} \\cdot C_4'),
    context: { title: 'Choose an operation', groups, hint: null },
    status: status(moves === 0 ? 'Ready · 0 moves · Starting arrangement' : `Ready · ${moves} moves · accumulated ${moves % 4}`),
    playback: { play: moves ? on : off('Nothing to play yet'), replay: moves ? on : off('Nothing applied yet') },
    resets: [{ id: 'group', label: 'Reset experiment', helper: 'Clear this experiment’s operation history (undoable)', enabled: moves > 0, reason: moves > 0 ? undefined : 'Already at the starting arrangement', run: none }],
    detail: { sections: [
      orders,
      { title: 'Cycle decompositions', provenance: 'computed exactly', items: [{ kind: 'list', items: [L('0: (0)(1)(2)(3)'), L('1: (0 1 2 3)'), L('2: (0 2)(1 3)'), L('3: (0 3 2 1)')] }] },
      { title: 'Accumulated element', provenance: 'computed exactly', items: [{ kind: 'formula', formula: L(`k = ${moves % 4}`, `k = ${moves % 4}`) }, { kind: 'text', text: moves ? `${moves} committed moves of +1. A move count is not an element order when operations are mixed.` : 'No operations applied yet: every bead is home.' }] },
      { title: 'Identity and slots', provenance: 'presentation', items: [{ kind: 'text', text: 'Bead x is the element x; after the accumulated element k it sits in slot k + x (mod 4). Path curvature and distance are presentation choices.' }] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

function cube(): DomainPresentation {
  return {
    subtitle: L('Cube rotations · Four diagonals'),
    context: {
      title: 'Choose a rotation',
      groups: [
        { id: 'rot', label: 'Rotate', layout: 'actions', items: [
          { id: 'rot:rx', label: L('90° about x'), role: 'secondary', enabled: true, run: none },
          { id: 'rot:ry', label: L('90° about y'), role: 'secondary', enabled: true, run: none },
          { id: 'rot:rz', label: L('90° about z'), role: 'secondary', enabled: true, run: none },
        ] },
        { id: 'diag', label: 'Diagonals', layout: 'choices', items: [choice('line:0', '0', true), choice('line:1', '1'), choice('line:2', '2'), choice('line:3', '3')] },
        { id: 'swap', layout: 'actions', items: [
          { id: 'swap', label: L('Swap 0 with …'), role: 'primary', enabled: false, reason: 'Choose another diagonal first', run: none },
          { id: 'return', label: L('Return by inverse'), role: 'secondary', enabled: true, hint: 'Apply the rotation that undoes k (a new step, not Undo)', run: none },
        ] },
      ],
      hint: 'Choose another diagonal to swap with 0',
    },
    status: status('Ready · 1 rotation · diagonal 0 selected'),
    playback: { play: on, replay: on },
    resets: [{ id: 'cube', label: 'Reset experiment', helper: 'Clear the cube’s rotation history (undoable)', enabled: true, run: none }],
    detail: { sections: [
      { title: 'Current orientation', provenance: 'computed exactly', items: [
        { kind: 'matrix', label: L('k'), rows: [['0', '-1', '0'], ['1', '0', '0'], ['0', '0', '1']] },
        { kind: 'pairs', rows: [{ key: L('Diagonal permutation'), value: L('(0 1 2 3)') }, { key: L('Rotation'), value: L('R_z, 90° about +z') }] },
      ] },
      { title: '24 rotations ↔ 24 permutations', provenance: 'computed exactly', items: [{ kind: 'text', text: 'Each proper rotation of the cube permutes the four unoriented body-diagonal lines, and every permutation of them arises from exactly one rotation.' }] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

function braid(): DomainPresentation {
  return {
    subtitle: L('Three-strand braids · σ₁σ₂σ₁ beside σ₂σ₁σ₂', '\\text{Three-strand braids} \\cdot \\sigma_1\\sigma_2\\sigma_1'),
    context: {
      title: 'Rewrite at a crossing',
      groups: [
        { id: 'crossings', label: 'Crossings', layout: 'choices', items: [choice('crossing:0', '1', true), choice('crossing:1', '2'), choice('crossing:2', '3')] },
        { id: 'rewrite', layout: 'actions', items: [
          { id: 'rewrite:relation:0', label: L('Apply braid relation'), role: 'primary', enabled: true, ariaLabel: 'Apply braid relation at crossings 1–3', run: none },
          { id: 'rewrite:cancel', label: L('Cancel inverse pair'), role: 'secondary', enabled: false, reason: 'Crossings 1 and 2 are not an inverse pair', run: none },
        ] },
        { id: 'tools', layout: 'actions', items: [
          { id: 'invert', label: L('Invert braid'), role: 'secondary', enabled: true, run: none },
          { id: 'example', label: L('Next example'), role: 'secondary', enabled: true, run: none },
        ] },
      ],
      hint: 'Crossings 1–3 are highlighted: σ₁σ₂σ₁ → σ₂σ₁σ₂',
    },
    status: status('Same endpoints; equivalence not established', 'ready', 'warning'),
    playback: { play: on, replay: on },
    resets: [
      { id: 'clear', label: 'Clear braid', helper: 'Set the main word to the identity (undoable)', enabled: true, run: none },
      { id: 'restore', label: 'Restore example', helper: 'Restore this example’s preset words (undoable)', enabled: true, run: none },
    ],
    detail: { sections: [
      { title: 'Braid words', provenance: 'computed exactly', items: [
        { kind: 'formula', formula: L('main: σ₁σ₂σ₁', '\\text{main: } \\sigma_1 \\sigma_2 \\sigma_1') },
        { kind: 'formula', formula: L('comparison: σ₂σ₁σ₂', '\\text{comparison: } \\sigma_2 \\sigma_1 \\sigma_2') },
      ] },
      { title: 'Invariants', provenance: 'computed exactly', items: [{ kind: 'pairs', rows: [{ key: L('Endpoint permutation'), value: L('(1 3) for both') }, { key: L('Exponent sum'), value: L('3 for both') }] }, { kind: 'text', text: 'Equal invariants do not establish braid equality.' }] },
      { title: 'Rewrite evidence', provenance: 'checked by supported rewrite rules', items: [{ kind: 'text', text: 'No rewrite recorded yet. The braid relation at crossings 1–3 is available.' }] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

const EVIDENCE: EvidenceItem[] = [
  { id: 3, label: 'The selected pair has the same image under P', status: 'checked', current: true, statement: 'P (1, 0, 1) = P (1, 0, -1) = (1, 0, 0)', provenance: 'Lean receipt · claim same_image · template v3 (fixture)', message: null },
  { id: 2, label: 'P and Q differ on e₁', status: 'checked', current: false, statement: 'P e₁ = (1, 0, 0) ≠ (0, 0, 0) = Q e₁', provenance: 'Lean receipt · claim maps_differ (fixture)', message: null },
  { id: 4, label: 'Are P and Q equal?', status: 'not_sent', current: true, statement: null, provenance: null, message: 'Not checked yet' },
]

function pq(o: { dragging?: boolean } = {}): DomainPresentation {
  return {
    subtitle: L('Linear maps · P', '\\text{Linear maps} \\cdot P'),
    context: {
      title: 'Explore the selected point',
      groups: [
        { id: 'mode', label: 'Drag', layout: 'actions', items: [
          { id: 'mode:fiber', label: L('Along its fiber'), role: 'toggle', selected: true, enabled: true, run: { kind: 'dragMode' } },
          { id: 'mode:free', label: L('Free'), role: 'toggle', selected: false, enabled: true, run: { kind: 'dragMode' } },
        ] },
        { id: 'use', layout: 'actions', items: [
          { id: 'rebind', label: L('Use on Q'), role: 'primary', enabled: true, hint: 'Reuse this representation on Q (recipe reuse)', run: none },
        ] },
      ],
      hint: o.dragging ? 'Dragging u along its fiber: the input changes, Pu stays' : null,
    },
    status: o.dragging ? status('Dragging u · Pu = (1, 0, 0) stays', 'animating') : status('Ready · u = (1, 0, 1) · Pu = (1, 0, 0)'),
    playback: { play: on, replay: on },
    resets: [{ id: 'pq', label: 'Reset experiment', helper: 'Restore the prepared samples and selection (undoable)', enabled: true, run: none }],
    detail: { sections: [
      { title: 'Selected point', provenance: 'computed exactly', items: [{ kind: 'pairs', rows: [{ key: L('u'), value: L('(1, 0, 1)') }, { key: L('Pu'), value: L('(1, 0, 0)') }, { key: L('Same image'), value: L('v = (1, 0, −1), w = (1, 0, 0)') }] }] },
      { title: 'The map', provenance: 'computed exactly', items: [
        { kind: 'formula', formula: L('P(x, y, z) = (x, y, 0)', 'P(x,y,z) = (x,\\,y,\\,0)') },
        { kind: 'matrix', label: L('P'), rows: [['1', '0', '0'], ['0', '1', '0'], ['0', '0', '0']] },
        { kind: 'text', text: 'The kernel of P is the z-axis. The rose segment is a finite part of the fiber through u, not the whole infinite fiber.' },
      ] },
      { title: 'Claim checks', provenance: 'Lean receipt', items: [
        { kind: 'evidence', items: EVIDENCE },
        { kind: 'action', id: 'check:equal', label: L('Check: are P and Q equal?'), enabled: true, run: none },
      ] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

function order(): DomainPresentation {
  return {
    subtitle: L('Rotations and reflections · R then S beside S then R'),
    context: {
      title: null,
      groups: [{ id: 'routes', layout: 'actions', items: [
        { id: 'reverse:left', label: L('Reverse left order'), role: 'primary', enabled: true, run: none },
        { id: 'reverse:right', label: L('Reverse right order'), role: 'secondary', enabled: true, run: none },
        { id: 'replay', label: L('Replay comparison'), role: 'secondary', enabled: true, run: { kind: 'playback', command: 'replay' } },
      ] }],
      hint: 'R then S gives SR; S then R gives RS',
    },
    status: status('Results differ: e₁ goes to (0, −1) on the left and (0, 1) on the right', 'result'),
    playback: { play: on, replay: on },
    resets: [{ id: 'order', label: 'Reset experiment', helper: 'Restore both routes to their prepared order (undoable)', enabled: true, run: none }],
    detail: { sections: [
      { title: 'Routes and matrices', provenance: 'computed exactly', items: [
        { kind: 'matrix', label: L('R'), rows: [['0', '-1'], ['1', '0']] },
        { kind: 'matrix', label: L('S'), rows: [['1', '0'], ['0', '-1']] },
        { kind: 'formula', formula: L('Applying R, then S to column vectors gives SR', '\\text{R, then S} \\;\\Rightarrow\\; SR') },
      ] },
      { title: 'Differing-point witness', provenance: 'computed exactly', items: [{ kind: 'pairs', rows: [{ key: L('SR e₁'), value: L('(0, −1)') }, { key: L('RS e₁'), value: L('(0, 1)') }] }] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

function quotient(): DomainPresentation {
  return {
    subtitle: L('Quotients · Ignoring axis direction'),
    context: {
      title: 'Group and compose classes',
      groups: [
        { id: 'view', label: 'View', layout: 'actions', items: [
          { id: 'view:grouped', label: L('Group into classes'), role: 'toggle', selected: true, enabled: true, run: none },
          { id: 'view:all', label: L('Show all 24'), role: 'toggle', selected: false, enabled: true, run: none },
        ] },
        { id: 'operands', label: 'Operands', layout: 'actions', items: [
          { id: 'chooseA', label: L('Choose as A'), role: 'primary', enabled: true, run: none },
          { id: 'chooseB', label: L('Choose as B'), role: 'secondary', enabled: true, run: none },
        ] },
      ],
      hint: 'R_z is selected: choose it as A or B',
    },
    status: status('Ready · 6 classes of 4 · A and B not chosen'),
    playback: { play: on, replay: off('Nothing to replay in this view') },
    resets: [{ id: 'quotient', label: 'Reset experiment', helper: 'Clear the operands and show all 24 rotations (undoable)', enabled: true, run: none }],
    detail: { sections: [
      { title: 'Classes', provenance: 'computed exactly', items: [{ kind: 'text', text: '24 proper rotations, grouped by their action on the three unoriented coordinate-axis lines: six classes of four rotations each.' }, { kind: 'pairs', rows: [{ key: L('Kernel'), value: L('{I, R_x², R_y², R_z²}') }, { key: L('Class of R_z'), value: L('swaps the x and y lines') }] }] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

function proof(): DomainPresentation {
  const stage = (id: string, label: string, selected = false) => ({ id: `stage:${id}`, label: L(label), role: 'choice' as const, selected, enabled: true, run: none })
  return {
    subtitle: L('Inside a published proof · Steinitz–Bergström'),
    context: {
      title: 'Closed 3D walk · Why',
      groups: [
        { id: 'steps', label: 'Step', layout: 'choices', items: [stage('walk', 'Walk'), stage('signs', 'Signs'), stage('reorder', 'Reorder'), stage('why', 'Why', true), stage('assumptions', 'Assumptions')] },
        { id: 'stage-actions', layout: 'actions', items: [
          { id: 'prev', label: L('◀ Previous point'), role: 'secondary', enabled: true, run: none },
          { id: 'next-point', label: L('Next point ▶'), role: 'secondary', enabled: true, run: none },
          { id: 'negative', label: L('− part · W₉'), role: 'secondary', enabled: true, run: none },
          { id: 'check', label: L('Check in Lean'), role: 'secondary', enabled: true, run: none },
        ] },
      ],
      hint: 'W₃ = (U₅ + S₅)/2. The first 3 arrows of the new order are exactly the + arrows among the first 5 original steps.',
    },
    status: { phase: 'result', text: 'W₃ = (U₅ + S₅)/2 · |W₃| ≤ (5 + 1)/2 = 3 · positive part', tone: 'normal' },
    playback: { play: on, replay: on },
    resets: [{ id: 'restore', label: 'Restore example', helper: 'Show the closed 3D walk with its prepared signs (undoable)', enabled: false, reason: 'The example is shown unchanged', run: none }],
    detail: { sections: [
      { title: 'What this lesson covers', provenance: 'published source', items: [{ kind: 'formula', formula: L('Signing bound: outside this lesson → Reordering step: interactive → Ordering result') }] },
      { title: 'This walk', provenance: 'computed exactly', items: [{ kind: 'pairs', rows: [{ key: L('Source bound B'), value: L('5 · actual peak ≈ 4.850') }, { key: L('New bound (B + D)/2'), value: L('3 · actual peak ≈ 2.425') }] }] },
    ] },
    scene: { inSceneControls: false, detailsOpen: false },
  }
}

const PRESENT: Record<DemoKind, () => DomainPresentation> = { pq, order, sculpture: () => sculpture(), cube, quotient, braid, proof }

// ------------------------------------------------------------------ named fixtures

export interface ShellFixture {
  label: string
  kind: DemoKind
  view: (surface: 'desktop' | 'xr') => UiView
}

const f = (label: string, kind: DemoKind, p: () => DomainPresentation, ui: Ui): ShellFixture => ({ label, kind, view: (surface) => view(kind, p(), { ...ui, surface }) })

export const FIXTURES: Record<string, ShellFixture> = {
  sculpture: f('C₄ reference state, first visit (assistant open)', 'sculpture', () => sculpture(), { inspector: 'assistant', popover: null }),
  'sculpture-closed': f('C₄ reference state, assistant closed', 'sculpture', () => sculpture(), { inspector: null, popover: null }),
  'sculpture-math': f('C₄ after two moves, mathematics open', 'sculpture', () => sculpture({ moves: 2 }), { inspector: 'math', popover: null, undo: true }),
  'sculpture-playing': f('C₄ while animating (Pause)', 'sculpture', () => ({ ...sculpture({ moves: 1 }), status: status('Animating · applying +1 · move 1', 'animating') }), { inspector: null, popover: null, playing: true, undo: true }),
  cube: f('Cube: diagonal 0 chosen, choose another', 'cube', cube, { inspector: null, popover: null, undo: true }),
  braid: f('Braid: relation rewrite available', 'braid', braid, { inspector: null, popover: null, undo: true }),
  'braid-math': f('Braid: mathematics open', 'braid', braid, { inspector: 'math', popover: null, undo: true }),
  pq: f('P/Q: Lean evidence in mathematics', 'pq', () => pq(), { inspector: 'math', popover: null, undo: true }),
  'pq-drag': f('P/Q during a drag (Cancel drag)', 'pq', () => pq({ dragging: true }), { inspector: null, popover: null, dragging: true }),
  order: f('Order comparison: results differ', 'order', order, { inspector: null, popover: null, undo: true }),
  quotient: f('Quotient: classes, choose A/B', 'quotient', quotient, { inspector: null, popover: null }),
  picker: f('Experiments picker open', 'sculpture', () => sculpture(), { inspector: 'assistant', popover: 'experiments' }),
  more: f('More open, representation editor, notice', 'pq', () => pq(), { inspector: null, popover: 'more', representation: true, undo: true, notice: { text: 'Saved 14:02 (fixture)', tone: 'normal' } }),
  'more-xr': f('More open (XR entries)', 'sculpture', () => sculpture({ moves: 2 }), { inspector: null, popover: 'more', undo: true }),
  'import-error': f('Import refused (error notice, More closed)', 'sculpture', () => sculpture(), { inspector: null, popover: null, notice: { text: 'Import refused: schemaVersion 3 is newer than this app (fixture)', tone: 'error' } }),
  narrow: f('Narrow window (capture at < 900 px)', 'sculpture', () => sculpture(), { inspector: 'assistant', popover: null }),
}

/** The fixture shown when the harness switches experiments (keeps the open inspector/popover state). */
export function fixtureFor(kind: DemoKind, base: UiView): UiView {
  const p = PRESENT[kind]()
  return view(kind, p, { inspector: base.inspector, popover: null, surface: base.surface })
}

/** Apply a UI-only command to a fixture view (the harness's stand-in for the coordinator's controller). */
export function withUi(v: UiView, patch: { inspector?: UiView['inspector']; popover?: UiView['popover'] }): UiView {
  const ui: Ui = {
    inspector: patch.inspector !== undefined ? patch.inspector : v.inspector,
    popover: patch.popover !== undefined ? patch.popover : v.popover,
    surface: v.surface,
    playing: v.toolbar.find((t) => t.id === 'play')?.label === 'Pause',
    dragging: v.toolbar.find((t) => t.id === 'undo')?.label === 'Cancel drag',
    undo: v.toolbar.find((t) => t.id === 'undo')?.enabled,
    notice: v.more.notice,
    representation: !!v.more.representation,
  }
  return view(v.experiment.kind, v.presentation, ui)
}
