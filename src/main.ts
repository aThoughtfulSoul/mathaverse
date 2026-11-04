// Entry point. The scheduler audit must load before three or manim-web.
import { schedulerReport } from './runtime/schedulerAudit'
import { Host } from './runtime/host'
import { ensureEmulator, getEmulator, installRafShim } from './runtime/emulator'
import { Quaternion, Vector3 } from 'three'
import { nestedSvgCheck } from './dev/checks'
import { texDebug, clearTexCache } from './rendering/tex'
import { clearTokens, tokenStats } from './rendering/glyphTokens'
import { slotStats } from './rendering/textSlot'
import { makeVerifier } from './dev/verifyXR'
import { makeDeviceChecks } from './dev/deviceChecks'
import { profileReport, profileReset } from './runtime/frameProfile'
import type { DomPanelContent, Presenter, SpatialPanelContent, UiCommand, UiDispatch, UiView } from './ui/model'
import type { SpatialShellHost } from './app'
import type { DemoKind } from './demo/order'
import type { AssistantCapability, SpeechCapability } from '../server/types'
import type { OrbSource } from './ui/orb/source'

const params = new URLSearchParams(location.search)
const statusEl = document.getElementById('status')!
const errorsEl = document.getElementById('errors')!
const xrButton = document.getElementById('enter-xr') as HTMLButtonElement
const passthroughButton = document.getElementById('enter-passthrough') as HTMLButtonElement
if (params.get('hud') !== 'full') document.getElementById('hud')!.classList.add('compact')
// Diagnostics (the status lines) are developer-only: ?debug=1 or ?hud=full, or the H key.
if (params.get('debug') === '1' || params.get('hud') === 'full') document.body.classList.add('debug')
// Filming: ?capture=1 keeps the product UI and hides diagnostics; ?clean=1 (clean stage) hides every 2D layer, the
// assistant panel included, so no answer is ever shown without its source. H still shows diagnostics in both.
if (params.get('capture') === '1') document.body.classList.add('capture')
if (params.get('clean') === '1') document.body.classList.add('capture', 'clean', 'clean-stage')
/** The refined UI's command entry (set once the shell is mounted; null while the fallback HUD is in use). */
let uiDispatch: ((c: UiCommand) => void) | null = null

/** Where a surfaced error also goes once the refined UI is mounted (its inline notice under the status line). */
let errorNotice: ((msg: string) => void) | null = null
function showError(msg: string): void {
  errorsEl.style.display = 'block'
  errorsEl.textContent += `${msg}\n`
  errorNotice?.(msg)
}
window.addEventListener('error', (e) => showError(String(e.message)))
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason)))

const rafShim = import.meta.env.DEV && params.get('rafshim') === '1' ? installRafShim(Number(params.get('hz') ?? 72)) : null

const host = new Host(document.getElementById('app')!)
host.onError((msg) => showError(`frame: ${msg}`))
statusEl.textContent = 'loading manim-web + MathJax…'
const t0 = performance.now()
const { App } = await import('./app')
const app = new App(host)
app.input.emulatorRuntime = () => getEmulator() !== null
await app.start()
const loadMs = Math.round(performance.now() - t0)
void app.prepared.then((r) => {
  if (!r.ok) showError(`equation preparation failed (plain-text fallbacks shown):\n${r.failures?.join('\n')}`)
})

// ---- Enter / exit VR (user activation required on Quest Browser) ----
const emulator = await ensureEmulator()
async function refreshXRButton(): Promise<void> {
  const ok = (await navigator.xr?.isSessionSupported('immersive-vr').catch(() => false)) ?? false
  const ar = await host.passthroughSupported()
  const mode = host.presenting ? host.sessionMode : null
  xrButton.disabled = !ok || mode === 'passthrough'
  xrButton.textContent = mode === 'vr' ? 'Exit VR' : ok ? (emulator ? 'Enter VR (IWER emulator)' : 'Enter VR') : 'VR unavailable'
  // Passthrough: the WebXR AR module ('immersive-ar'); the room shows behind a dark backing panel.
  passthroughButton.disabled = !ar || mode === 'vr'
  passthroughButton.textContent = mode === 'passthrough' ? 'Exit passthrough' : ar ? 'Enter passthrough' : 'Passthrough unavailable'
}
xrButton.addEventListener('click', () => {
  const p = host.presenting ? host.exitXR() : host.enterXR('vr')
  p.catch((e: unknown) => showError(String(e))).finally(() => void refreshXRButton())
})
passthroughButton.addEventListener('click', () => {
  const p = host.presenting ? host.exitXR() : host.enterXR('passthrough')
  p.catch((e: unknown) => showError(String(e))).finally(() => void refreshXRButton())
})
host.onSession(() => void refreshXRButton())
await refreshXRButton()

// ---- desktop keyboard (same semantic commands as the spatial buttons) ----
// Typing in a field (the question box, a transcript) or pressing a focused button never reaches the shortcuts.
const { shortcutBlocked } = await import('./ui/shortcuts')
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || shortcutBlocked(e)) return
  if (e.code === 'Space') {
    e.preventDefault()
    if (uiDispatch) uiDispatch({ kind: 'playPause' })
    else app.command('toggle')
  } else if (e.key === 'r' || e.key === 'R') uiDispatch ? uiDispatch({ kind: 'replay' }) : app.command('replay')
  // M toggles the drag mode through its context item (P / Q only; the item's own enablement applies; nothing elsewhere).
  else if (e.key === 'm' || e.key === 'M') uiDispatch ? uiDispatch({ kind: 'context', id: app.mode === 'fiber' ? 'drag:free' : 'drag:fiber' }) : app.command('mode')
  else if (e.key === 'z' || e.key === 'Z') uiDispatch ? uiDispatch({ kind: 'undo' }) : app.command('undo')
  else if (e.key === 'Escape') app.command('cancel')
  else if (e.key === 'h' || e.key === 'H') {
    document.body.classList.toggle('debug')
    document.getElementById('hud')!.classList.toggle('compact')
  }
})

// ---- workspace persistence and recipe adaptation (desktop panels; the same transactions as XR) ----
const { saveDocument, loadSaved, exportText, importText, storageDebug } = await import('./storage/persist')
const { rebindTarget, bindingsFor } = await import('./demo/pq')
const { WHAT_GETS_LOST } = await import('./recipes/recipe')
const { activeExperiment, findRecipe, displayedExperiment, isLinearDisplayed } = await import('./workspace/document')
const { demoOf, DEMO_KINDS } = await import('./demo/order')
const { domainControls } = await import('./demo/four')
// The four algebra demonstrations' scenes (a track that fails to load is reported; the others keep working).
const sceneProblems = await (await import('./domains/all')).registerAll()
for (const p of sceneProblems) console.warn(`[scenes] ${p}`)
type SaveStatus = Awaited<ReturnType<typeof saveDocument>>
let saveStatus: SaveStatus = { kind: 'never' }
const $ = (id: string) => document.getElementById(id)!
const txSummary = $('tx-summary')
function showSummary(lines: string[], error = false): void {
  txSummary.textContent = lines.join(' · ')
  txSummary.style.color = error ? '#ff8fa3' : ''
}
function renderSaveStatus(): void {
  const el = $('save-status')
  const rev = app.workspace.current.revision
  el.classList.toggle('warn', saveStatus.kind === 'failed' || (saveStatus.kind === 'saved' && saveStatus.revision !== rev))
  el.textContent =
    saveStatus.kind === 'failed' ? `Not saved (${saveStatus.reason}) - export to keep a copy`
    : saveStatus.kind === 'saved' ? (saveStatus.revision === rev ? `Saved ${new Date(saveStatus.at).toLocaleTimeString()}` : 'Unsaved changes')
    : 'not saved yet'
}
// The workspace file operations, shared by the fallback HUD and the refined UI's More menu. Each resolves to the
// line to show, or rejects with it.
async function saveWorkspace(): Promise<string> {
  saveStatus = await saveDocument(app.workspace.current)
  renderSaveStatus()
  if (saveStatus.kind === 'failed') throw new Error(`Not saved (${saveStatus.reason}); export to keep a copy`)
  return `Saved ${new Date(saveStatus.kind === 'saved' ? saveStatus.at : Date.now()).toLocaleTimeString()} (revision ${app.workspace.current.revision})`
}
async function reopenWorkspace(): Promise<string> {
  try {
    const saved = await loadSaved()
    if (!saved) throw new Error('Nothing saved in this browser yet')
    app.openDocument(saved.doc, 'reopen')
    saveStatus = { kind: 'saved', at: saved.savedAt, revision: saved.doc.revision }
    return `Reopened the workspace saved ${new Date(saved.savedAt).toLocaleTimeString()}`
  } catch (e) {
    throw new Error(`Could not reopen: ${(e as Error).message}`)
  } finally {
    renderSaveStatus()
  }
}
function exportWorkspace(): string {
  const doc = app.workspace.current
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([exportText(doc)], { type: 'application/json' }))
  a.download = `${doc.workspaceId}-rev${doc.revision}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  return `Exported ${a.download}`
}
/** Where an import's outcome goes (the refined UI's notice line once it is mounted). */
let importNotice: (text: string, error: boolean) => void = (text, error) => showSummary([text], error)
$('save').addEventListener('click', () => void saveWorkspace().catch(() => {}))
$('reopen').addEventListener('click', () => void reopenWorkspace().then((t) => showSummary([t]), (e: Error) => showSummary([e.message], true)))
$('export').addEventListener('click', () => void exportWorkspace())
const fileInput = $('import-file') as HTMLInputElement
$('import').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return
  try {
    const doc = importText(await file.text())
    app.openDocument(doc, 'import')
    saveStatus = { kind: 'never' }
    importNotice(`Opened ${file.name} as a new workspace (revision ${doc.revision})`, false)
  } catch (e) {
    importNotice(`Import refused: ${(e as Error).message}`, true)
  }
  renderSaveStatus()
})
function runActions(actions: unknown[], source: string): void {
  try {
    showSummary(app.transact(actions, source).summary)
  } catch (e) {
    showSummary([`Not applied: ${(e as Error).message}`], true)
  }
}
$('rebind').addEventListener('click', () => runActions(rebindTarget(app.workspace.current).actions, 'desktop'))
// Demonstration switch and the comparison's order edits: the same validated transactions as the XR controls.
function runApp(f: () => { summary: string[] } | null): void {
  try {
    const r = f()
    if (r) showSummary(r.summary)
  } catch (e) {
    showSummary([`Not applied: ${(e as Error).message}`], true)
  }
}
for (const kind of DEMO_KINDS) $(`demo-${kind}`).addEventListener('click', () => runApp(() => app.showDemo(kind, 'desktop')))
// The four algebra demonstrations: the same controls as the spatial panel (Reset, the demo's own control, Replay).
const runDomain = (which: 'reset' | 'extra') => {
  const doc = app.workspace.current
  if (isLinearDisplayed(doc)) return
  const c = domainControls(doc, displayedExperiment(doc))[which]
  if (c.actions.length) runActions(c.actions, 'desktop')
}
$('four-extra').addEventListener('click', () => runDomain('extra'))
$('four-reset').addEventListener('click', () => runDomain('reset'))
$('four-replay').addEventListener('click', () => app.command('replay'))
$('reverse-left').addEventListener('click', () => runApp(() => app.reverseRoute('left', 'desktop')))
$('reverse-right').addEventListener('click', () => runApp(() => app.reverseRoute('right', 'desktop')))
$('replay-compare').addEventListener('click', () => {
  const b = app.comparedBranch('left')
  if (b) runActions([{ kind: 'play_comparison', experimentId: b.experimentId, stepDuration: 1.6 }], 'desktop')
})
const INTRO: Record<(typeof DEMO_KINDS)[number], { title: string; text: string; ask: string }> = {
  sculpture: { title: 'Kinetic group sculpture <span class="dim">· C₄ and V₄</span>', text: 'Four beads, two groups of four elements. Pick an operation card and apply it again and again: C₄\'s generator brings every bead home after four, V₄\'s elements after two. Then use the same recipe on V₄.', ask: 'e.g. Use the same experiment with the Klein four-group' },
  cube: { title: 'Two worlds, one structure <span class="dim">· cube rotations and four diagonals</span>', text: 'Rotate the cube and its four body diagonals permute in step; swap two diagonal objects and the one matching rotation turns the cube. Both views follow the same exact element.', ask: 'e.g. Rotate a quarter turn about z' },
  quotient: { title: 'Choose what matters <span class="dim">· 24 rotations, 6 classes</span>', text: 'Track only which opposite-face pair goes where: the 24 rotations fall into six classes of four, and composing classes does not depend on the representatives chosen.', ask: 'e.g. Track only the opposite-face pairs' },
  braid: { title: 'Weaving algebra <span class="dim">· three-strand braids</span>', text: 'σ₁σ₂σ₁ and σ₂σ₁σ₂ are the same braid: one deforms into the other without strands passing through each other. A double crossing is not nothing (exponent sum 2), but σ₁σ₁⁻¹ cancels.', ask: 'e.g. Show the other side of the braid relation' },
  pq: { title: 'What a linear map loses <span class="dim">· reusable representation</span>', text: 'Drag the white point along its rose fiber; then use the same recipe on Q. Right-drag or drag empty space to orbit; wheel zooms.', ask: 'e.g. Use this representation on Q' },
  proof: { title: 'Inside a published proof <span class="dim">· Steinitz–Bergström reordering step</span>', text: 'Twelve arrows return home but wander far on the way. Label them + and −, put the + arrows first and the − arrows after in reverse, and every point of the new walk stays within half the two bounds combined.', ask: 'e.g. Why is this point inside the bound?' },
  order: { title: 'Does order matter? <span class="dim">· rotate and reflect</span>', text: 'The same labelled square follows two routes: rotate 90° then reflect, and reflect then rotate 90°. Watch where each corner and e₁ land; reverse a route to compare.', ask: 'e.g. Reverse the order on the left' },
}
function renderDemo(): void {
  const kind = app.demo
  for (const k of DEMO_KINDS) {
    document.body.classList.toggle(`demo-${k}`, kind === k)
    $(`demo-${k}`).setAttribute('aria-pressed', String(kind === k))
  }
  const doc = app.workspace.current
  const linear = isLinearDisplayed(doc)
  document.body.classList.toggle('domain-new', !linear)
  if (!linear) {
    const c = domainControls(doc, displayedExperiment(doc))
    $('four-extra').textContent = c.extra.label
    ;($('four-extra') as HTMLButtonElement).disabled = !c.extra.actions.length
    ;($('four-reset') as HTMLButtonElement).disabled = !c.reset.actions.length
    $('four-status').textContent = app.sceneProblem ? `Not available: ${app.sceneProblem}` : app.scene?.scene.status() ?? ''
  }
  $('intro-title').innerHTML = INTRO[kind].title
  $('intro-text').textContent = INTRO[kind].text
  ;($('ask-text') as HTMLInputElement).placeholder = INTRO[kind].ask
  const c = app.currentDescription()?.comparison
  $('order-routes').replaceChildren(...(c ? [
    `Left: ${c.left.order} (resolves to ${c.left.symbol})`,
    `Right: ${c.right.order} (resolves to ${c.right.symbol})`,
    c.mapsEqual ? `${c.left.symbol} = ${c.right.symbol}: the routes give the same map` : `${c.left.symbol} ≠ ${c.right.symbol}: the order changes the result`,
  ] : []).map((text) => {
    const d = document.createElement('div')
    d.textContent = text
    return d
  }))
}
$('undo-btn').addEventListener('click', () => app.command('undo'))
// Adapt the bound recipe: toggle operations (the closed W2 list) and save the rule as a new recipe.
const opsEl = $('recipe-ops')
let draft: string[] | null = null
let draftFor = ''
function renderRecipe(): void {
  const doc = app.workspace.current
  if (!isLinearDisplayed(doc)) {
    const d = displayedExperiment(doc)
    const r = d.binding ? findRecipe(doc, d.binding.recipeId) : null
    $('recipe-name').textContent = r ? `${r.name} · ${d.id}` : 'no recipe bound'
    draftFor = ''
    return
  }
  const e = activeExperiment(doc)
  const r = e.binding ? findRecipe(doc, e.binding.recipeId) : null
  const key = `${e.id}|${r?.id ?? ''}|${doc.revision}`
  const cmp = app.currentDescription()?.comparison
  $('recipe-name').textContent = !r ? 'no recipe bound' : cmp ? `${r.name} · ${cmp.left.symbol} and ${cmp.right.symbol}` : `${r.name} · bound to ${app.currentDescription()?.mapSymbol ?? ''}`
  ;($('rebind') as HTMLButtonElement).textContent = rebindTarget(doc).label
  if (key === draftFor) return
  draftFor = key
  draft = r ? r.operations.map((o) => o.kind) : []
  opsEl.replaceChildren(...WHAT_GETS_LOST.operations.map((op) => {
    const label = document.createElement('label')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = draft!.includes(op.kind)
    label.classList.toggle('on', box.checked)
    box.addEventListener('change', () => {
      draft = WHAT_GETS_LOST.operations.map((o) => o.kind).filter((k) => (k === op.kind ? box.checked : draft!.includes(k)))
      label.classList.toggle('on', box.checked)
    })
    label.append(box, document.createTextNode(op.kind.replace(/_/g, ' ')))
    return label
  }))
}
let savedRecipes = 0
$('recipe-save').addEventListener('click', () => {
  const doc = app.workspace.current
  const e = activeExperiment(doc)
  if (!draft?.length) return showSummary(['A recipe needs at least one operation'], true)
  const operations = WHAT_GETS_LOST.operations.filter((o) => draft!.includes(o.kind))
  let name = `adapted${++savedRecipes}`
  while (doc.recipes.some((r) => r.id === `recipe-${name}`)) name = `adapted${++savedRecipes}`
  const rule = { name: `What gets lost (adapted ${savedRecipes})`, inputs: WHAT_GETS_LOST.inputs, operations }
  runActions([
    { kind: 'save_recipe', name, recipe: rule },
    { kind: 'bind_recipe', experimentId: e.id, recipeId: `$${name}`, bindings: bindingsFor({ ...doc, recipes: [...doc.recipes, { schemaVersion: 1, id: `recipe-${name}`, ...rule }] }, `recipe-${name}`, e.sampleSetId, e.branches[0]!.id, doc.selection.sampleId) },
  ], 'desktop')
})
app.workspace.subscribe(() => {
  renderSaveStatus()
  // After the frame that derives the new description (the comparison summary comes from it).
  requestAnimationFrame(() => {
    renderRecipe()
    renderDemo()
  })
})
renderRecipe()
renderDemo()

// ---- assistant (typed request path) and evidence (Lean checks), through the shared contracts ----
const { AssistantClient, sourceLabel } = await import('./assistant/client')
const { EvidenceClient } = await import('./evidence/client')
const evidence = new EvidenceClient(app)
const assistant = new AssistantClient(app, () => evidence.refs(), (effects) => {
  for (const e of effects) if (e.kind === 'request_check') void evidence.check(e.claim)
})
const askText = $('ask-text') as HTMLInputElement
const askBtn = $('ask') as HTMLButtonElement
const askCancel = $('ask-cancel') as HTMLButtonElement
const askRetry = $('ask-retry') as HTMLButtonElement
const askUndo = $('ask-undo') as HTMLButtonElement
askBtn.addEventListener('click', () => void assistant.ask(askText.value))
askText.addEventListener('keydown', (e) => {
  e.stopPropagation() // typing must not trigger scene shortcuts
  if (e.key === 'Enter') void assistant.ask(askText.value)
})
askCancel.addEventListener('click', () => assistant.cancel())
askRetry.addEventListener('click', () => void assistant.retry())
askUndo.addEventListener('click', () => app.command('undo'))
assistant.subscribe((st) => {
  const status = $('ask-status')
  const out = $('ask-response')
  askCancel.disabled = st.kind !== 'pending'
  askRetry.hidden = st.kind !== 'stale' && !(st.kind === 'error' && st.error.retryable)
  askUndo.hidden = st.kind !== 'applied'
  out.replaceChildren()
  const line = (cls: string, text: string) => {
    const d = document.createElement('div')
    d.className = cls
    d.textContent = text
    out.append(d)
  }
  // The same outcome in the scene, so a headset viewer sees provenance and what applied (A6, W8).
  const syn = 'response' in st && st.response.source === 'synthetic'
  const prov = 'response' in st ? (syn ? 'Synthetic response, not live Muse' : `Muse ${st.response.model}`) : ''
  // With the refined UI the spatial assistant panel carries this (one place, not two).
  if (!uiDispatch) app.setAssistantLine(
    st.kind === 'pending' ? { text: `Assistant: requesting "${st.prompt.slice(0, 60)}"`, synthetic: false }
    : st.kind === 'applied' ? { text: `${prov}: ${st.summary.join('; ')}`, synthetic: syn }
    : st.kind === 'answered' ? { text: `${prov}: ${st.response.proposal.title}`, synthetic: syn }
    : st.kind === 'stale' ? { text: `${prov}: not applied (${st.reason})`, synthetic: syn }
    : st.kind === 'rejected' ? { text: `${prov}: not applied (failed validation)`, synthetic: syn }
    : st.kind === 'error' ? (st.error.code === 'synthetic_no_fixture'
      ? { text: 'Synthetic mode has no prepared reply for that request; nothing changed', synthetic: true }
      : { text: `Assistant request failed (${st.error.code}); nothing changed`, synthetic: false })
    : null,
  )
  switch (st.kind) {
    case 'pending':
      status.textContent = `Requesting: "${st.prompt}"…`
      break
    case 'applied':
      status.textContent = `Applied: ${st.summary.join(' · ')} (${Math.round(st.sceneChangeMs)} ms to the scene change)`
      line('src', sourceLabel(st.response))
      line('expl', `${st.response.proposal.title}. AI explanation: ${st.response.proposal.explanation}`)
      break
    case 'answered':
      status.textContent = 'Answered without changing the scene'
      line('src', sourceLabel(st.response))
      line('expl', `${st.response.proposal.title}. AI explanation: ${st.response.proposal.explanation}`)
      break
    case 'stale':
      status.textContent = `Not applied: ${st.reason}. Kept as a suggestion.`
      line('src', sourceLabel(st.response))
      line('expl', `${st.response.proposal.title}. AI explanation: ${st.response.proposal.explanation}`)
      break
    case 'rejected':
      status.textContent = `Not applied: the proposal failed validation (${st.reason}). Nothing changed.`
      line('src', sourceLabel(st.response))
      break
    case 'error':
      status.textContent = `Assistant error (${st.error.code}): ${st.error.message}. Nothing changed.`
      break
    case 'canceled':
      status.textContent = 'Canceled. Nothing changed.'
      break
    default:
      status.textContent = ''
  }
})
// Evidence buttons: claims about the displayed experiment and the two maps.
const branch = (experimentId: string) => ({ experimentId, branchId: 'main' })
function selectedPair(): { experimentId: string; u: string; v: string } | null {
  const doc = app.workspace.current
  const sel = doc.selection.sampleId
  const group = sel ? app.currentDescription()?.collisions.find((g) => g.includes(sel)) : null
  if (!sel || !group) return null
  const named = app.activeSamples().filter((s) => s.label && s.id !== sel && group.includes(s.id))
  const partner = named[0]?.id ?? group.find((id) => id !== sel)!
  return { experimentId: doc.selection.experimentId, u: sel, v: partner }
}
$('check-same').addEventListener('click', () => {
  const p = selectedPair()
  if (!p) return showSummary(['The selected sample shares its output with no other sample here'], true)
  void evidence.check({ kind: 'same_image_witness', branch: branch(p.experimentId), u: p.u, v: p.v })
})
/** The two maps the buttons compare: the displayed comparison's routes, or P and Q. */
function comparedMaps(): { left: { experimentId: string; branchId: string }; right: { experimentId: string; branchId: string } } | null {
  if (app.demo === 'order') {
    const left = app.comparedBranch('left')
    const right = app.comparedBranch('right')
    return left && right ? { left, right } : null
  }
  const doc = app.workspace.current
  const pq = doc.experiments.filter((e) => demoOf(doc, e) === 'pq')
  return pq.length >= 2 ? { left: branch(pq[0]!.id), right: branch(pq[1]!.id) } : null
}
$('check-diff').addEventListener('click', () => {
  const m = comparedMaps()
  if (!m) return showSummary(['Use the recipe on Q first: there is only one map'], true)
  void evidence.check({ kind: 'map_difference_witness', ...m, basisIndex: 0 })
})
$('check-eq').addEventListener('click', () => {
  const m = comparedMaps()
  if (!m) return showSummary(['Use the recipe on Q first: there is only one map'], true)
  void evidence.check({ kind: 'map_equality', ...m })
})
evidence.subscribe(() => {
  const list = $('evidence-list')
  list.replaceChildren(...evidence.entries.map((e) => {
    const li = document.createElement('li')
    li.textContent = EvidenceClient.describe(e)
    li.className = `${e.status === 'checked' && e.current ? 'ok' : ''} ${e.current ? '' : 'hist'}`
    li.title = e.response?.statement ?? ''
    return li
  }))
  app.setEvidenceLine(evidence.sceneLine())
})
// ---- push-to-talk (voice track): transcripts go through the same typed request path as Ask ----
const { VoiceClient, captionFor, talkLabelFor } = await import('./voice/client')
const { mountVoicePanel } = await import('./voice/panel')
/** Vocabulary hints: the names the scene shows, plus the demonstrations' words. */
function voiceHints(): string[] {
  const doc = app.workspace.current
  const labels = [...doc.maps.map((m) => m.label), ...doc.sampleSets.flatMap((s) => s.samples.map((x) => x.label.replace(/_\{(.*?)\}/g, '$1')))].filter(Boolean)
  const words = ['rotate', 'reflect', 'rotation', 'reflection', 'order', 'left', 'right', 'replay', 'comparison', 'fiber', 'projection', 'representation', 'transformation', 'Lean', 'e1', 'Klein', 'group', 'diagonals', 'quarter turn', 'swap', 'class', 'representative', 'braid', 'sigma', 'crossing', 'rewrite']
  return [...new Set([...labels, ...words])].slice(0, 40)
}
const voice = new VoiceClient({ submit: (text) => assistant.ask(text), hints: voiceHints })
// Optional 2D "Enable voice" (SECOND-DEMO-REVIEW decision 3): ask for the microphone from the user's own press,
// show the result and release the stream at once. Nothing is recorded or sent; Enter VR never waits on it.
$('enable-voice').addEventListener('click', async () => {
  $('voice-permission').textContent = 'asking…'
  const ok = await voice.requestMicrophone()
  $('voice-permission').textContent = ok ? 'microphone allowed' : 'microphone not available (typed and controller use still work)'
})
mountVoicePanel($('voice-slot'), voice)
// XR: the Talk control starts, stops, or cancels (while transcribing and in the cancel window before the
// transcript is sent; there is no keyboard to correct it there).
app.onTalk = () => voice.toggle({ autoSubmitMs: 2500 })
voice.subscribe((st) => {
  if (!uiDispatch) app.setVoiceLine(captionFor(st))
  app.setTalkLabel(talkLabelFor(st, voice.acquiring))
})
// Desktop: hold T to talk (typing in the Ask or transcript fields never reaches here: they stop propagation).
window.addEventListener('keydown', (e) => {
  if ((e.key === 't' || e.key === 'T') && !e.repeat && !e.metaKey && !e.ctrlKey && !shortcutBlocked(e)) void voice.start()
})
window.addEventListener('keyup', (e) => {
  if (e.key === 't' || e.key === 'T') voice.stop()
})

// Service status (W7: configured, authenticated and live-validated are different statuses).
type Capabilities = { assistant: AssistantCapability; proof: { available: boolean; toolchain: string | null }; speech?: SpeechCapability }
let caps: Capabilities | null = null
let capsRefresh: () => void = () => {}
void fetch('/api/capabilities').then((r) => r.json()).then((c: Capabilities) => {
  caps = c
  capsRefresh()
  voice.setCapability(c.speech ?? null)
  $('ask-mode').textContent = c.assistant.mode === 'meta' ? `Muse ${c.assistant.model} (configured${c.assistant.liveValidated ? ', live-validated' : ', not yet live-validated'})` : c.assistant.mode === 'synthetic' ? 'synthetic responses only (no Meta credentials configured)' : 'assistant unavailable'
  $('lean-mode').textContent = c.proof.available ? `Lean ${c.proof.toolchain}` : 'Lean checker unavailable: exact computation only'
}).catch(() => {
  caps = { assistant: { configured: false, authenticated: false, liveValidated: false, model: null, mode: 'unavailable' }, proof: { available: false, toolchain: null } }
  capsRefresh()
  voice.setCapability(null)
  $('ask-mode').textContent = 'assistant unavailable'
  $('lean-mode').textContent = 'Lean checker unavailable'
})
// After the first real Meta transcript, re-read the capabilities so "· live call unverified" clears once the server
// has recorded a live-validated speech call (it never changes from the client's own say-so).
voice.subscribe((st) => {
  if (st.kind === 'transcript' && st.response.source === 'meta' && caps?.speech?.mode === 'meta' && !caps.speech.liveValidated) {
    void fetch('/api/capabilities').then((r) => r.json()).then((c: Capabilities) => {
      caps = c
      voice.setCapability(c.speech ?? null)
      capsRefresh()
    }).catch(() => {})
  }
})

// ---- the refined UI (UI-REFINEMENT-SPEC): one derived view and one command vocabulary, read by the desktop shell
// over the page and by the spatial shell on the workbench. A track whose module is missing or fails to load is
// reported; without the shell the fallback HUD and the old spatial controls stay in use.
type ShellModule = {
  DesktopShell: new (o: { root: HTMLElement; stage: HTMLElement; dispatch: UiDispatch; assistant: DomPanelContent; orb?: OrbSource | null }) => { render(v: UiView): void; dispose(): void }
  SpatialShell: new (o: { dispatch: UiDispatch; assistant: SpatialPanelContent; orb?: OrbSource | null }) => SpatialShellHost
}
type PresenterModule = { PRESENTERS: Record<DemoKind, Presenter> }
type AssistantModule = { createAssistantDomContent(d: UiDispatch): DomPanelContent; createAssistantSpatialContent(d: UiDispatch): SpatialPanelContent }
const uiTracks = import.meta.glob(['./ui/shell/index.ts', './ui/presenters/index.ts', './ui/assistant/index.ts'])
const uiProblems: string[] = []
// ?ui=legacy keeps the earlier HUD and spatial controls (the retired surfaces the IWER verify suite drives).
const legacyUi = params.get('ui') === 'legacy'
async function loadTrack<T>(path: string): Promise<T | null> {
  if (legacyUi && path === './ui/shell/index.ts') return null
  const load = uiTracks[path]
  if (!load) {
    uiProblems.push(`${path}: not present`)
    return null
  }
  try {
    return (await load()) as T
  } catch (e) {
    uiProblems.push(`${path}: ${(e as Error).message}`)
    return null
  }
}
const { UiController } = await import('./ui/controller')
const [shellMod, presenterMod, assistantMod] = await Promise.all([
  loadTrack<ShellModule>('./ui/shell/index.ts'),
  loadTrack<PresenterModule>('./ui/presenters/index.ts'),
  loadTrack<AssistantModule>('./ui/assistant/index.ts'),
])
for (const p of uiProblems) console.warn(`[ui] ${p}`)
const ui = new UiController({
  app, host, assistant, voice, evidence,
  workspace: {
    save: saveWorkspace,
    reopen: reopenWorkspace,
    exportJson: exportWorkspace,
    importJson: () => fileInput.click(),
  },
  capabilities: () => caps ? { assistant: caps.assistant, speech: caps.speech ?? null } : null,
})
ui.setPresenters(presenterMod?.PRESENTERS ?? null)
capsRefresh = () => ui.invalidate()
// Live Muse: liveValidated is reported per server process, so re-read it after a real answer settles.
assistant.subscribe((st) => {
  if (caps?.assistant.mode === 'meta' && 'response' in st && st.response.source !== 'synthetic' && !caps.assistant.liveValidated) {
    void fetch('/api/capabilities').then((r) => r.json()).then((c: Capabilities) => {
      caps = c
      capsRefresh()
    }).catch(() => {})
  }
})
const dispatch: UiDispatch = (c) => ui.dispatch(c)
/** Stand-in assistant content when that track is missing: the shell still opens a truthful panel. */
const missingAssistant: DomPanelContent = {
  mount: (el) => {
    el.textContent = 'The assistant panel is not available in this build.'
  },
  render: () => {},
  dispose: () => {},
}
let desktopShell: { render(v: UiView): void; dispose(): void; stageInsets?(): { top: number; right: number; bottom: number; left: number } } | null = null
// The Ask Meta Muse AI glyph orb (desktop panel header, XR beside the inspector): its phase comes only from the voice
// and assistant clients' real states (src/ui/orb/state.ts), its listening ripple from the recording's real input level.
let orbSource: (OrbSource & { dispose(): void }) | null = null
if (shellMod && assistantMod) {
  try {
    orbSource = (await import('./ui/orb/source')).createOrbSource({ voice, assistant })
  } catch (e) {
    uiProblems.push(`orb: ${(e as Error).message}`)
  }
}
if (shellMod) {
  try {
    desktopShell = new shellMod.DesktopShell({ root: $('shell'), stage: $('app'), dispatch, assistant: assistantMod?.createAssistantDomContent(dispatch) ?? missingAssistant, orb: orbSource })
    if (assistantMod) app.attachSpatialShell(new shellMod.SpatialShell({ dispatch, assistant: assistantMod.createAssistantSpatialContent(dispatch), orb: orbSource }), dispatch)
    else uiProblems.push('spatial shell not attached: no spatial assistant content')
  } catch (e) {
    uiProblems.push(`shell: ${(e as Error).message}`)
    // Give the stage back to the page so the fallback HUD is usable.
    desktopShell?.dispose()
    desktopShell = null
  }
}
if (desktopShell) {
  uiDispatch = dispatch
  importNotice = (text, error) => ui.setNotice(text, error ? 'error' : 'normal')
  // Errors show in the shell's notice (never over the question or the toolbar); the full log stays in diagnostics.
  errorNotice = (msg) => ui.setNotice(`Error: ${msg}`, 'error')
  if (errorsEl.textContent) ui.setNotice(`Error: ${errorsEl.textContent.trim().split('\n').pop()}`, 'error')
  document.body.classList.add('new-ui')
  // Frame the experiment in the part of the stage the question and the context bar leave free (after layout).
  // Within one experiment, viewport and inspector the framing only ever widens its margins (the largest insets
  // seen), so a context card that grows or shrinks never reframes the stage under the pointer, and nothing is
  // refitted during a drag. The content extent is measured once the experiment's scene has settled.
  let insetsQueued = false
  let fitKey = ''
  let latched = { top: 0, right: 0, bottom: 0, left: 0 }
  let measureAt = 0
  const fitStage = () => {
    if (insetsQueued) return
    insetsQueued = true
    requestAnimationFrame(() => {
      insetsQueued = false
      const i = desktopShell?.stageInsets?.()
      if (!i || app.snapshot().dragging) return
      const key = `${app.workspace.current.selection.experimentId}|${innerWidth}x${innerHeight}|${ui.store.state.inspector}`
      if (key !== fitKey) {
        const experimentChanged = fitKey.split('|')[0] !== key.split('|')[0]
        fitKey = key
        latched = { ...i }
        if (experimentChanged) measureAt = performance.now() + 250
      } else latched = { top: Math.max(latched.top, i.top), right: Math.max(latched.right, i.right), bottom: Math.max(latched.bottom, i.bottom), left: Math.max(latched.left, i.left) }
      host.setStageInsets(latched)
    })
  }
  // Measure the shown experiment's extent shortly after it changes (its scene laid out), on the first frame, and
  // after each commit once its motion has settled. Within one experiment the extent only grows (e.g. regrouping
  // the quotient's classes), so the stage zooms out at most once and never pumps.
  let content: { key: string; c: NonNullable<ReturnType<typeof app.stageContent>> } | null = null
  host.onFrame(() => {
    if (!measureAt || performance.now() < measureAt || host.presenting || app.snapshot().dragging) return
    const key = app.workspace.current.selection.experimentId
    // A newly shown experiment is framed at once (its frames and axes are already in place); a change within
    // one is measured after its motion ends.
    if (content?.key === key && app.playback.active) return
    measureAt = 0
    const c = app.stageContent()
    if (!c) return
    if (content && content.key === key) {
      const cur = content.c
      const u = { x0: Math.min(cur.x0, c.x0), x1: Math.max(cur.x1, c.x1), y0: Math.min(cur.y0, c.y0), y1: Math.max(cur.y1, c.y1) }
      // Growth inside the framing margin (a selection lane, a highlight) does not reframe the stage.
      const sx = (cur.x1 - cur.x0) * 0.04
      const sy = (cur.y1 - cur.y0) * 0.04
      if (cur.x0 - u.x0 <= sx && u.x1 - cur.x1 <= sx && cur.y0 - u.y0 <= sy && u.y1 - cur.y1 <= sy) return
      content = { key, c: u }
    } else content = { key, c }
    host.setStageContent(content.c)
  })
  measureAt = performance.now() + 250
  app.workspace.subscribe(() => {
    measureAt = performance.now() + 250
  })
  // Layout flips (narrow/stacked, inspector open) resize the stage: refit after them.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitStage).observe($('app'))
  const render = (v: UiView) => {
    desktopShell!.render(v)
    app.renderSpatialShell(v)
    fitStage()
  }
  ui.subscribe(render)
  render(ui.view)
  window.addEventListener('resize', fitStage)
  // While presenting, the spatial shell is the interface; the page chrome would only cover the mirrored view.
  host.onSession(() => document.body.classList.toggle('presenting', host.presenting))
}
if (uiProblems.length) showError(`UI tracks: ${uiProblems.join('; ')}`)

// ---- HUD (desktop only; never shown in XR). Refreshed from the host loop at ~4 Hz: no extra timer. ----
let hudAt = 0
host.onFrame((ctx) => {
  if (ctx.time - hudAt < 0.25) return
  hudAt = ctx.time
  const s = app.snapshot()
  const pb = s.playback
  const perf = host.perf()
  if (s.domain !== 'linear') {
    statusEl.textContent = [
      `${s.experimentId} (${s.demo}): ${s.scene?.status ?? s.sceneProblem ?? ''}   rev ${s.revision} / math ${s.mathRevision}`,
      `item ${s.item ?? 'none'}   playback ${pb.active ? `${pb.step ? pb.step.label : pb.phase} ${pb.time.toFixed(2)}/${pb.duration}s ${pb.playing ? 'playing' : 'paused'}` : 'idle'}`,
      `frame work p95 ${host.perf().workP95} ms  draws ${host.perf().info.calls}  tris ${host.perf().info.triangles}${host.presenting ? '  · XR' : ''}`,
    ].join('\n')
    return
  }
  statusEl.textContent = [
    `${s.experimentId}: ${s.mapSymbol} = ${JSON.stringify(s.map)}   rev ${s.revision} / math ${s.mathRevision}`,
    `selected ${s.selection} = ${s.selected}   mode ${s.mode}${s.dragging ? `   DRAG ${s.dragging.preview ?? ''}` : ''}`,
    `exact output groups: ${s.collisions.length} with >1 sample; selected shares with ${s.collisions.find((g) => g.includes(s.selection ?? ''))?.filter((x) => x !== s.selection).join(', ') || 'none'}`,
    `transition ${pb.active ? `${pb.step ? pb.step.label : pb.phase} ${pb.time.toFixed(2)}/${pb.duration}s ${pb.playing ? 'playing' : 'paused'}` : 'idle (committed target shown)'}`,
    `frame work p95 ${perf.workP95} ms  interval ${perf.intervalMean} ms  draws ${perf.info.calls}  tris ${perf.info.triangles}`,
    `load ${loadMs} ms  tex ${s.tex.built} built, max ${s.tex.maxMs.toFixed(0)} ms${host.presenting ? '  · XR' : ''}`,
  ].join('\n')
})

// ---- dev / verification hooks ----
type Hand = 'left' | 'right'
const waitFrames = (n: number) =>
  new Promise<void>((resolve) => {
    let k = 0
    const off = host.onFrame(() => {
      if (++k >= n) {
        off()
        resolve()
      }
    })
  })

function aimQuat(from: Vector3, to: Vector3): Quaternion {
  return new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), to.clone().sub(from).normalize())
}

const dev = {
  sceneProblems,
  /** The refined UI: the derived view, the command entry and the transient UI state (never the document). */
  ui: { controller: ui, view: () => ui.view, dispatch, store: ui.store, problems: uiProblems, active: () => !!desktopShell },
  /** The assistant orb's state (the phase it shows and the recording's input level). */
  orb: { phase: () => orbSource?.phase() ?? null, level: () => voice.inputLevel() },
  /** DEV: the passthrough look on the desktop with a bright stand-in wall (not passthrough). */
  passthroughPreview: (on: boolean) => app.setPassthroughPreview(on),
  app,
  assistant,
  evidence,
  voice,
  profile: { report: profileReport, reset: profileReset },
  storage: { saveDocument, loadSaved, exportText, importText, storageDebug, status: () => saveStatus },
  rebind: () => rebindTarget(app.workspace.current),
  host,
  schedulerReport,
  loadMs,
  snapshot: () => app.snapshot(),
  perf: () => host.perf(),
  frameErrors: () => host.errors,
  census: () => app.adapter.census(),
  capabilities: () => app.adapter.capabilities(),
  adapterStats: () => app.adapter.stats,
  log: () => app.log.slice(-40),
  waitFrames,
  checks: { nestedSvg: nestedSvgCheck },
  texDebug,
  clearTexCache,
  clearTokens,
  tokenStats,
  slotStats,
  slots: () => [...app.adapter.slotReport(), ...app.controls.report()],
  verify: makeVerifier(app, host, waitFrames, rafShim),
  device: makeDeviceChecks(app, host, waitFrames),
  /** World position of an input sample's dot (to aim a controller at it). */
  handleWorld: (id = 's(1,0,1)') => {
    const g = app.adapter.viewMathGroup('input')
    g.updateMatrixWorld()
    const s = app.activeSamples().find((x) => x.id === id)!
    return g.localToWorld(new Vector3(...s.coords.map((c) => Number(c.n) / Number(c.d)))).toArray()
  },
  outputWorld: (id = 's(1,0,1)') => {
    const g = app.adapter.viewMathGroup('output')
    g.updateMatrixWorld()
    const rec = (app.adapter as unknown as { dots: { output: Map<string, { mob: { getThreeObject(): { position: Vector3 } } }> } }).dots.output.get(id)!
    return g.localToWorld(rec.mob.getThreeObject().position.clone()).toArray()
  },
  /** Mount/dispose the adapter n times; returns renderer resource counts before and after. */
  async cycle(n = 10) {
    const before = { ...host.perf().info, census: app.adapter.census() }
    for (let i = 0; i < n; i++) {
      await app.remount()
      await waitFrames(2)
    }
    await waitFrames(5)
    return { before, after: { ...host.perf().info, census: app.adapter.census() } }
  },
  xr: {
    enter: () => host.enterXR(),
    exit: () => host.exitXR(),
    device: () => getEmulator(),
    head(pos: [number, number, number], yawDeg = 0, pitchDeg = 0) {
      const d = getEmulator()
      if (!d) throw new Error('no emulator')
      d.position.set(...pos)
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (yawDeg * Math.PI) / 180).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (pitchDeg * Math.PI) / 180))
      d.quaternion.set(q.x, q.y, q.z, q.w)
    },
    aim(hand: Hand, from: [number, number, number], at: [number, number, number]) {
      const c = getEmulator()?.controllers[hand]
      if (!c) throw new Error('no emulated controller')
      const q = aimQuat(new Vector3(...from), new Vector3(...at))
      c.position.set(...from)
      c.quaternion.set(q.x, q.y, q.z, q.w)
    },
    async button(hand: Hand, id: 'trigger' | 'squeeze' | 'a-button' | 'b-button' | 'x-button' | 'y-button', value: 0 | 1, frames = 2) {
      const c = getEmulator()?.controllers[hand]
      if (!c) throw new Error('no emulated controller')
      c.updateButtonValue(id, value)
      await waitFrames(frames)
    },
    /** Hold the emulated thumbstick at vertical deflection y (-1 up .. 1 down) for `frames`, then release it. */
    async stick(hand: Hand, y: number, frames = 30) {
      const c = getEmulator()?.controllers[hand]
      if (!c) throw new Error('no emulated controller')
      c.updateAxes('thumbstick', 0, y)
      await waitFrames(frames)
      c.updateAxes('thumbstick', 0, 0)
      await waitFrames(2)
    },
  },
  /** Record the canvas (both eyes when presenting in the emulator) and save it via the dev server. */
  async record(seconds = 10, name = 'capture') {
    const canvas = host.renderer.domElement
    const stream = canvas.captureStream(30)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6_000_000 })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise<void>((r) => (rec.onstop = () => r()))
    rec.start(500)
    await new Promise((r) => setTimeout(r, seconds * 1000))
    rec.stop()
    await done
    const blob = new Blob(chunks, { type: 'video/webm' })
    const res = await fetch('/__mw/recording', { method: 'POST', headers: { 'x-mw-name': name }, body: blob })
    return { bytes: blob.size, saved: await res.text() }
  },
}
;(window as unknown as { __mw: typeof dev }).__mw = dev
