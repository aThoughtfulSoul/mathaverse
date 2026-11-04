// The shared presentation model of the refined workspace UI (workspace-spec/UI-REFINEMENT-SPEC.md, section 9).
// One derived view (UiView) and one command vocabulary (UiCommand) are consumed by two renderers: the desktop
// DOM shell and the spatial (WebXR / passthrough) shell. Domain presenters turn the current document and scene
// description into the experiment's question, context actions, status and mathematical detail. Transient UI
// state (open inspector, popover, drafts) lives in the UiStore and never in the mathematical document, its
// revision, its recipes or its Undo stack. Mathematical edits still go through the validated action planner.
//
// Types and constants only; no rendering, no DOM.

import type { Object3D, Ray } from 'three'
import type { DemoKind } from '../demo/order'
import type { Doc } from '../workspace/document'
import type { ClaimRequest } from '../workspace/claims'
import type { ViewDescription } from '../rendering/viewDescription'
import type { PlaybackState } from '../rendering/adapter'
import type { SceneLayout, WalkStage } from '../domains/inputs'
import type { AssistantState } from '../assistant/client'
import type { VoiceState } from '../voice/client'
import type { EvidenceStatus } from '../evidence/client'
import type { AssistantCapability, SpeechCapability } from '../../server/types'
import type { FrameContext } from '../runtime/host'

/** Text in two forms: `plain` for the DOM and plain spatial text; `tex` (optional) for the mathematical text path. */
export interface Label {
  plain: string
  tex?: string
}

/** The exact assistant name (spec section 1): toolbar entry, panel title and their accessible names. */
export const ASSISTANT_NAME = 'Ask Meta Muse AI'

// ------------------------------------------------------------------ experiments (picker copy, spec section 5)

export interface ExperimentCopy {
  kind: DemoKind
  /** The scene's title: the question the experiment explores. */
  question: string
  /** The field it belongs to: the picker groups consecutive experiments under it ("Group theory"). */
  field: string
  /** The short title on the picker card and under the scene's question ("Cube rotations"). */
  title: string
  /** The detail line under the short title on the picker card ("Four diagonals"). */
  topic: string
}

export const EXPERIMENTS: readonly ExperimentCopy[] = [
  { kind: 'pq', question: 'What gets lost when we flatten space?', field: 'Linear algebra', title: 'Projections', topic: 'Linear maps · P / Q' },
  { kind: 'order', question: 'Does the order change the result?', field: 'Linear algebra', title: 'Composition order', topic: 'Rotations and reflections' },
  { kind: 'sculpture', question: 'How many moves bring every bead home?', field: 'Group theory', title: 'Groups of order four', topic: 'Cycle sculpture · C₄ / V₄' },
  { kind: 'cube', question: 'Can a rotation be a rearrangement?', field: 'Group theory', title: 'Cube rotations', topic: 'Four diagonals' },
  { kind: 'quotient', question: 'When do 24 rotations become six?', field: 'Group theory', title: 'Quotient groups', topic: '24 rotations become 6' },
  { kind: 'braid', question: 'Can different moves make the same braid?', field: 'Topology', title: 'Braid relations', topic: 'Three-strand braids' },
  { kind: 'proof', question: 'How does rearranging these steps keep us closer to home?', field: 'Combinatorics', title: 'Steinitz lemma', topic: 'Inside a published proof' },
]

/** The scene's subtitle under its question: the experiment's short title, then the presenter's own subtitle. */
export function withTitle(title: string, subtitle: Label): Label {
  return { plain: subtitle.plain ? `${title} · ${subtitle.plain}` : title }
}

/** Consecutive picker entries of the same field, in order (the picker's groups). */
export function fieldGroups<T extends { field: string }>(items: readonly T[]): { field: string; items: T[] }[] {
  const groups: { field: string; items: T[] }[] = []
  for (const e of items) {
    const last = groups[groups.length - 1]
    if (last && last.field === e.field) last.items.push(e)
    else groups.push({ field: e.field, items: [e] })
  }
  return groups
}

// ------------------------------------------------------------------ what a press does

/** What activating a context item, a detail action or a reset entry does. Never a string to parse. */
export type ContextRun =
  /** A validated workspace transaction (selection, edits, rebinds): all or nothing, undoable. */
  | { kind: 'actions'; actions: unknown[] }
  /** The active scene's existing presentation (never a mathematical step). */
  | { kind: 'playback'; command: 'replay' | 'toggle' }
  /** The P/Q drag mode (fiber / free): app presentation state, not the document. */
  | { kind: 'dragMode' }
  /** Request a claim-specific Lean check through the evidence client (linear demonstrations, the proof lesson). */
  | { kind: 'check'; claim: ClaimRequest }
  /** Show one step of the proof lesson (transient presentation state; never a mathematical transaction). */
  | { kind: 'stage'; stage: WalkStage }
  | { kind: 'none' }

export interface Availability {
  enabled: boolean
  /** Short reason shown when disabled ("Nothing applied yet"). */
  reason?: string
}

// ------------------------------------------------------------------ context actions (near the stage)

export interface ContextItem {
  /** Stable within the experiment ("op:c1", "apply", "rebind"); the command refers to it by ID. */
  id: string
  label: Label
  /** choice: selectable (cards, rotations); primary: the one clear next action; secondary: quieter; toggle: on/off. */
  role: 'choice' | 'primary' | 'secondary' | 'toggle'
  selected?: boolean
  enabled: boolean
  reason?: string
  /** Accessible name when it differs from the visible label. */
  ariaLabel?: string
  /** Optional one-line helper (hover/focus). */
  hint?: string
  run: ContextRun
}

export interface ContextGroup {
  id: string
  /** Optional small group label ("Rotate", "Rewrite"). */
  label?: string
  layout: 'choices' | 'actions'
  items: ContextItem[]
}

export interface ContextView {
  /** Group heading near the stage ("Choose an operation"); null for none. */
  title: string | null
  groups: ContextGroup[]
  /** Next-step guidance that must stay visible ("Choose another diagonal to swap with 0"). */
  hint: string | null
}

// ------------------------------------------------------------------ status and mathematical detail

export interface StatusView {
  /** Scene state (spec section 6): Ready, Animating, Paused, or a completed result. */
  phase: 'ready' | 'animating' | 'paused' | 'result'
  /** One short factual line ("Ready · 0 moves · Starting arrangement"). */
  text: string
  tone: 'normal' | 'warning' | 'error'
}

export interface EvidenceItem {
  id: number
  /** The claim this entry checks (its experiments and points), so a view lists only its own evidence. */
  claim?: ClaimRequest
  /** The claim in the workspace's names. */
  label: string
  status: EvidenceStatus
  /** False once the document changed the claim's data (historical). */
  current: boolean
  /** The checked statement and provenance of a Lean receipt (null until checked). */
  statement: string | null
  provenance: string | null
  message: string | null
  /** Exact local evaluation of the claim (src/workspace/claims.ts evaluateExactly): false when it does not hold. */
  holds?: boolean
}

export type DetailItem =
  | { kind: 'text'; text: string }
  | { kind: 'formula'; formula: Label }
  /** An exact matrix; entries are exact text ("-1", "1/2"). */
  | { kind: 'matrix'; label?: Label; rows: string[][] }
  | { kind: 'pairs'; rows: { key: Label; value: Label }[] }
  | { kind: 'list'; items: Label[] }
  /** Claim-specific evidence (Lean receipts, rewrite records) with its real status. */
  | { kind: 'evidence'; items: EvidenceItem[] }
  /** A button inside the detail view (for example a Lean check request). */
  | { kind: 'action'; id: string; label: Label; enabled: boolean; reason?: string; run: ContextRun }

export interface DetailSection {
  title: string
  /** What kind of statement the section makes: exact runtime calculation, checked rewrites, a Lean receipt. */
  provenance?: 'computed exactly' | 'checked by supported rewrite rules' | 'Lean receipt' | 'presentation' | 'published source'
  items: DetailItem[]
}

export interface DetailView {
  sections: DetailSection[]
}

/** How a scene presents itself under the shell (DomainScene.setPresentation, ManimAdapter.setPresentation). */
export interface ScenePresentation {
  /** The scene's own buttons, cards and plates: false when the shell's context bar provides them. */
  inSceneControls: boolean
  /** Show mathematics is open: the scene may show its formal annotations; closed: essential labels only. */
  detailsOpen: boolean
}

/** A reset entry for More ("Reset experiment", "Clear braid", "Restore example"): names its exact target. */
export interface ResetItem {
  id: string
  label: string
  helper: string
  enabled: boolean
  reason?: string
  run: ContextRun
}

/** What a domain presenter returns for the displayed experiment. */
export interface DomainPresentation {
  /** The variant shown beneath the question ("Cycle experiment · C₄"). */
  subtitle: Label
  context: ContextView
  status: StatusView
  playback: { play: Availability; replay: Availability }
  resets: ResetItem[]
  detail: DetailView
  scene: ScenePresentation
}

/** Everything a presenter may read. Presenters are pure: no clients, no DOM, no scene objects. */
export interface PresenterInput {
  doc: Doc
  demo: DemoKind
  experimentId: string
  /** The linear view description (P/Q and the order comparison), else null. */
  linear: ViewDescription | null
  /** The four algebra demonstrations' derived scene description, else null. */
  scene: { layout: SceneLayout; desc: unknown } | null
  sceneProblem: string | null
  playback: PlaybackState
  drag: { sampleId: string; mode: 'fiber' | 'free'; preview: string | null; lost: boolean } | null
  dragMode: 'fiber' | 'free'
  /** Evidence entries of the linear demonstrations and the proof lesson (EvidenceClient), newest last. */
  evidence: EvidenceItem[]
  detailsOpen: boolean
  /** The proof lesson's current step (transient UI state), null for other experiments. */
  lesson?: { stage: WalkStage } | null
}

export type Presenter = (input: PresenterInput) => DomainPresentation

// ------------------------------------------------------------------ toolbar, popovers, assistant

export type ToolbarId = 'experiments' | 'assistant' | 'play' | 'replay' | 'undo' | 'more'

export interface ToolbarItem {
  id: ToolbarId
  label: string
  ariaLabel: string
  enabled: boolean
  reason?: string
  /** Pressed/open styling: the popover or panel is open (never "a live model is connected"). */
  active: boolean
}

export type MoreItemId =
  | 'save' | 'reopen' | 'export' | 'import'
  | 'saveRepresentation'
  | 'enterVR' | 'enterPassthrough' | 'exitSession' | 'enableVoice'
  | `reset:${string}`

export interface MoreItem {
  id: MoreItemId
  label: string
  helper?: string
  enabled: boolean
  reason?: string
}

export interface MoreView {
  sections: { id: 'workspace' | 'representation' | 'experiment' | 'session'; title: string; items: MoreItem[] }[]
  /** Desktop representation editor (the bound recipe's operations, P/Q): null when not available. */
  representation: { recipeName: string; operations: { kind: string; label: string; on: boolean }[] } | null
  /** Last workspace operation result ("Saved", "Import refused: …"). */
  notice: { text: string; tone: 'normal' | 'error' } | null
}

/** Raw inputs of the assistant inspector (the assistant track derives its own view from them). */
export interface AssistantPanelInput {
  open: boolean
  surface: 'desktop' | 'xr'
  assistant: AssistantState
  voice: VoiceState
  voiceAcquiring: boolean
  capability: { assistant: AssistantCapability | null; speech: SpeechCapability | null } | null
  /** Unsent draft text (UI state; never submitted on its own). */
  draft: string
  doc: Doc
  demo: DemoKind
  experimentId: string
  /** The displayed experiment's presentation (its context items name the current selection and actions). */
  presentation: DomainPresentation
  /** The app's evidence entries (EvidenceClient, via the controller), so an answer can show its own check's state. */
  evidence?: EvidenceItem[]
  /** Which evidence entry the latest answer's request_check started (src/ui/assistant/checkStatus.ts). */
  checkLink?: AnswerCheckLink | null
}

/** Links an applied (or answered) proposal with request_check to the evidence entry its check created. */
export interface AnswerCheckLink {
  requestId: string
  /** The newest evidence entry ID when the proposal arrived (entries with a larger ID came after it). */
  afterId: number
  /** The linked entry, once found (pinned, so a later check of the same claim never takes its place). */
  entryId: number | null
}

export interface UiView {
  surface: 'desktop' | 'xr'
  sessionMode: 'vr' | 'passthrough' | null
  experiment: { kind: DemoKind; question: string; subtitle: Label }
  experiments: { kind: DemoKind; question: string; field: string; title: string; topic: string; selected: boolean }[]
  toolbar: ToolbarItem[]
  popover: 'experiments' | 'more' | null
  more: MoreView
  presentation: DomainPresentation
  inspector: 'assistant' | 'math' | null
  assistant: AssistantPanelInput
  /** Changes whenever any part of the view may have changed (renderers may skip identical keys). */
  key: string
}

// ------------------------------------------------------------------ commands

export type AssistantAction =
  | { kind: 'ask'; text: string }
  | { kind: 'cancel' }
  | { kind: 'retry' }
  | { kind: 'draft'; text: string }
  /** Push-to-talk cycle (record, stop, cancel while sending): the XR Talk semantics. */
  | { kind: 'voiceToggle' }
  | { kind: 'voiceStart' }
  | { kind: 'voiceStop' }
  | { kind: 'voiceCancel' }
  | { kind: 'transcriptEdit'; text: string }
  | { kind: 'transcriptSubmit'; text?: string }

export type UiCommand =
  | { kind: 'popover'; which: 'experiments' | 'more' | null }
  | { kind: 'experiment'; demo: DemoKind }
  /** Open the inspector (or close it when it is already that one); null closes. */
  | { kind: 'inspector'; which: 'assistant' | 'math' | null }
  | { kind: 'playPause' }
  | { kind: 'replay' }
  | { kind: 'undo' }
  /** Activate a context item or a detail action by ID (looked up in the current view; disabled ones are rejected). */
  | { kind: 'context'; id: string }
  | { kind: 'more'; id: MoreItemId }
  /** Save the bound recipe with these operations as a new representation (desktop editor). */
  | { kind: 'saveRepresentation'; operations: string[] }
  | { kind: 'assistant'; action: AssistantAction }

export type UiDispatch = (cmd: UiCommand) => void

// ------------------------------------------------------------------ renderer plug-ins (assistant content)

export interface SpatialPick {
  id: string
  distance: number
  /** The command a press dispatches (null: hover only). */
  command: UiCommand | null
  hint?: string
}

/** Assistant content inside the shell's desktop inspector frame. */
export interface DomPanelContent {
  mount(container: HTMLElement): void
  render(input: AssistantPanelInput): void
  dispose(): void
}

/** Assistant content inside the shell's spatial inspector frame (bench-local metres; top-left at the origin). */
export interface SpatialPanelContent {
  readonly width: number
  readonly height: number
  mount(parent: Object3D): void
  render(input: AssistantPanelInput): void
  step(ctx: FrameContext): void
  pick(ray: Ray): SpatialPick | null
  setHover(id: string | null): void
  setVisible(visible: boolean): void
  dispose(): void
}
