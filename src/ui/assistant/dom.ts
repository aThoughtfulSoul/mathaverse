// Desktop content of the Ask Meta Muse AI inspector (UI-REFINEMENT-SPEC section 7). The shell draws the frame
// (title "Ask Meta Muse AI" and its close control); this fills the frame's body, in order: the actual service
// and voice source, suggested questions when nothing is in progress, the latest exchange (with the
// application-computed facts of an answer about a walk endpoint, and the live Lean check line of an answer
// that requested a check), and the input controls (question field, microphone, Send). Plain DOM with one
// scoped <style>; no framework. It also puts one empty slot for the assistant's orb (filled elsewhere) into the
// frame's header, immediately before the title text; it has no content or behaviour of its own.
//
// The voice area (the foot) holds the orb's stage (data-assistant="orb-stage", empty and aria-hidden) directly above
// the input rows, after the middle, in the wide panel and the stacked drawer alike (never inside the pinned rows).
// The stage has room only when this content gives it some (data-room, --mwa-stage-room); the orb
// (src/ui/orb/desktop.ts) flies in when that room is more than 40 px and marks the stage while it is there
// (data-open) or flying home from it (data-leaving). When the suggestions on screen give way to work on the
// learner's words (a recording, a typed question), the stage takes exactly the room they leave, in their place, and
// at every render until that work ends it absorbs whatever else changed (the exchange, the voice status, the
// transcript, a stage still easing closed), so neither the answer above it nor the input rows (the microphone, Stop,
// Send) move; this needs no orb. While the question is pending (sent with Send or Enter) the stage keeps at least
// STAGE_MIN in a body that does not scroll (the orb's box through Thinking): when less is left, the input rows move
// down once, eased, and the stage has that room from the first frame (the bottom of the middle, "Thinking…", is
// revealed as they move). A new answer ends it at once: the answer and its follow-ups show, and while the orb lingers
// (the bloom) the stage keeps what is left of its room (the orb's 150 px if less is left), then closes, eased, as the
// orb leaves (with no orb on it, or when the body then scrolls, at once: the answer's arrival is the one thing that
// moves). With no new answer (a voice cancel or error, a request canceled) nothing moves while the orb is on the stage
// or flying home: the suggestions wait, and take the stage's room back in the frame it lands; whatever they do not
// fill exactly (an exchange that changed, the voice status still shown) eases. Every move here eases in this
// content's own frames (data-easing on the stage while one runs; at once under prefers-reduced-motion), and a render
// keeps the body's scroll position. Only the stage's part in view is its box (what the pinned rows cover, or the body
// has scrolled away above it, is a margin), so the orb never lands under the rows or half out of view: in a
// scrolling body (the stacked drawer at 820 x 1100, or a wide panel whose answer overflows) it often has too little
// room and stays in the header, and the stage covers nothing either way. The voice status line sits under the input
// row while the body does not scroll and above it while it does (data-voice; decided only while no status is shown,
// or as an answer arrives), so it grows away from the microphone: downward in flow, upward from the pinned rows.
//
// Every control emits a UiCommand through the dispatch it was given; nothing here calls a client. The draft is
// mirrored to {action:'draft'} as it is typed and restored from input.draft; it is sent only by Send/Enter. The
// microphone keeps the existing push-to-talk behaviour (src/voice/panel.ts bindPushToTalk): hold while
// speaking, or press once to start and again to stop. Keys typed in the fields, and Space/Enter on the
// panel's buttons, never reach the scene shortcuts.

import { bindPushToTalk } from '../../voice/panel'
import type { AssistantPanelInput, DomPanelContent, UiCommand, UiDispatch } from '../model'
import { type AssistantView, type ExchangeView, type Tone, MIC_RECORD_NAME, QUESTION_FIELD_NAME, QUESTION_PLACEHOLDER, assistantView } from './view'

const STYLE = `
.mwa { --mwa-teal: #45d0bf; --mwa-amber: #ffd98a; --mwa-rose: #ff9fae; --mwa-ok: #8fe3b6; --mwa-line: var(--line, #2a3243); --mwa-dim: var(--dim, #9aa3b5);
  /* The sticky input block: the panel's colour on an opaque base (no ghost of the text scrolled under it). */
  --mwa-foot-bg: linear-gradient(var(--mw-panel-strong, rgba(16, 21, 32, 0.97)), var(--mw-panel-strong, rgba(16, 21, 32, 0.97))) #10151f;
  display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box;
  color: var(--text, #e9edf5); font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.mwa * { box-sizing: border-box; }
.mwa [hidden] { display: none !important; }
.mwa p { margin: 0; }
.mwa-source { display: grid; gap: 4px; }
.mwa-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.mwa-chip { font-size: 12px; font-weight: 600; line-height: 1.5; padding: 1px 9px; border-radius: 999px; border: 1px solid var(--mwa-line); color: var(--mwa-dim); }
.mwa-chip[data-kind="synthetic"] { color: var(--mwa-amber); border-color: rgba(255, 201, 92, 0.45); background: rgba(255, 201, 92, 0.09); }
.mwa-chip[data-kind="live-verified"] { color: #7fe6d8; border-color: rgba(69, 208, 191, 0.5); background: rgba(69, 208, 191, 0.1); }
.mwa-chip[data-kind="live-unverified"] { color: #c3cddd; border-color: #3a4558; background: rgba(255, 255, 255, 0.04); }
.mwa-chip[data-kind="unavailable"] { color: var(--mwa-rose); border-color: rgba(255, 111, 145, 0.5); background: rgba(255, 111, 145, 0.09); }
.mwa-small { font-size: 12.5px; color: var(--mwa-dim); }
.mwa-h { margin: 0 0 8px; font-size: 12.5px; font-weight: 500; color: var(--mwa-dim); }
.mwa-sugg ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.mwa-sugg button { width: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer; display: grid; grid-template-columns: 1fr auto; column-gap: 10px; align-items: center;
  padding: 10px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.035); border: 1px solid var(--mwa-line); }
.mwa-sugg button:hover { border-color: rgba(69, 208, 191, 0.55); background: rgba(69, 208, 191, 0.07); }
.mwa-sugg button:focus-visible, .mwa-btn:focus-visible, .mwa-mic:focus-visible { outline: 2px solid var(--mwa-teal); outline-offset: 2px; }
.mwa-sugg .t { font-size: 14px; }
.mwa-sugg .n { grid-column: 1; font-size: 12px; color: var(--mwa-dim); }
.mwa-sugg .c { grid-column: 2; grid-row: 1 / span 2; color: var(--mwa-dim); font-size: 16px; }
.mwa-mid { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; margin: 0 -4px; padding: 0 4px; }
.mwa-exchange { display: grid; align-content: start; gap: 8px; padding-top: 12px; border-top: 1px solid var(--mwa-line); }
.mwa-exchange:empty { display: none; }
.mwa-head { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.mwa-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--mwa-dim); }
.mwa [data-tone="busy"] .mwa-dot { background: var(--mwa-teal); }
.mwa [data-tone="ok"] .mwa-dot { background: var(--mwa-ok); }
.mwa [data-tone="warning"] .mwa-dot { background: #ffc95c; }
.mwa [data-tone="error"] .mwa-dot { background: #ff6f91; }
.mwa-q { font-size: 13px; color: var(--mwa-dim); overflow-wrap: anywhere; }
.mwa-title { margin: 0; font-size: 15px; font-weight: 600; }
.mwa-expl { white-space: pre-wrap; overflow-wrap: anywhere; }
.mwa-changes { margin: 0; padding-left: 18px; font-size: 13px; }
/* The requested Lean check as the app's evidence store reports it (updated in place, never before the store). */
.mwa-check { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; padding: 6px 8px; border-radius: 8px; border: 1px solid transparent; background: rgba(255, 255, 255, 0.03); }
.mwa-check[data-tone="ok"] .t { color: var(--mwa-ok); }
.mwa-check[data-tone="warning"] .t { color: var(--mwa-amber); }
.mwa-check[data-tone="error"] .t { color: var(--mwa-rose); }
.mwa-check[data-current="false"] { border-style: dashed; border-color: rgba(255, 201, 92, 0.5); }
/* The orb's slot in the frame header, before the title: a fixed 40 x 40 box (it does not grow the header). */
.mwa-orb-slot { display: inline-flex; flex: none; width: 40px; height: 40px; margin-block: -8px; align-items: center; justify-content: center; }
.mw-insp-card[data-mode="math"] .mwa-orb-slot { display: none; }
/* Application-computed facts beside the model's prose (same quiet box as the provenance line). */
.mwa-facts { display: grid; gap: 4px; font-size: 13px; padding: 7px 9px; border-radius: 8px; border: 1px solid rgba(69, 208, 191, 0.35); background: rgba(255, 255, 255, 0.03); }
.mwa-facts[data-current="false"] { border-style: dashed; border-color: rgba(255, 201, 92, 0.5); }
.mwa-facts .head { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; }
.mwa-facts .lab { font-size: 12px; font-weight: 600; color: #7fe6d8; }
.mwa-facts[data-current="false"] .lab { color: var(--mwa-amber); }
.mwa-facts .det { font-size: 12px; color: var(--mwa-dim); }
.mwa-facts .note { font-size: 12.5px; color: var(--mwa-amber); }
.mwa-facts dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: baseline; }
.mwa-facts dl > div { display: contents; }
.mwa-facts dt { font-size: 12px; color: var(--mwa-dim); }
.mwa-facts dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.mwa-prov { font-size: 12px; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; padding: 6px 8px; border-radius: 8px; background: rgba(255, 255, 255, 0.03); }
.mwa-prov .lab { font-weight: 600; }
.mwa-prov[data-live="false"] .lab { color: var(--mwa-amber); }
.mwa-prov[data-live="true"] .lab { color: #7fe6d8; }
.mwa-prov .det { color: var(--mwa-dim); }
.mwa-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mwa-btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; border: 1px solid #34405a; background: #1a2130; color: var(--text, #e9edf5); cursor: pointer; }
.mwa-btn:hover:not(:disabled) { background: #222b3d; }
.mwa-btn.primary { background: var(--mwa-teal); border-color: var(--mwa-teal); color: #062521; font-weight: 600; }
.mwa-btn.primary:hover:not(:disabled) { background: #5fe0d0; }
.mwa-btn:disabled, .mwa-btn.primary:disabled { opacity: 1; background: #1a2130; border-color: #2a3243; color: #6f7a8f; font-weight: 500; cursor: not-allowed; }
.mwa[data-layout="after"] .mwa-sugg { padding-top: 10px; border-top: 1px solid var(--mwa-line); }
.mwa[data-layout="after"] .mwa-sugg ul { gap: 6px; }
.mwa[data-layout="after"] .mwa-sugg button { padding: 7px 10px; }
.mwa[data-layout="after"] .mwa-sugg .t { font-size: 13px; }
.mwa[data-layout="after"] .mwa-sugg .n { display: none; }
.mwa[data-layout="after"] .mwa-h { margin-bottom: 6px; }
.mwa-voicerow { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
.mwa-voicerow[hidden] { display: none; }
/* The question field and voice controls (the input rows) stay in view at the bottom of the panel's body while the
   suggestions and the answer scroll above them. The foot only groups (display: contents) the stage, directly above
   the rows, and the rows. The voice status sits under the input row in a body that does not scroll and above it in
   one that does (data-voice), so it never moves the microphone. */
.mwa-source { order: 0; }
.mwa-mid { order: 1; }
.mwa-foot { display: contents; }
.mwa-foot-rows { order: 3; display: grid; gap: 8px; min-width: 0; position: sticky; bottom: 0; z-index: 1; padding: 8px 0 10px; background: var(--mwa-foot-bg); }
.mwa-foot-rows > .mwa-voicerow { order: 1; }
.mwa[data-voice="above"] .mwa-foot-rows > .mwa-voicerow { order: 0; }
/* The orb's stage: no room (its margin cancels the content gap) until the content gives it some (data-room): then
   exactly --mwa-stage-room, of which the part the pinned rows cover (--mwa-stage-cut) and the part scrolled away above
   the body (--mwa-stage-top) are margins. Below minus the gap the rows stand over the end of the content above for a
   moment (a move still easing). No transition: the content eases the room in its own frames, so each frame's box is
   the one the orb reads. */
.mwa-orb-stage { order: 2; flex: none; display: flex; align-items: center; justify-content: center; height: 0; margin: -14px 0 0; }
.mwa-orb-stage[data-room="on"] { height: max(0px, calc(var(--mwa-stage-room, 0px) - var(--mwa-stage-cut, 0px) - var(--mwa-stage-top, 0px)));
  margin: calc(min(0px, var(--mwa-stage-room, 0px)) + var(--mwa-stage-top, 0px)) 0 var(--mwa-stage-cut, 0px); }
.mwa-voice { flex: 1; font-size: 12.5px; color: var(--mwa-dim); }
.mwa-voice[data-tone="error"] { color: var(--mwa-rose); }
.mwa-voice[data-tone="busy"] { color: #bfeee7; }
/* The field asks for room for its whole placeholder (about 13 em of text, plus the microphone); a narrower panel
   moves Send below it instead of clipping the placeholder. */
.mwa-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; align-items: center; }
/* Send keeps one width enabled (bold) or disabled, so the field and its microphone never shift as a draft starts. */
.mwa-row > .mwa-btn { min-width: 60px; }
.mwa-field { flex: 1 1 18em; min-width: 0; display: flex; align-items: center; gap: 4px; border: 1px solid #34405a; border-radius: 12px; background: rgba(11, 14, 21, 0.6); padding: 3px 3px 3px 12px; }
.mwa-field:focus-within { border-color: var(--mwa-teal); }
.mwa-field input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; padding: 8px 0; text-overflow: ellipsis; }
.mwa-field input::placeholder { color: #7f899c; text-overflow: ellipsis; }
.mwa-field input:disabled { opacity: 0.5; }
.mwa-mic { flex: none; min-width: 36px; height: 34px; padding: 0 8px; border-radius: 9px; border: 0; background: transparent; color: var(--mwa-dim); display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-size: 13px; cursor: pointer; }
.mwa-mic:hover:not(:disabled) { color: var(--text, #e9edf5); background: rgba(255, 255, 255, 0.06); }
.mwa-mic:disabled { opacity: 0.4; cursor: not-allowed; }
.mwa-mic[data-mode="stop"] { background: #5b2433; color: #ffd0d8; }
.mwa-mic[data-mode="stop"]::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: #ff6b81; }
.mwa-mic[data-mode="cancel"] { background: #2a3243; color: var(--text, #e9edf5); }
.mwa-mic svg { width: 18px; height: 18px; }
.mwa-transcript { display: grid; gap: 6px; padding: 10px; border-radius: 10px; border: 1px solid rgba(69, 208, 191, 0.35); background: rgba(69, 208, 191, 0.05); }
.mwa-transcript textarea { width: 100%; min-height: 48px; resize: vertical; font: inherit; color: inherit; background: rgba(11, 14, 21, 0.6); border: 1px solid #34405a; border-radius: 8px; padding: 6px 8px; }
.mwa-transcript textarea:focus { outline: none; border-color: var(--mwa-teal); }
`

const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>'

type El = HTMLElement

/** The content's gap between blocks (.mwa gap), CSS px. */
const CONTENT_GAP = 14
/** The most room the stage keeps for an orb that lingers after a new answer (the orb's size on the stage, CSS px). */
const STAGE_KEEP = 150
/** The least room the stage keeps while the question is pending, in a body that does not scroll (CSS px). */
const STAGE_MIN = 120
/** How long this content's own moves take (the input rows making the stage's room, the stage closing; ms). */
const STAGE_EASE_MS = 400
/** Assistant states that answer a request (a new one ends the stage's hold at once; see render). */
const ANSWERS: ReadonlySet<string> = new Set(['applied', 'answered', 'stale', 'rejected', 'error'])

/** Ease in and out (smoothstep): no first-frame jump, and the steepest step is 1.5 times the average. */
const smooth = (k: number) => k * k * (3 - 2 * k)

/** The element's layout box, or null where there is no layout (a test DOM). */
function box(el: Element): DOMRect | null {
  return typeof (el as HTMLElement).getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
}

/** The element's inline style, where there is one (a test DOM may have none). */
const styleOf = (el: Element) => (el as { style?: CSSStyleDeclaration }).style

const hasClass = (el: Element, cls: string) => ` ${String(el.className)} `.includes(` ${cls} `)

/** The request an assistant state answers (its requestId), or null: not an answer. */
function answerOf(input: AssistantPanelInput): string | null {
  const a = input.assistant
  return ANSWERS.has(a.kind) && 'requestId' in a ? a.requestId : null
}

/** The shell frame's scrolling body around this content, else null. */
function frameBody(container: HTMLElement): HTMLElement | null {
  for (let n: HTMLElement | null = container; n; n = n.parentElement) if (hasClass(n, 'mw-insp-body')) return n
  return null
}

/** The shell frame's title element ("Ask Meta Muse AI") when this content sits in the frame, else null. */
function frameTitle(container: HTMLElement): HTMLElement | null {
  for (let n: HTMLElement | null = container.parentElement; n; n = n.parentElement) {
    if (!hasClass(n, 'mw-insp-card')) continue
    const head = Array.from(n.children).find((c) => hasClass(c, 'mw-insp-head'))
    return ((head && Array.from(head.children).find((c) => hasClass(c, 'mw-insp-title'))) as HTMLElement | undefined) ?? null
  }
  return null
}

export function createAssistantDomContent(dispatch: UiDispatch): DomPanelContent {
  let root: El | null = null
  let last: AssistantPanelInput | null = null
  let view: AssistantView | null = null
  const offs: (() => void)[] = []
  let tick: ReturnType<typeof setInterval> | null = null
  const keys = { source: '', sugg: '', exchange: '', transcriptFor: '' }
  let layout: 'before' | 'after' = 'before'
  /** The last draft this content dispatched, and the last draft the view carried (see syncDraft). */
  let dispatchedDraft = ''
  let seenDraft: string | null = null

  // Elements (created in mount).
  let sourceEl: El, midEl: El, suggEl: El, suggHead: El, suggList: El, suggHint: El, exchangeEl: El, foot: El, footRows: El, stageEl: El, voiceRow: El, voiceEl: El, transcriptEl: El, transcriptLabel: El
  let transcriptText: HTMLTextAreaElement, transcriptSend: HTMLButtonElement, transcriptCancel: HTMLButtonElement
  let inputRow: El, field: HTMLInputElement, mic: HTMLButtonElement, recCancel: HTMLButtonElement, send: HTMLButtonElement
  let orbSlot: El | null = null
  /** The frame's scrolling body (the shell's), when this content sits in the frame. */
  let body: HTMLElement | null = null
  /** The stage holds the room for work on the learner's words (see render): the answer shown when that began. */
  let hold: { from: string | null } | null = null
  /** The stage's room once the move still to come has eased (CSS px), or null: none. */
  let room: number | null = null
  /** The input rows' move still to come (px, + down), easing to 0 from `from` since `t0` (see left()). */
  let ease: { from: number; t0: number } | null = null
  /** The stage's room as laid out now (--mwa-stage-room; minus the gap: none). */
  let shown = -CONTENT_GAP
  /** The window this content is laid out in (its frames and clock), and its reduced-motion query. */
  let win: (Window & typeof globalThis) | null = null
  let reduce: { matches: boolean } | null = null
  let easeFrame = 0
  /** The suggestions were on screen after the last render (a hold begins only when they give way). */
  let suggShown = false
  /** The current exchange's check line (rebuilt with the exchange, its text updated in place). */
  let checkEl: El | null = null
  let checkText: El | null = null
  /** The current exchange's action buttons by id (rebuilt with the exchange, enabled or not in place). */
  const actionEls = new Map<string, HTMLButtonElement>()

  const run = (cmd: UiCommand | null) => {
    if (cmd) dispatch(cmd)
  }

  function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = doc.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  function on<T extends Event>(el: EventTarget, type: string, fn: (e: T) => void): void {
    el.addEventListener(type, fn as EventListener)
    offs.push(() => el.removeEventListener(type, fn as EventListener))
  }

  function mount(container: HTMLElement): void {
    if (root) dispose()
    const doc = container.ownerDocument
    root = make(doc, 'div', 'mwa')
    root.setAttribute('data-assistant', 'content')
    root.setAttribute('data-layout', 'before')
    root.setAttribute('data-hold', 'off')
    root.setAttribute('data-voice', 'below')
    const style = make(doc, 'style')
    style.textContent = STYLE

    sourceEl = make(doc, 'section', 'mwa-source')
    sourceEl.setAttribute('data-assistant', 'source')
    sourceEl.setAttribute('aria-label', 'Assistant source')

    suggEl = make(doc, 'section', 'mwa-sugg')
    suggEl.setAttribute('data-assistant', 'suggestions')
    suggHead = make(doc, 'h3', 'mwa-h', 'Suggested questions')
    suggHead.id = 'mwa-sugg-h'
    suggList = make(doc, 'ul')
    suggList.setAttribute('aria-labelledby', 'mwa-sugg-h')
    suggHint = make(doc, 'p', 'mwa-small')
    suggHint.setAttribute('data-assistant', 'suggestion-hint')
    suggEl.append(suggHead, suggList, suggHint)

    exchangeEl = make(doc, 'section', 'mwa-exchange')
    exchangeEl.setAttribute('data-assistant', 'exchange')
    exchangeEl.setAttribute('aria-live', 'polite')
    exchangeEl.setAttribute('aria-label', 'Latest request')

    foot = make(doc, 'div', 'mwa-foot')
    footRows = make(doc, 'div', 'mwa-foot-rows')
    // The orb's stage: empty here; it has room only when the content gives it some, and the orb draws in it then.
    stageEl = make(doc, 'div', 'mwa-orb-stage')
    stageEl.setAttribute('data-assistant', 'orb-stage')
    stageEl.setAttribute('aria-hidden', 'true')
    stageEl.setAttribute('data-room', 'off')
    voiceRow = make(doc, 'div', 'mwa-voicerow')
    voiceEl = make(doc, 'p', 'mwa-voice')
    voiceEl.setAttribute('data-assistant', 'voice-status')
    voiceEl.setAttribute('aria-live', 'polite')

    transcriptEl = make(doc, 'div', 'mwa-transcript')
    transcriptEl.setAttribute('data-assistant', 'transcript')
    transcriptLabel = make(doc, 'label', 'mwa-small')
    transcriptLabel.setAttribute('for', 'mwa-transcript-text')
    transcriptText = make(doc, 'textarea')
    transcriptText.id = 'mwa-transcript-text'
    transcriptText.rows = 2
    transcriptText.setAttribute('maxlength', '2000')
    transcriptText.setAttribute('aria-label', 'Transcript (edit before sending)')
    const tActions = make(doc, 'div', 'mwa-actions')
    transcriptSend = make(doc, 'button', 'mwa-btn primary', 'Send')
    transcriptSend.type = 'button'
    transcriptSend.setAttribute('aria-label', 'Send the transcript to Meta Muse AI')
    transcriptCancel = make(doc, 'button', 'mwa-btn', 'Cancel')
    transcriptCancel.type = 'button'
    transcriptCancel.setAttribute('aria-label', 'Discard the transcript')
    tActions.append(transcriptSend, transcriptCancel)
    transcriptEl.append(transcriptLabel, transcriptText, tActions)

    inputRow = make(doc, 'div', 'mwa-row')
    inputRow.setAttribute('data-assistant', 'input')
    const fieldWrap = make(doc, 'div', 'mwa-field')
    field = make(doc, 'input')
    field.type = 'text'
    field.setAttribute('aria-label', QUESTION_FIELD_NAME)
    field.placeholder = QUESTION_PLACEHOLDER
    field.setAttribute('maxlength', '2000')
    field.setAttribute('autocomplete', 'off')
    field.setAttribute('data-assistant', 'question')
    mic = make(doc, 'button', 'mwa-mic')
    mic.type = 'button'
    mic.setAttribute('data-assistant', 'mic')
    fieldWrap.append(field, mic)
    recCancel = make(doc, 'button', 'mwa-btn', 'Cancel')
    recCancel.type = 'button'
    recCancel.setAttribute('aria-label', 'Cancel recording')
    recCancel.setAttribute('data-assistant', 'record-cancel')
    send = make(doc, 'button', 'mwa-btn primary', 'Send')
    send.type = 'button'
    send.setAttribute('aria-label', 'Send the question to Meta Muse AI')
    send.setAttribute('data-assistant', 'send')
    inputRow.append(fieldWrap, send)
    voiceRow.append(voiceEl, recCancel)
    footRows.append(voiceRow, transcriptEl, inputRow)
    foot.append(stageEl, footRows)

    // The middle scrolls (suggestions and the latest exchange); the source and the input controls stay put.
    midEl = make(doc, 'div', 'mwa-mid')
    midEl.append(suggEl, exchangeEl)
    // The orb's slot: exactly one empty span, immediately before the frame's title text (or, outside the
    // shell's frame, at the top of this content).
    orbSlot = make(doc, 'span', 'mwa-orb-slot')
    orbSlot.setAttribute('data-assistant', 'orb-slot')
    orbSlot.setAttribute('aria-hidden', 'true')
    const title = frameTitle(container)
    root.append(style, ...(title ? [] : [orbSlot]), sourceEl, midEl, foot)
    if (title) title.parentElement!.insertBefore(orbSlot, title)
    layout = 'before'
    hold = room = ease = null
    shown = -CONTENT_GAP
    suggShown = false
    container.append(root)

    // The orb comes to and leaves the stage between panel renders: lay out again when it does (suggestions waiting
    // for it come back in the frame it lands).
    win = (doc.defaultView as (Window & typeof globalThis) | null) ?? null
    try {
      reduce = win?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    } catch {
      reduce = null
    }
    const MO = win?.MutationObserver
    if (typeof MO === 'function') {
      const mo = new MO(() => {
        if (last && root) render(last)
      })
      mo.observe(stageEl, { attributes: true, attributeFilter: ['data-open', 'data-leaving'] })
      offs.push(() => mo.disconnect())
    }
    // The stage's part in view follows the body's scrolling and size (no panel render comes with those). A resize is
    // followed in the next frame, never from the observer itself (its layout change would be a resize loop).
    body = frameBody(container)
    if (body) on(body, 'scroll', () => fitCut())
    const RO = win?.ResizeObserver
    const w = win
    if (typeof RO === 'function' && w && typeof w.requestAnimationFrame === 'function') {
      let raf = 0
      const ro = new RO(() => {
        if (!raf) raf = w.requestAnimationFrame(() => ((raf = 0), fitCut()))
      })
      ro.observe(root)
      if (body) ro.observe(body)
      offs.push(() => {
        ro.disconnect()
        if (raf) w.cancelAnimationFrame(raf)
      })
    }

    // ---- keyboard: typed keys never reach the scene shortcuts ----
    const stopField = (e: KeyboardEvent) => e.stopPropagation()
    on<KeyboardEvent>(root, 'keydown', (e) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toUpperCase() ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') e.stopPropagation()
      else if ((e.key === ' ' || e.key === 'Enter') && tag === 'BUTTON') e.stopPropagation()
    })
    on<KeyboardEvent>(root, 'keyup', (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toUpperCase() ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') e.stopPropagation()
    })
    on<KeyboardEvent>(field, 'keypress', stopField)

    // ---- question field: draft mirrored as typed; sent only by Send / Enter ----
    on(field, 'input', () => {
      dispatchedDraft = field.value
      dispatch({ kind: 'assistant', action: { kind: 'draft', text: field.value } })
      send.disabled = !(view?.input.enabled && field.value.trim())
    })
    const submit = () => {
      const text = field.value.trim()
      if (!text || !view?.input.enabled) return
      dispatch({ kind: 'assistant', action: { kind: 'ask', text: field.value } })
    }
    on<KeyboardEvent>(field, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        submit()
      }
    })
    on(send, 'click', submit)

    // ---- microphone: hold to talk, or press to start and again to stop ----
    offs.push(bindPushToTalk(mic, {
      recording: () => last?.voice.kind === 'recording',
      acquiring: () => !!last?.voiceAcquiring,
      transcribing: () => last?.voice.kind === 'transcribing',
      start: () => {
        if (view?.voice.mic.mode === 'record' && view.voice.mic.enabled) dispatch({ kind: 'assistant', action: { kind: 'voiceStart' } })
      },
      stop: () => dispatch({ kind: 'assistant', action: { kind: 'voiceStop' } }),
      cancel: () => dispatch({ kind: 'assistant', action: { kind: 'voiceCancel' } }),
      toggle: () => {
        const m = view?.voice.mic
        if (!m || !m.enabled) return
        const action = m.mode === 'stop' ? 'voiceStop' : m.mode === 'cancel' ? 'voiceCancel' : 'voiceStart'
        dispatch({ kind: 'assistant', action: { kind: action } })
      },
    }))
    on(recCancel, 'click', () => run(view?.voice.cancel?.command ?? null))

    // ---- transcript correction (desktop keeps edit + Send) ----
    on(transcriptText, 'input', () => dispatch({ kind: 'assistant', action: { kind: 'transcriptEdit', text: transcriptText.value } }))
    on<KeyboardEvent>(transcriptText, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        sendTranscript()
      } else if (e.key === 'Escape') {
        run(view?.voice.cancel?.command ?? null)
      }
    })
    const sendTranscript = () => {
      if (!view?.voice.send || !transcriptText.value.trim()) return
      dispatch({ kind: 'assistant', action: { kind: 'transcriptSubmit', text: transcriptText.value } })
    }
    on(transcriptSend, 'click', sendTranscript)
    on(transcriptCancel, 'click', () => run(view?.voice.cancel?.command ?? null))

    if (last) render(last)
  }

  // ------------------------------------------------------------------ rendering

  function renderSource(v: AssistantView): void {
    const key = JSON.stringify([v.source, v.speech])
    if (key === keys.source) return
    keys.source = key
    const doc = sourceEl.ownerDocument
    const chips = make(doc, 'div', 'mwa-chips')
    const chip = make(doc, 'span', 'mwa-chip', v.source.label)
    chip.setAttribute('data-kind', v.source.kind)
    chips.append(chip)
    if (v.source.secondary) chips.append(make(doc, 'span', 'mwa-chip', v.source.secondary))
    const detail = make(doc, 'p', 'mwa-small', v.source.detail)
    const speech = make(doc, 'p', 'mwa-small', `${v.speech.label}${v.speech.available ? '' : `: ${v.speech.detail}`}`)
    speech.setAttribute('data-assistant', 'speech')
    if (v.speech.available) speech.title = v.speech.detail
    sourceEl.replaceChildren(chips, detail, speech)
  }

  function renderSuggestions(v: AssistantView): void {
    const key = JSON.stringify([v.suggestions.map((s) => [s.id, s.text, s.note]), v.suggestionHint])
    suggEl.hidden = v.suggestions.length === 0 && !v.suggestionHint
    if (key === keys.sugg) return
    keys.sugg = key
    const doc = suggList.ownerDocument
    suggHint.textContent = v.suggestionHint ?? ''
    suggHint.hidden = !v.suggestionHint
    suggList.replaceChildren(...v.suggestions.map((s) => {
      const li = make(doc, 'li')
      const b = make(doc, 'button')
      b.type = 'button'
      b.setAttribute('data-assistant', 'suggestion')
      b.setAttribute('data-suggestion', s.id)
      b.append(make(doc, 'span', 't', s.text))
      if (s.note) b.append(make(doc, 'span', 'n', s.note))
      const c = make(doc, 'span', 'c', '›')
      c.setAttribute('aria-hidden', 'true')
      b.append(c)
      b.addEventListener('click', () => dispatch(s.command))
      li.append(b)
      return li
    }))
  }

  /** The check line follows the evidence store without rebuilding (or scrolling) the rest of the answer. */
  function renderCheck(c: ExchangeView['check']): void {
    if (!checkEl || !checkText || !c) return
    if (checkText.textContent !== c.text) checkText.textContent = c.text
    checkEl.setAttribute('data-tone', c.tone)
    checkEl.setAttribute('data-phase', c.phase)
    checkEl.setAttribute('data-current', String(c.current))
  }

  function renderExchange(x: ExchangeView | null): void {
    const key = JSON.stringify(x && { ...x, check: x.check ? true : null, actions: x.actions.map((a) => [a.id, a.label]) })
    if (key === keys.exchange) {
      renderCheck(x?.check ?? null)
      if (x) renderActions(x)
      return
    }
    keys.exchange = key
    checkEl = checkText = null
    actionEls.clear()
    if (!x) {
      exchangeEl.replaceChildren()
      return
    }
    const doc = exchangeEl.ownerDocument
    const parts: El[] = []
    const head = make(doc, 'div', 'mwa-head')
    head.setAttribute('data-tone', x.tone)
    head.setAttribute('data-assistant', 'request-status')
    head.append(make(doc, 'span', 'mwa-dot'), make(doc, 'span', '', x.heading))
    parts.push(head)
    const q = make(doc, 'p', 'mwa-q', `You asked: “${x.question}”`)
    parts.push(q)
    if (x.reason) parts.push(make(doc, 'p', 'mwa-small', x.reason))
    if (x.title) parts.push(make(doc, 'h4', 'mwa-title', x.title))
    if (x.explanation) parts.push(make(doc, 'p', 'mwa-expl', x.explanation))
    if (x.facts) {
      const f = x.facts
      const box = make(doc, 'section', 'mwa-facts')
      box.setAttribute('data-assistant', 'facts')
      box.setAttribute('data-current', String(f.current))
      box.setAttribute('aria-label', `${f.label}: ${f.endpoint}`)
      const head = make(doc, 'p', 'head')
      head.append(make(doc, 'span', 'lab', f.label), make(doc, 'span', 'det', f.detail))
      box.append(head)
      if (f.note) {
        const n = make(doc, 'p', 'note', f.note)
        n.setAttribute('data-assistant', 'facts-historical')
        box.append(n)
      }
      const dl = make(doc, 'dl')
      for (const r of f.rows) {
        const row = make(doc, 'div')
        row.append(make(doc, 'dt', '', r.label), make(doc, 'dd', '', r.text))
        dl.append(row)
      }
      box.append(dl)
      parts.push(box)
    }
    if (x.changes.length) {
      const ul = make(doc, 'ul', 'mwa-changes')
      ul.setAttribute('aria-label', 'Validated changes')
      for (const c of x.changes) ul.append(make(doc, 'li', '', c))
      parts.push(ul)
    }
    if (x.check) {
      checkEl = make(doc, 'p', 'mwa-check')
      checkEl.setAttribute('data-assistant', 'check-status')
      checkText = make(doc, 'span', 't')
      checkEl.append(make(doc, 'span', 'mwa-dot'), checkText)
      parts.push(checkEl)
    }
    if (x.provenance) {
      const p = make(doc, 'p', 'mwa-prov')
      p.setAttribute('data-live', String(x.provenance.live))
      p.setAttribute('data-assistant', 'provenance')
      p.append(make(doc, 'span', 'lab', x.provenance.label), make(doc, 'span', 'det', x.provenance.detail))
      parts.push(p)
    }
    if (x.note) parts.push(make(doc, 'p', 'mwa-small', x.note))
    if (x.actions.length) {
      const row = make(doc, 'div', 'mwa-actions')
      for (const a of x.actions) {
        const b = make(doc, 'button', `mwa-btn${a.id === 'retry' ? ' primary' : ''}`, a.label)
        b.type = 'button'
        b.setAttribute('aria-label', a.ariaLabel)
        b.setAttribute('data-assistant', `action-${a.id}`)
        b.addEventListener('click', () => {
          if (!b.disabled) dispatch(a.command)
        })
        actionEls.set(a.id, b)
        row.append(b)
      }
      parts.push(row)
    }
    exchangeEl.replaceChildren(...parts)
    renderCheck(x.check)
    renderActions(x)
    midEl.scrollTop = 0
  }

  /** An action offered but not usable now (Edit question while a draft exists) stays in place, disabled. */
  function renderActions(x: ExchangeView): void {
    for (const a of x.actions) {
      const b = actionEls.get(a.id)
      if (!b) continue
      b.disabled = !!a.disabled
      b.title = a.disabled ?? ''
    }
  }

  function renderVoiceStatus(): void {
    const v = view
    if (!v) return
    let text = v.voice.status ?? ''
    if (v.voice.phase === 'recording' && v.voice.recordingStartedAt !== null) {
      const secs = Math.max(0, (performance.now() - v.voice.recordingStartedAt) / 1000)
      text = `Listening… ${secs.toFixed(1)} s · release, or press Stop, when you are done`
    }
    if (voiceEl.textContent !== text) voiceEl.textContent = text
    voiceEl.hidden = !text
    voiceRow.hidden = !text && recCancel.hidden
    voiceEl.setAttribute('data-tone', v.voice.tone)
  }

  function renderVoice(v: AssistantView): void {
    const m = v.voice.mic
    mic.setAttribute('data-mode', m.mode)
    mic.setAttribute('aria-label', m.ariaLabel)
    mic.title = m.reason ?? (m.mode === 'record' ? 'Hold to talk, or press to start and again to stop' : m.ariaLabel)
    mic.disabled = !m.enabled
    mic.setAttribute('aria-pressed', m.mode === 'stop' ? 'true' : 'false')
    const micKey = m.mode === 'record' || m.mode === 'off' ? 'icon' : m.label
    if (mic.getAttribute('data-shown') !== micKey) {
      mic.setAttribute('data-shown', micKey)
      if (micKey === 'icon') mic.innerHTML = MIC_SVG
      else mic.textContent = m.label
    }
    recCancel.hidden = !(v.voice.phase === 'recording' && v.voice.cancel)
    recCancel.setAttribute('aria-label', v.voice.cancel?.ariaLabel ?? 'Cancel recording')
    // Transcript ready: the correction field replaces the question field (one field, one Send at a time).
    const t = v.voice.transcript
    transcriptEl.hidden = !t
    if (t) {
      if (keys.transcriptFor !== t.requestId) {
        keys.transcriptFor = t.requestId
        transcriptText.value = t.text
      }
      transcriptLabel.textContent = `Transcript · ${t.source} · edit, then Send`
      transcriptSend.disabled = !v.voice.send
    } else keys.transcriptFor = ''
    renderVoiceStatus()
    const recording = v.voice.phase === 'recording' && v.voice.recordingStartedAt !== null
    if (recording && !tick) tick = setInterval(renderVoiceStatus, 200)
    if (!recording && tick) {
      clearInterval(tick)
      tick = null
    }
  }

  /** Restore the field from input.draft when the draft changed elsewhere (sent, restored by Edit question). */
  function syncDraft(v: AssistantView): void {
    const d = v.input.draft
    if (d !== seenDraft) {
      seenDraft = d
      // Our own typing round-trips as d === dispatchedDraft (leave the field alone); anything else came from
      // outside this field: the controller cleared it after Send, or Edit question restored a prompt.
      if (field.value !== d && d !== dispatchedDraft) field.value = d
      dispatchedDraft = d
    }
  }

  // ------------------------------------------------------------------ the stage's room

  /** The body scrolls (its content overflows): the input rows are pinned to its bottom. */
  function scrolls(): boolean {
    const b = body
    return !!b && typeof b.scrollHeight === 'number' && b.scrollHeight - b.clientHeight > 1
  }

  /**
   * What must not move while the stage holds room: the content's height (`h`), or the input rows' place in it
   * (`off`). In a body that does not scroll the rows are in flow with the voice status under them, so their place is
   * kept; in one that scrolls they are pinned to its bottom with the voice status above them, so the content's height
   * is kept (the scroll position, and everything above, stay).
   */
  function measure(): { h: number; off: number } | null {
    const r = root && box(root)
    const f = box(footRows)
    if (!r || !f) return null
    return { h: r.height, off: r.height - f.height }
  }

  /** This content's clock (ms, on the time origin of the window's animation frames). */
  function clock(): number {
    return (win?.performance ?? performance).now()
  }

  /** The input rows' move still to come at `t` (px, + down); it eases to 0 over STAGE_EASE_MS. */
  function left(t: number): number {
    if (!ease) return 0
    const k = (t - ease.t0) / STAGE_EASE_MS
    if (k >= 1) {
      ease = null
      return 0
    }
    return ease.from * (1 - smooth(Math.max(0, k)))
  }

  /**
   * The stage's room becomes `px` (null: none) with the input rows where they are now: their move to the new place
   * eases in this content's frames (at once under prefers-reduced-motion, or with no frames to ease in).
   */
  function moveTo(px: number | null, t: number): void {
    const l = left(t) + (px ?? -CONTENT_GAP) - (room ?? -CONTENT_GAP)
    room = px
    const w = win
    ease = Math.abs(l) > 0.01 && w && typeof w.requestAnimationFrame === 'function' && !reduce?.matches ? { from: l, t0: t } : null
    if (ease && w && !easeFrame) easeFrame = w.requestAnimationFrame(easeStep)
  }

  /** One frame of a move easing (the frame's own time: the orb reads the box this frame paints). */
  function easeStep(t: number): void {
    easeFrame = 0
    if (!root) return
    layoutStage(t)
    if (ease && win) easeFrame = win.requestAnimationFrame(easeStep)
  }

  /** What the middle can hide while the input rows wait to move down: all of it (its content's height). */
  function midRoom(): number {
    const h = (midEl as { scrollHeight?: number }).scrollHeight
    return !midEl.hidden && typeof h === 'number' ? h : 0
  }

  /**
   * Lay the stage out for its room at `t`. Rows still to move up stand on a larger stage; rows still to move down are
   * held by hiding the bottom of the middle (revealed as they move, so the stage has its room from the first frame),
   * then by a smaller stage.
   */
  function layoutStage(t: number): void {
    const l = left(t)
    const all = l > 0 ? midRoom() : 0
    const hide = Math.min(Math.max(0, l), all)
    const ms = styleOf(midEl)
    if (hide > 0.01) {
      ms?.setProperty?.('max-height', `${(all - hide).toFixed(2)}px`)
      ms?.setProperty?.('overflow', 'hidden')
    } else if (ms?.getPropertyValue?.('max-height')) {
      ms.removeProperty('max-height')
      ms.removeProperty('overflow')
    }
    const st = styleOf(stageEl)
    stageEl.setAttribute('data-easing', ease ? 'on' : 'off')
    if (room === null && !ease) {
      shown = -CONTENT_GAP
      st?.removeProperty?.('--mwa-stage-room')
      st?.removeProperty?.('--mwa-stage-cut')
      st?.removeProperty?.('--mwa-stage-top')
      stageEl.setAttribute('data-room', 'off')
      return
    }
    shown = (room ?? -CONTENT_GAP) - l + hide
    st?.setProperty?.('--mwa-stage-room', `${shown.toFixed(2)}px`)
    stageEl.setAttribute('data-room', 'on')
    fitCut()
  }

  /**
   * The stage's box is only its part in view: what the pinned input rows cover (they are drawn higher than their
   * place in flow, over the bottom of the content above them), and what the body has scrolled away above it, are
   * margins instead, so the orb never lands under the rows or half out of view.
   */
  function fitCut(): void {
    if (!root || stageEl.getAttribute('data-room') !== 'on') return
    const st = styleOf(stageEl)
    const r = box(root)
    const f = box(footRows)
    if (!r || !f || !st?.setProperty) return
    const pinned = r.bottom - f.height - f.top
    const cut = Math.max(0, Math.min(shown, pinned - CONTENT_GAP))
    // The stage's place in flow: after the block before it and the gap (less a negative room's margin).
    const b = body && box(body)
    const prev = box(midEl.hidden ? sourceEl : midEl)
    const top = b && prev ? Math.max(0, Math.min(shown - cut, b.top - (prev.bottom + CONTENT_GAP + Math.min(0, shown)))) : 0
    for (const [k, v] of [['--mwa-stage-cut', cut], ['--mwa-stage-top', top]] as const) {
      const text = `${v.toFixed(2)}px`
      if (st.getPropertyValue?.(k) !== text) st.setProperty(k, text)
    }
  }

  function render(input: AssistantPanelInput): void {
    last = input
    if (!root) return
    const v = assistantView(input)
    view = v
    const t = clock()
    // Kept by every render: the body's scroll position (a layout read while the content is shorter for a moment
    // clamps it), and the voice status's side of the input row while the status is shown (see the end).
    const scrollWas = body ? body.scrollTop : null
    const statusWas = !voiceRow.hidden
    // The view shows suggestions (or their hint): nothing is in progress.
    const rest = v.suggestions.length > 0 || !!v.suggestionHint
    // The suggestions on screen give way to work on the learner's words: from now on the stage holds the room.
    const begin = !hold && suggShown && !rest
    const held = begin || !!hold
    // A move still easing is brought to this moment before anything is measured.
    if (held) layoutStage(t)
    const shownWas = shown
    // The stage's share without the part of the middle still hidden by a move down: the rows' real place, which a
    // hold that begins during that move keeps (the hide is dropped at once below).
    const baseWas = (room ?? -CONTENT_GAP) - left(t)
    const before = held ? measure() : null
    if (begin) {
      hold = { from: answerOf(input) }
      if (!statusWas) root.setAttribute('data-voice', scrolls() ? 'above' : 'below')
    }
    // Back at rest. A new answer (not the one shown when the hold began) ends the hold: it and its follow-ups show at
    // once. Otherwise the suggestions wait while the orb is on the stage or flying home, then take its room back.
    const answer = answerOf(input)
    const fresh = !!hold && rest && answer !== null && answer !== hold.from
    const orbOn = stageEl.getAttribute('data-open') !== null
    const wait = !!hold && rest && !fresh && (orbOn || stageEl.getAttribute('data-leaving') !== null)
    renderSource(v)
    // Idle: suggestions lead. With a result up, the answer comes first and compact follow-ups sit below it.
    const want = v.exchange ? 'after' : 'before'
    if (want !== layout) {
      layout = want
      if (want === 'after') midEl.append(exchangeEl, suggEl)
      else midEl.append(suggEl, exchangeEl)
      root.setAttribute('data-layout', want)
      suggHead.textContent = want === 'after' ? 'Ask next' : 'Suggested questions'
    }
    renderSuggestions(v)
    // Suggestions there are to show, held back while the orb is on the stage or flying home from it.
    if (wait) suggEl.hidden = true
    renderExchange(v.exchange)
    renderVoice(v)
    inputRow.hidden = !v.input.visible
    syncDraft(v)
    field.disabled = !v.input.enabled
    field.title = v.input.reason ?? ''
    send.disabled = !(v.input.enabled && field.value.trim())
    send.title = v.input.reason ?? ''
    // Nothing in the middle (a recording from the idle panel): no empty block, no gap; the stage takes its place.
    midEl.hidden = suggEl.hidden && !v.exchange
    if (hold) {
      // The stage absorbs whatever this render changed (the middle's hidden part follows its new content first), from
      // the room laid out now: a stage still easing closed when the work begins stops where it is.
      layoutStage(t)
      const after = before && measure()
      const pin = (m: { h: number; off: number }) => (root!.getAttribute('data-voice') === 'above' ? m.h : m.off)
      const px = (begin ? baseWas : room ?? shownWas) + (before && after ? pin(before) - pin(after) : 0)
      if (begin) ease = null
      if (rest && !fresh && !wait) {
        // The orb is home: the suggestions take the room back in this frame, and whatever they do not fill exactly
        // (the voice status still shown, an exchange that changed) eases.
        hold = null
        room = px
        moveTo(null, t)
      } else if (fresh) {
        // The orb lingers on the room the stage can keep (at least its own size, if the stage had that) and the
        // stage closes, eased, as it leaves. With no orb on it, or in a body that then scrolls (the stage out of view,
        // its closing would move the answer), it closes at once.
        hold = null
        ease = null
        room = orbOn ? Math.max(px, Math.min(shownWas, STAGE_KEEP)) : null
        layoutStage(t)
        if (room !== null && scrolls()) room = null
      } else {
        room = px
        layoutStage(t)
        // The voice status under the rows made a body that did not scroll overflow: pin the content's height.
        if (begin && before && !statusWas && root.getAttribute('data-voice') === 'below' && scrolls()) {
          root.setAttribute('data-voice', 'above')
          const again = measure()
          if (again) room += before.h - again.h
        }
        // The least room: none below nothing, and while the question is pending STAGE_MIN in a body that does not
        // scroll. The input rows make up the difference, eased (never while recording: nothing is pending then).
        const least = input.assistant.kind === 'pending' && root.getAttribute('data-voice') === 'below' ? STAGE_MIN : -CONTENT_GAP
        if (room < least) moveTo(least, t)
      }
    } else if (room !== null && !orbOn) moveTo(null, t) // the orb that lingered left: the stage closes, eased
    layoutStage(t)
    root.setAttribute('data-hold', hold ? 'on' : 'off')
    // The voice status's side is decided only while it is not shown (moving it would move the input row), or as an
    // answer arrives (everything below the answer may move then).
    if (!hold && (!statusWas || voiceRow.hidden || fresh)) root.setAttribute('data-voice', scrolls() ? 'above' : 'below')
    if (held && body && scrollWas !== null && body.scrollTop !== scrollWas) body.scrollTop = scrollWas
    suggShown = !suggEl.hidden
    root.setAttribute('data-phase', v.phase)
  }

  function dispose(): void {
    for (const off of offs.splice(0)) off()
    if (tick) clearInterval(tick)
    tick = null
    if (easeFrame) win?.cancelAnimationFrame(easeFrame)
    easeFrame = 0
    root?.remove()
    root = null
    orbSlot?.remove()
    orbSlot = checkEl = checkText = body = win = reduce = null
    hold = room = ease = null
    actionEls.clear()
    keys.source = keys.sugg = keys.exchange = keys.transcriptFor = ''
    seenDraft = null
  }

  return { mount, render, dispose }
}

/** Tone of a phase status (exported for the spatial content's colours). */
export type { Tone }

/** The microphone's accessible name in the idle state (exact spec copy). */
export { MIC_RECORD_NAME }
