// Desktop push-to-talk panel: Record/Stop, Cancel, status, an editable transcript and Send. Plain DOM
// with a small scoped <style>, matching the HUD cards (index.html). The panel only drives the
// VoiceClient; the transcript reaches the assistant through VoiceClient.submit (the typed request path).
//
// Record: hold it while speaking and release to stop, or press once to start and again to stop.
// Keys typed in the transcript field never reach the scene shortcuts (stopPropagation, like Ask);
// Enter sends, Shift+Enter is a new line, Escape cancels.
//
// The press handling is exported as bindPushToTalk so the Ask Meta Muse AI inspector (src/ui/assistant) drives
// the same hold-to-talk / press-twice behaviour through UI commands instead of the client.

import { type VoiceClient, type VoiceState, transcriptSource } from './client'

/** A press held at least this long is hold-to-talk (release stops); a shorter one toggles. */
export const HOLD_MS = 350

/** What a push-to-talk button reads and does. */
export interface PushToTalkHandlers {
  recording(): boolean
  /** The microphone is being requested (a press cancels it). */
  acquiring(): boolean
  /** Optional: a press while transcribing cancels (the inspector's microphone shows Cancel then). */
  transcribing?(): boolean
  start(): void
  stop(): void
  cancel(): void
  /** Keyboard activation (Enter/Space on the focused button): record, stop, or cancel. */
  toggle(): void
  now?(): number
}

/**
 * Hold-to-talk on a button: press and hold while speaking, release to stop; or a short press to start and a
 * second press to stop. A press while the microphone is being requested cancels it. Space/Enter on the button
 * toggles and never reaches the scene shortcuts. Returns the unbind function.
 */
export function bindPushToTalk(button: HTMLElement, h: PushToTalkHandlers): () => void {
  let pressAt = -1
  const now = h.now ?? (() => performance.now())
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    if (h.recording()) {
      h.stop()
      return
    }
    if (h.acquiring() || h.transcribing?.()) {
      h.cancel()
      return
    }
    pressAt = now()
    try {
      button.setPointerCapture?.(e.pointerId)
    } catch {
      /* not capturable (synthetic event) */
    }
    h.start()
  }
  const onUp = () => {
    if (pressAt < 0) return
    const held = now() - pressAt
    pressAt = -1
    if (held >= HOLD_MS) h.stop()
  }
  // Keyboard activation (Enter/Space on the focused button) arrives as a click with detail 0.
  const onClick = (e: MouseEvent) => {
    if (e.detail === 0) h.toggle()
  }
  // Space/Enter on the button must not also reach the scene shortcuts (Space = play/pause).
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
  }
  button.addEventListener('pointerdown', onDown as EventListener)
  button.addEventListener('pointerup', onUp)
  button.addEventListener('pointercancel', onUp)
  button.addEventListener('click', onClick as EventListener)
  button.addEventListener('keydown', onKey as EventListener)
  return () => {
    button.removeEventListener?.('pointerdown', onDown as EventListener)
    button.removeEventListener?.('pointerup', onUp)
    button.removeEventListener?.('pointercancel', onUp)
    button.removeEventListener?.('click', onClick as EventListener)
    button.removeEventListener?.('keydown', onKey as EventListener)
  }
}

const STYLE = `
.mw-voice .mw-voice-rec { min-width: 92px; }
.mw-voice .mw-voice-rec.on { background: #5b2433; border-color: #b4566c; }
.mw-voice .mw-voice-rec.on::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; background: #ff6b81; vertical-align: 1px; }
.mw-voice .mw-voice-status { margin-top: 6px; }
.mw-voice .mw-voice-status.err { color: #ff8fa3; }
.mw-voice .mw-voice-edit { margin-top: 6px; display: grid; gap: 6px; }
.mw-voice textarea { box-sizing: border-box; width: 100%; min-height: 44px; resize: vertical; font: inherit; color: var(--text); background: #151a26; border: 1px solid #34405a; border-radius: 7px; padding: 6px 8px; }
.mw-voice .mw-voice-src { font-size: 12px; }
`

export function mountVoicePanel(root: HTMLElement, client: VoiceClient): () => void {
  const doc = root.ownerDocument
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }
  const card = el('div', 'card mw-voice')
  card.setAttribute('data-voice', 'panel')
  const style = el('style')
  style.textContent = STYLE
  const head = el('div', 'row')
  const title = el('span', 'title', 'Voice')
  const mode = el('span', 'dim')
  mode.setAttribute('data-voice', 'mode')
  head.append(title, mode)
  const controls = el('div', 'row')
  controls.style.marginTop = '6px'
  const rec = el('button', 'primary mw-voice-rec', 'Record')
  rec.setAttribute('data-voice', 'record')
  rec.setAttribute('aria-pressed', 'false')
  const cancel = el('button', '', 'Cancel')
  cancel.setAttribute('data-voice', 'cancel')
  const timer = el('span', 'dim')
  timer.setAttribute('data-voice', 'timer')
  controls.append(rec, cancel, timer)
  const status = el('div', 'dim mw-voice-status')
  status.setAttribute('data-voice', 'status')
  status.setAttribute('aria-live', 'polite')
  const edit = el('div', 'mw-voice-edit')
  edit.setAttribute('data-voice', 'edit')
  const text = el('textarea')
  text.setAttribute('data-voice', 'text')
  text.setAttribute('aria-label', 'Transcript (edit before sending)')
  text.setAttribute('maxlength', '2000')
  text.rows = 2
  const editRow = el('div', 'row')
  const send = el('button', 'primary', 'Send')
  send.setAttribute('data-voice', 'send')
  const src = el('span', 'dim mw-voice-src')
  src.setAttribute('data-voice', 'source')
  editRow.append(send, src)
  edit.append(text, editRow)
  card.append(style, head, controls, status, edit)
  root.append(card)

  // ---- Record: hold-to-talk or press/press again ----
  const now = () => performance.now()
  bindPushToTalk(rec, {
    recording: () => client.state.kind === 'recording',
    acquiring: () => client.acquiring,
    start: () => void client.start(),
    stop: () => client.stop(),
    cancel: () => client.cancel(),
    toggle: () => client.toggle(),
    now,
  })
  // Space/Enter on a panel button must not also reach the scene shortcuts (Space = play/pause).
  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') e.stopPropagation()
  }
  for (const b of [cancel, send]) b.addEventListener('keydown', onButtonKey)
  cancel.addEventListener('click', () => client.cancel())
  send.addEventListener('click', () => client.submit(text.value))
  text.addEventListener('input', () => client.edit(text.value))
  const onTextKey = (e: KeyboardEvent) => {
    e.stopPropagation() // typing must not trigger scene shortcuts
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      client.submit(text.value)
    } else if (e.key === 'Escape') {
      client.cancel()
    }
  }
  text.addEventListener('keydown', onTextKey)
  text.addEventListener('keyup', (e: KeyboardEvent) => e.stopPropagation())

  // ---- render ----
  let tick: ReturnType<typeof setInterval> | null = null
  let shownTranscriptFor: string | null = null
  const renderTimer = () => {
    const s = client.state
    timer.textContent = s.kind === 'recording' ? `${((now() - s.startedAt) / 1000).toFixed(1)} s` : ''
  }
  const setStatus = (t: string, err = false) => {
    status.textContent = t
    status.className = `dim mw-voice-status${err ? ' err' : ''}`
  }
  const render = (s: VoiceState) => {
    const cap = client.speechCapability
    mode.textContent =
      s.kind === 'unavailable' ? 'speech unavailable'
      : cap?.mode === 'meta' ? `Meta speech-to-text ${cap.model ?? ''}${cap.liveValidated ? '' : ' · live call unverified'}`
      : ''
    const recording = s.kind === 'recording'
    rec.textContent = recording ? 'Stop' : client.acquiring ? 'Waiting for mic…' : 'Record'
    rec.classList.toggle('on', recording)
    rec.setAttribute('aria-pressed', recording ? 'true' : 'false')
    rec.disabled = s.kind === 'unavailable' || s.kind === 'transcribing'
    cancel.disabled = !(client.busy || s.kind === 'transcript')
    edit.hidden = s.kind !== 'transcript'
    if (s.kind === 'transcript') {
      // Fill the field once per transcript; later renders keep the learner's edits.
      if (shownTranscriptFor !== s.response.requestId) {
        shownTranscriptFor = s.response.requestId
        text.value = s.text
      }
      const t = client.lastTiming
      src.textContent = `${transcriptSource(s.response)}${t ? ` · ${t.releaseToTranscriptMs} ms after release` : ''}`
    } else {
      shownTranscriptFor = null
    }
    switch (s.kind) {
      case 'idle':
        setStatus(client.acquiring ? 'Requesting the microphone… (allow it in the browser prompt)' : 'Hold Record while you speak, or press it once to start and again to stop.')
        break
      case 'unavailable':
        setStatus(`Speech unavailable: ${s.reason}. Type the request in Ask instead.`, true)
        break
      case 'recording':
        setStatus('Listening… release (or press Stop) when you are done.')
        break
      case 'transcribing':
        setStatus(`Transcribing ${(s.durationMs / 1000).toFixed(1)} s of audio…${s.limitReached ? ' Recording stopped at the length limit.' : ''}`)
        break
      case 'transcript':
        setStatus(`${s.limitReached ? 'Recording stopped at the length limit. ' : ''}Check the transcript, correct it if needed, then Send (Enter).`)
        break
      case 'submitted':
        setStatus(`Sent as your request: "${s.text}"`)
        break
      case 'error':
        setStatus(s.message, true)
        break
      case 'canceled':
        setStatus('Canceled; nothing was sent.')
        break
    }
    renderTimer()
    if (recording && !tick) tick = setInterval(renderTimer, 200)
    if (!recording && tick) {
      clearInterval(tick)
      tick = null
    }
  }
  const off = client.subscribe(render)
  render(client.state)

  return () => {
    off()
    if (tick) clearInterval(tick)
    card.remove()
  }
}
