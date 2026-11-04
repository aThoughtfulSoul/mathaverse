// Desktop shell (UI-REFINEMENT-SPEC sections 3, 4, 8): the DOM around the WebGL stage. It renders a UiView and
// emits UiCommands through the dispatch it was given; it never touches the app, the planner or a client.
//
// Wide layout: the stage fills the main column; the question sits over its top-left, the context card, status
// line and the one toolbar over its bottom centre; the side inspector (assistant or mathematics) is a second
// grid column, so opening it narrows the stage column without moving or resetting the experiment. When the stage
// column would be under 900 px (a narrow window, or an open inspector below about 1240 px) everything stacks
// (question, stage, actions + status, inspector drawer, toolbar), so nothing covers the stage, the stage row keeps
// priority over the drawer, and the question, next action and cancellation controls stay visible.

import type {
  ContextItem, DetailItem, DetailSection, DomPanelContent, EvidenceItem, MoreItem, ToolbarId, ToolbarItem, UiDispatch, UiView,
} from '../model'
import { fieldGroups } from '../model'
import type { DemoKind } from '../../demo/order'
import {
  CLOSE_INSPECTOR, CLOSE_POPOVER, TOGGLE_MATH, TOOLBAR_ROWS, contextCommand, detailActionCommand, inspectorFrame, isShortChoice,
  isStacked, mathToggleLabel, moreCommand, moreSections, pickerCommands, representationCommand, shellConsumesKey, stackedStageMin,
  toolbarCommand, toolbarDescription, toolbarName,
} from './logic'
import { EXPERIMENT_ICONS, iconSvg, svg, type IconName } from './icons'
import { installShellStyles } from './styles'
import { DesktopOrb, type OrbWindow } from '../orb/desktop'
import type { OrbSource } from '../orb/source'

const TOOLBAR_ICONS: Record<ToolbarId, IconName> = {
  experiments: 'grid', assistant: 'chat', play: 'play', replay: 'replay', undo: 'undo', more: 'more',
}

const MORE_ICONS: Record<string, IconName> = {
  save: 'save', reopen: 'reopen', export: 'exportFile', import: 'importFile', saveRepresentation: 'layers',
  enterVR: 'headset', enterPassthrough: 'room', exitSession: 'exit', enableVoice: 'mic',
}

const EVIDENCE_STATUS: Record<EvidenceItem['status'], string> = {
  computed: 'Computed', not_sent: 'Not checked', checking: 'Checking…', checked: 'Checked', not_established: 'Not established', error: 'Error',
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name)
  } else if (el.getAttribute(name) !== value) el.setAttribute(name, value)
}

/** Height of a displayed region including its margins (0 when it is not displayed). */
function outerHeight(el: HTMLElement): number {
  if (el.hidden || el.offsetParent === null) return 0
  const cs = getComputedStyle(el)
  return el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
}

/** aria-disabled (not the disabled attribute) keeps the reason tooltip and focus; activation is refused in code. */
function setEnabled(el: HTMLElement, enabled: boolean, reason?: string, title?: string | null): void {
  setAttr(el, 'aria-disabled', enabled ? null : 'true')
  setAttr(el, 'title', !enabled && reason ? reason : title ?? null)
}

export interface DesktopShellOptions {
  root: HTMLElement
  stage: HTMLElement
  dispatch: UiDispatch
  assistant: DomPanelContent
  /** The Ask Meta Muse AI glyph orb's state source (src/ui/orb/source.ts); no orb without it. */
  orb?: OrbSource | null
}

export class DesktopShell {
  private readonly root: HTMLElement
  private readonly stage: HTMLElement
  private readonly dispatch: UiDispatch
  private readonly assistant: DomPanelContent
  private view: UiView | null = null
  private lastKey: string | null = null
  private readonly sig = new Map<string, string>()
  private readonly cleanup: (() => void)[] = []
  private readonly stageRestore: { parent: Node | null; next: Node | null; style: string; hadClass: boolean }

  // regions
  private readonly header = h('header', 'mw-header')
  private readonly question = h('h1', 'mw-question')
  private readonly subtitle = h('p', 'mw-subtitle')
  private readonly stageSlot = h('div', 'mw-stage-slot')
  private readonly dock = h('section', 'mw-dock')
  private readonly contextCard = h('div', 'mw-context')
  private readonly status = h('div', 'mw-status')
  private readonly statusText = h('span', 'mw-status-text')
  private readonly mathToggle = h('button', 'mw-math-toggle')
  private readonly noticeInline = h('p', 'mw-notice-inline')
  private readonly tools = h('nav', 'mw-tools')
  private readonly toolbar = h('div', 'mw-toolbar')
  private readonly buttons = new Map<ToolbarId, HTMLButtonElement>()
  private readonly inspector = h('aside', 'mw-inspector')
  private readonly card = h('section', 'mw-insp-card')
  private readonly cardTitle = h('h2', 'mw-insp-title')
  private readonly cardClose = h('button', 'mw-insp-close')
  private readonly cardBody = h('div', 'mw-insp-body')
  private readonly assistantSlot = h('div', 'mw-assistant-slot')
  private readonly mathSlot = h('div', 'mw-math')
  private popEl: HTMLElement | null = null
  private popKind: 'experiments' | 'more' | null = null
  /** Desktop representation editor: expanded, and the learner's unsaved choices (per recipe). */
  private repOpen = false
  private repDraft: { recipe: string; on: Map<string, boolean> } | null = null
  private keyboardIntent = false
  private swallowPointer: number | null = null
  private readonly ro: ResizeObserver | null = null
  /** The assistant's glyph orb, mounted into the assistant content's header slot (src/ui/orb/desktop.ts). */
  private readonly orb: DesktopOrb | null = null

  constructor(opts: DesktopShellOptions) {
    this.root = opts.root
    this.stage = opts.stage
    this.dispatch = opts.dispatch
    this.assistant = opts.assistant
    installShellStyles(this.root.ownerDocument)
    this.stageRestore = { parent: this.stage.parentNode, next: this.stage.nextSibling, style: this.stage.style.cssText, hadClass: this.stage.classList.contains('mw-stage') }
    this.build()
    this.assistant.mount(this.assistantSlot)
    if (opts.orb) {
      try {
        const doc = this.root.ownerDocument
        this.orb = new DesktopOrb(opts.orb, doc, (doc.defaultView ?? window) as unknown as OrbWindow)
      } catch {
        this.orb = null // the orb is optional: the shell never fails because of it
      }
    }
    this.listen()
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.measure())
      this.ro.observe(this.root)
    }
    this.measure()
  }

  render(view: UiView): void {
    this.view = view
    const same = view.key !== '' && view.key === this.lastKey
    this.lastKey = view.key
    if (!same) {
      setAttr(this.root, 'data-surface', view.surface)
      setAttr(this.root, 'data-inspector', view.inspector)
      this.renderHeader(view)
      this.renderToolbar(view)
      this.renderContext(view)
      this.renderStatus(view)
      this.renderPopover(view)
      this.renderInspector(view)
      this.measure()
    }
    // The assistant plug-in always gets the current inputs (its own lifecycle states change between keys).
    this.assistant.render(view.assistant)
    // The orb (re)mounts into the assistant content's slot once it exists (the content places it in this frame's
    // header, before the title, so the whole card is searched); shown only with the assistant panel, never in the
    // clean stage (?clean=1 hides every 2D layer).
    this.orb?.update(this.card, view.inspector === 'assistant' && !this.root.ownerDocument.body.classList.contains('clean'))
  }

  /**
   * CSS pixels of the stage that the shell's overlays cover: the question header over the top, the context card,
   * status line and toolbar over the bottom (wide layout). Zeros in the stacked layout and the clean-stage view,
   * where nothing covers the stage. The inspector is its own grid column, so it never covers the stage.
   */
  stageInsets(): { top: number; right: number; bottom: number; left: number } {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 }
    // The layout mode first: a window resize can reach the caller before the shell's own ResizeObserver has run.
    this.measure()
    if (this.root.hasAttribute('data-narrow') || this.root.ownerDocument.body.classList.contains('clean-stage')) return zero
    const s = this.stage.getBoundingClientRect()
    if (s.width <= 0 || s.height <= 0) return zero
    const visible = (el: HTMLElement) => !el.hidden && el.offsetParent !== null
    const hr = visible(this.header) ? this.header.getBoundingClientRect() : null
    const top = hr && hr.height > 0 ? Math.max(0, Math.min(s.height, hr.bottom - s.top)) : 0
    let coverTop = Infinity
    for (const el of [this.contextCard, this.status, this.noticeInline, this.tools]) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.height > 0) coverTop = Math.min(coverTop, r.top)
    }
    const bottom = Number.isFinite(coverTop) ? Math.max(0, Math.min(s.height, s.bottom - coverTop)) : 0
    return { top: Math.round(top), right: 0, bottom: Math.round(bottom), left: 0 }
  }

  dispose(): void {
    this.cleanup.forEach((f) => f())
    this.cleanup.length = 0
    this.ro?.disconnect()
    this.orb?.dispose()
    this.assistant.dispose()
    // Give the stage back where it was, with its original styles.
    this.stage.style.cssText = this.stageRestore.style
    if (!this.stageRestore.hadClass) this.stage.classList.remove('mw-stage')
    if (this.stageRestore.parent) this.stageRestore.parent.insertBefore(this.stage, this.stageRestore.next && this.stageRestore.next.parentNode === this.stageRestore.parent ? this.stageRestore.next : null)
    this.root.replaceChildren()
    this.root.classList.remove('mw-shell')
    this.root.style.removeProperty('--mw-stage-min')
    for (const a of ['data-surface', 'data-inspector', 'data-narrow', 'data-tight']) this.root.removeAttribute(a)
  }

  // ------------------------------------------------------------------ construction

  private build(): void {
    const root = this.root
    root.classList.add('mw-shell')
    root.replaceChildren()

    this.stage.classList.add('mw-stage')
    this.stage.style.position = 'absolute'
    this.stage.style.inset = '0'
    this.stageSlot.appendChild(this.stage)

    this.question.id = 'mw-question'
    this.header.setAttribute('aria-labelledby', 'mw-question')
    this.header.append(this.question, this.subtitle)

    this.dock.setAttribute('aria-label', 'Experiment actions')
    const dot = h('span', 'mw-dot')
    dot.setAttribute('aria-hidden', 'true')
    this.statusText.setAttribute('role', 'status')
    this.statusText.setAttribute('aria-live', 'polite')
    const sep = h('span', 'mw-status-sep')
    sep.setAttribute('aria-hidden', 'true')
    this.mathToggle.type = 'button'
    this.mathToggle.setAttribute('aria-controls', 'mw-inspector')
    this.mathToggle.addEventListener('click', () => this.view && this.dispatch(TOGGLE_MATH))
    this.status.append(dot, this.statusText, sep, this.mathToggle)
    this.noticeInline.hidden = true
    this.dock.append(this.contextCard, this.status, this.noticeInline)

    this.tools.setAttribute('aria-label', 'Workspace toolbar')
    this.toolbar.setAttribute('role', 'toolbar')
    this.toolbar.setAttribute('aria-label', 'Workspace')
    TOOLBAR_ROWS.forEach((ids) => {
      const row = h('div', 'mw-tb-row')
      for (const id of ids) {
        if (id === 'more') {
          const s = h('span', 'mw-tb-sep')
          s.setAttribute('aria-hidden', 'true')
          row.appendChild(s)
        }
        const b = h('button', 'mw-tb-btn')
        b.type = 'button'
        b.dataset.id = id
        b.dataset.focusId = `tb:${id}`
        b.innerHTML = `${iconSvg(TOOLBAR_ICONS[id], id === 'more' ? 20 : 19)}<span class="mw-tb-label"></span>${id === 'experiments' ? iconSvg('chevronDown', 16, 2, 'mw-caret') : ''}`
        if (id === 'experiments' || id === 'more') b.setAttribute('aria-haspopup', 'dialog')
        if (id === 'assistant') b.setAttribute('aria-controls', 'mw-inspector')
        b.addEventListener('click', () => this.onToolbar(id))
        this.buttons.set(id, b)
        row.appendChild(b)
      }
      this.toolbar.appendChild(row)
    })
    this.tools.appendChild(this.toolbar)

    this.inspector.id = 'mw-inspector'
    this.inspector.hidden = true
    const head = h('div', 'mw-insp-head')
    this.cardTitle.id = 'mw-insp-title'
    this.card.setAttribute('aria-labelledby', 'mw-insp-title')
    this.cardClose.type = 'button'
    this.cardClose.innerHTML = iconSvg('close', 20, 2)
    this.cardClose.addEventListener('click', () => this.dispatch(CLOSE_INSPECTOR))
    head.append(this.cardTitle, this.cardClose)
    this.cardBody.append(this.assistantSlot, this.mathSlot)
    this.card.append(head, this.cardBody)
    this.inspector.appendChild(this.card)

    root.append(this.stageSlot, this.header, this.dock, this.inspector, this.tools)
  }

  private listen(): void {
    const doc = this.root.ownerDocument
    const win = doc.defaultView ?? window
    const on = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void, opts?: boolean | AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    // Keys a shell control consumes (typing, Space/Enter on a button) never reach the window shortcuts.
    const stopConsumed = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && this.root.contains(t) && shellConsumesKey(e.key, { tagName: t.tagName, type: (t as HTMLInputElement).type, isContentEditable: t.isContentEditable, role: t.getAttribute('role') })) e.stopPropagation()
    }
    on<KeyboardEvent>(this.root, 'keydown', (e) => {
      this.keyboardIntent = true
      stopConsumed(e)
    })
    on<KeyboardEvent>(this.root, 'keyup', stopConsumed)
    on<PointerEvent>(this.root, 'pointerdown', () => (this.keyboardIntent = false))
    // Escape closes the open popover before the page's own Escape (cancel drag) sees it.
    on<KeyboardEvent>(win, 'keydown', (e) => {
      if (e.key !== 'Escape' || !this.view?.popover) return
      e.stopImmediatePropagation()
      e.preventDefault()
      const toggle = this.popKind ? this.buttons.get(this.popKind) : null
      this.dispatch(CLOSE_POPOVER)
      toggle?.focus()
    }, true)
    // Outside press closes the popover; a press on the stage is swallowed so it cannot act on the mathematics.
    on<PointerEvent>(doc, 'pointerdown', (e) => {
      if (!this.view?.popover || !this.popEl) return
      const t = e.target as Node | null
      if (!t) return
      if (this.popEl.contains(t)) return
      const toggle = this.popKind ? this.buttons.get(this.popKind) : null
      if (toggle?.contains(t)) return
      this.dispatch(CLOSE_POPOVER)
      if (this.stageSlot.contains(t)) {
        e.stopPropagation()
        e.preventDefault()
        this.swallowPointer = e.pointerId
      }
    }, true)
    const swallow = (e: PointerEvent) => {
      if (this.swallowPointer === null || e.pointerId !== this.swallowPointer) return
      e.stopPropagation()
      if (e.type === 'pointerup' || e.type === 'pointercancel') this.swallowPointer = null
    }
    on<PointerEvent>(doc, 'pointerup', swallow, true)
    on<PointerEvent>(doc, 'pointercancel', swallow, true)
    on<MouseEvent>(doc, 'click', (e) => {
      if (this.swallowPointer !== null && this.stageSlot.contains(e.target as Node)) e.stopPropagation()
    }, true)
  }

  /**
   * Layout mode from the actual size (idempotent). Stacked when the stage column would be under 900 px, judged from
   * the window width and the inspector's CSS width (never from the current layout's rectangles). Two toolbar rows
   * only when one row overflows its pill, measured from the one-row layout. Stacked, the stage row's minimum
   * (`--mw-stage-min`) follows the heights of the question, actions and toolbar rows.
   */
  private measure(): void {
    const win = this.root.ownerDocument.defaultView
    const w = this.root.clientWidth || (win?.innerWidth ?? 1600)
    const narrow = isStacked(w, !!this.view?.inspector)
    setAttr(this.root, 'data-narrow', narrow ? '' : null)
    setAttr(this.root, 'data-tight', null)
    if (this.toolbar.scrollWidth > this.toolbar.clientWidth) setAttr(this.root, 'data-tight', '')
    let min = ''
    if (narrow) {
      const H = this.root.clientHeight || (win?.innerHeight ?? 1000)
      const chrome = outerHeight(this.header) + outerHeight(this.dock) + outerHeight(this.tools)
      min = `${stackedStageMin(H, chrome, !!this.view?.inspector)}px`
    }
    if (this.root.style.getPropertyValue('--mw-stage-min') !== min) {
      if (min) this.root.style.setProperty('--mw-stage-min', min)
      else this.root.style.removeProperty('--mw-stage-min')
    }
  }

  // ------------------------------------------------------------------ commands (looked up in the current view)

  private onToolbar(id: ToolbarId): void {
    const v = this.view
    const item = v?.toolbar.find((t) => t.id === id)
    if (!v || !item) return
    const cmd = toolbarCommand(v, item)
    if (cmd) this.dispatch(cmd)
  }

  private findContextItem(id: string): ContextItem | null {
    for (const g of this.view?.presentation.context.groups ?? []) {
      const it = g.items.find((x) => x.id === id)
      if (it) return it
    }
    return null
  }

  private onContext(id: string): void {
    const it = this.findContextItem(id)
    const cmd = it ? contextCommand(it) : null
    if (cmd) this.dispatch(cmd)
  }

  private onDetailAction(id: string): void {
    for (const s of this.view?.presentation.detail.sections ?? []) {
      for (const it of s.items) {
        if (it.kind === 'action' && it.id === id) {
          const cmd = detailActionCommand(it)
          if (cmd) this.dispatch(cmd)
          return
        }
      }
    }
  }

  private onPick(kind: DemoKind): void {
    const v = this.view
    if (!v) return
    const toggle = this.buttons.get('experiments')
    for (const cmd of pickerCommands(v, kind)) this.dispatch(cmd)
    if (this.keyboardIntent) toggle?.focus()
  }

  private onMore(id: string): void {
    const v = this.view
    const item = v?.more.sections.flatMap((s) => s.items).find((x) => x.id === id)
    if (!v || !item) return
    if (id === 'saveRepresentation') {
      // Desktop: the entry opens the representation editor in place; its own Save emits the command.
      if (!item.enabled || !v.more.representation) return
      this.repOpen = !this.repOpen
      this.sig.delete('popover')
      this.renderPopover(v)
      return
    }
    const cmd = moreCommand(item)
    if (cmd) this.dispatch(cmd)
  }

  private onSaveRepresentation(): void {
    const rep = this.view?.more.representation
    if (!rep) return
    const ops = rep.operations.map((o) => ({ kind: o.kind, on: this.repDraft?.recipe === rep.recipeName ? this.repDraft.on.get(o.kind) ?? o.on : o.on }))
    const cmd = representationCommand(ops)
    if (!cmd) return
    this.repOpen = false
    this.repDraft = null
    this.dispatch(cmd)
  }

  // ------------------------------------------------------------------ regions

  private changed(region: string, value: unknown): boolean {
    const s = JSON.stringify(value)
    if (this.sig.get(region) === s) return false
    this.sig.set(region, s)
    return true
  }

  private renderHeader(v: UiView): void {
    setText(this.question, v.experiment.question)
    setText(this.subtitle, v.experiment.subtitle.plain)
    this.subtitle.hidden = !v.experiment.subtitle.plain
  }

  private renderToolbar(v: UiView): void {
    for (const [id, b] of this.buttons) {
      const item = v.toolbar.find((t) => t.id === id)
      b.hidden = !item
      if (!item) continue
      setText(b.querySelector('.mw-tb-label')!, item.label)
      setAttr(b, 'aria-label', toolbarName(item))
      setEnabled(b, item.enabled, item.reason, toolbarDescription(item))
      b.classList.toggle('is-active', item.active)
      if (id === 'experiments' || id === 'more') setAttr(b, 'aria-expanded', String(v.popover === id))
      if (id === 'assistant') setAttr(b, 'aria-pressed', String(item.active))
      if (id === 'play') {
        const icon = item.label === 'Pause' ? 'pause' : 'play'
        if (b.dataset.icon !== icon) {
          b.dataset.icon = icon
          b.querySelector('svg')!.outerHTML = iconSvg(icon, 19)
        }
      }
      if (id === 'undo') this.describe(b, item)
    }
  }

  /** Undo's description ("Undo last workspace change") as aria-description where supported, and as the title. */
  private describe(b: HTMLButtonElement, item: ToolbarItem): void {
    const d = toolbarDescription(item)
    setAttr(b, 'aria-description', d)
  }

  private renderContext(v: UiView): void {
    const ctx = v.presentation.context
    const empty = !ctx.title && !ctx.hint && ctx.groups.every((g) => !g.items.length)
    setAttr(this.dock, 'data-context', empty ? 'none' : null)
    this.contextCard.hidden = empty
    if (empty || !this.changed('context', ctx)) return
    this.keepFocus(this.contextCard, () => {
      const card = this.contextCard
      card.replaceChildren()
      if (ctx.title) card.appendChild(h('h2', 'mw-context-title', ctx.title))
      const body = h('div', 'mw-context-body')
      for (const g of ctx.groups) {
        if (!g.items.length) continue
        const group = h('div', 'mw-group')
        group.dataset.layout = g.layout
        group.setAttribute('role', 'group')
        if (g.label) {
          const lab = h('span', 'mw-group-label', g.label)
          lab.id = `mw-g-${g.id}`
          group.setAttribute('aria-labelledby', lab.id)
          group.appendChild(lab)
        } else if (ctx.title) group.setAttribute('aria-label', ctx.title)
        const items = h('div', 'mw-group-items')
        for (const it of g.items) items.appendChild(this.contextButton(it))
        group.appendChild(items)
        body.appendChild(group)
      }
      card.appendChild(body)
      if (ctx.hint) {
        const hint = h('p', 'mw-hint')
        hint.innerHTML = iconSvg('info', 18, 1.8)
        hint.appendChild(h('span', undefined, ctx.hint))
        card.appendChild(hint)
      }
    })
  }

  private contextButton(it: ContextItem): HTMLButtonElement {
    const b = h('button')
    b.type = 'button'
    b.dataset.focusId = `ctx:${it.id}`
    const role = it.role
    if (role === 'choice') {
      b.className = `mw-choice${isShortChoice(it.label.plain) ? ' is-short' : ''}`
      b.appendChild(h('span', undefined, it.label.plain))
      const check = h('span', 'mw-check')
      check.innerHTML = svg('M5.5 12.5l4.2 4.2L18.5 7.8', 14, 3)
      b.appendChild(check)
      b.setAttribute('aria-pressed', String(!!it.selected))
    } else if (role === 'primary') {
      b.className = 'mw-primary'
      b.appendChild(h('span', undefined, it.label.plain))
      b.insertAdjacentHTML('beforeend', iconSvg('arrowRight', 22, 2))
    } else {
      b.className = `mw-secondary${role === 'toggle' ? ' is-toggle' : ''}`
      if (role === 'toggle') {
        b.innerHTML = iconSvg('check', 16, 2.2)
        b.setAttribute('aria-pressed', String(!!it.selected))
      }
      b.appendChild(h('span', undefined, it.label.plain))
    }
    if (it.ariaLabel) b.setAttribute('aria-label', it.ariaLabel)
    setEnabled(b, it.enabled, it.reason, it.hint ?? null)
    b.addEventListener('click', () => this.onContext(it.id))
    return b
  }

  private renderStatus(v: UiView): void {
    const st = v.presentation.status
    setAttr(this.status, 'data-phase', st.phase)
    setAttr(this.status, 'data-tone', st.tone)
    setText(this.statusText, st.text)
    const open = v.inspector === 'math'
    const label = mathToggleLabel(v)
    if (this.mathToggle.dataset.label !== label) {
      this.mathToggle.dataset.label = label
      this.mathToggle.innerHTML = `<span>${label}</span>${iconSvg('chevronRight', 16, 2)}`
    }
    setAttr(this.mathToggle, 'aria-expanded', String(open))
    // An error notice stays visible even when More is closed (spec section 3: errors remain visible).
    const notice = v.more.notice
    const showNotice = !!notice && notice.tone === 'error' && v.popover !== 'more'
    this.noticeInline.hidden = !showNotice
    if (showNotice) setText(this.noticeInline, notice!.text)
  }

  private renderPopover(v: UiView): void {
    const kind = v.popover
    const content = kind === 'experiments' ? v.experiments : kind === 'more' ? [v.more, v.surface, this.repOpen, this.repDraft ? [...this.repDraft.on] : null] : null
    if (!this.changed('popover', [kind, content])) return
    const hadFocus = !!this.popEl && this.popEl.contains(this.root.ownerDocument.activeElement)
    const prevKind = this.popKind
    const opened = kind !== null && prevKind !== kind
    if (kind !== 'more') this.repOpen = false
    this.keepFocus(this.tools, () => {
      this.popEl?.remove()
      this.popEl = null
      this.popKind = kind
      if (!kind) return
      const pop = kind === 'experiments' ? this.buildPicker(v) : this.buildMore(v)
      this.tools.appendChild(pop)
      this.popEl = pop
    })
    if (kind === null && hadFocus && prevKind) this.buttons.get(prevKind)?.focus()
    if (opened && this.keyboardIntent && this.popEl) {
      const first = this.popEl.querySelector<HTMLElement>('[aria-current="true"]') ?? this.popEl.querySelector<HTMLElement>('button:not([aria-disabled="true"])')
      first?.focus()
    }
  }

  private buildPicker(v: UiView): HTMLElement {
    const pop = h('div', 'mw-pop mw-pop--experiments')
    pop.id = 'mw-pop-experiments'
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', 'Choose an experiment')
    this.buttons.get('experiments')?.setAttribute('aria-controls', pop.id)
    pop.appendChild(h('p', 'mw-pop-title', 'Experiments'))
    // One block per field, as wide as its cards (CSS: --span), so short fields share a row.
    const grid = h('div', 'mw-pick-grid')
    for (const g of fieldGroups(v.experiments)) {
      const group = h('div', 'mw-pick-group')
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', g.field)
      group.style.setProperty('--span', String(g.items.length))
      group.appendChild(h('p', 'mw-pick-field', g.field))
      for (const e of g.items) {
        const b = h('button', 'mw-pick')
        b.type = 'button'
        b.dataset.focusId = `pick:${e.kind}`
        // The question stays the accessible description (and what scripts find the card by).
        b.setAttribute('aria-label', `${e.title}: ${e.question}`)
        if (e.selected) b.setAttribute('aria-current', 'true')
        const icon = h('span', 'mw-pick-icon')
        icon.innerHTML = svg(EXPERIMENT_ICONS[e.kind], 22, 1.7)
        const text = h('span')
        text.append(h('span', 'mw-pick-q', e.title), h('span', 'mw-pick-t', e.topic))
        const check = h('span', 'mw-check')
        check.innerHTML = svg('M5.5 12.5l4.2 4.2L18.5 7.8', 14, 3)
        b.append(icon, text, check)
        b.addEventListener('click', () => this.onPick(e.kind))
        group.appendChild(b)
      }
      grid.appendChild(group)
    }
    pop.appendChild(grid)
    return pop
  }

  private buildMore(v: UiView): HTMLElement {
    const pop = h('div', 'mw-pop mw-pop--more')
    pop.id = 'mw-pop-more'
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', 'More')
    this.buttons.get('more')?.setAttribute('aria-controls', pop.id)
    const rep = v.more.representation
    if (rep && this.repDraft?.recipe !== rep.recipeName) this.repDraft = { recipe: rep.recipeName, on: new Map(rep.operations.map((o) => [o.kind, o.on])) }
    for (const sec of moreSections(v.more, v.surface)) {
      const s = h('section', 'mw-more-sec')
      const title = h('h3', 'mw-more-title', sec.title)
      title.id = `mw-more-${sec.id}`
      s.setAttribute('aria-labelledby', title.id)
      s.appendChild(title)
      for (const it of sec.items) {
        s.appendChild(this.moreButton(it, it.id === 'saveRepresentation' && !!rep))
        if (it.id === 'saveRepresentation' && rep && this.repOpen) s.appendChild(this.buildRepresentationEditor(rep))
      }
      pop.appendChild(s)
    }
    if (v.more.notice) {
      const n = h('p', 'mw-notice', v.more.notice.text)
      n.dataset.tone = v.more.notice.tone
      n.setAttribute('role', v.more.notice.tone === 'error' ? 'alert' : 'status')
      pop.appendChild(n)
    }
    return pop
  }

  private moreButton(it: MoreItem, expands: boolean): HTMLButtonElement {
    const b = h('button', 'mw-more-item')
    b.type = 'button'
    b.dataset.focusId = `more:${it.id}`
    const icon: IconName = it.id.startsWith('reset:') ? 'reset' : MORE_ICONS[it.id] ?? 'chevronRight'
    b.innerHTML = iconSvg(icon, 20)
    const text = h('span')
    text.appendChild(h('span', 'mw-more-label', it.label))
    const helper = !it.enabled && it.reason ? it.reason : it.helper
    if (helper) text.appendChild(h('span', 'mw-more-helper', helper))
    b.appendChild(text)
    setEnabled(b, it.enabled, it.reason, null)
    if (expands) setAttr(b, 'aria-expanded', String(this.repOpen))
    b.addEventListener('click', () => this.onMore(it.id))
    return b
  }

  private buildRepresentationEditor(rep: NonNullable<UiView['more']['representation']>): HTMLElement {
    const box = h('div', 'mw-rep')
    box.appendChild(h('p', 'mw-rep-name', `Based on ${rep.recipeName}: keep these operations`))
    const draft = this.repDraft!
    for (const op of rep.operations) {
      const label = h('label')
      const input = h('input')
      input.type = 'checkbox'
      input.checked = draft.on.get(op.kind) ?? op.on
      input.dataset.focusId = `rep:${op.kind}`
      label.classList.toggle('is-on', input.checked)
      input.addEventListener('change', () => {
        draft.on.set(op.kind, input.checked)
        label.classList.toggle('is-on', input.checked)
        save.setAttribute('aria-disabled', String(![...draft.on.values()].some(Boolean)))
      })
      label.append(input, h('span', undefined, op.label))
      box.appendChild(label)
    }
    const save = h('button', 'mw-rep-save', 'Save as new representation')
    save.type = 'button'
    save.dataset.focusId = 'rep:save'
    if (![...draft.on.values()].some(Boolean)) save.setAttribute('aria-disabled', 'true')
    save.addEventListener('click', () => {
      if (save.getAttribute('aria-disabled') === 'true') return
      this.onSaveRepresentation()
    })
    box.appendChild(save)
    return box
  }

  private renderInspector(v: UiView): void {
    const which = v.inspector
    this.inspector.hidden = !which
    if (!which) return
    const frame = inspectorFrame(which)
    setAttr(this.card, 'data-mode', which)
    setText(this.cardTitle, frame.title)
    setAttr(this.cardClose, 'aria-label', frame.close)
    setAttr(this.cardClose, 'title', frame.close)
    this.assistantSlot.hidden = which !== 'assistant'
    this.mathSlot.hidden = which !== 'math'
    if (which === 'math' && this.changed('math', v.presentation.detail)) this.keepFocus(this.mathSlot, () => this.buildMath(v.presentation.detail.sections))
  }

  private buildMath(sections: DetailSection[]): void {
    const root = this.mathSlot
    root.replaceChildren()
    if (!sections.length) {
      root.appendChild(h('p', 'mw-d-text', 'No mathematical detail for this view.'))
      return
    }
    for (const sec of sections) {
      const s = h('section', 'mw-sec')
      const head = h('div', 'mw-sec-head')
      head.appendChild(h('h3', 'mw-sec-title', sec.title))
      if (sec.provenance) {
        const p = h('span', 'mw-prov', sec.provenance)
        p.dataset.prov = sec.provenance
        head.appendChild(p)
      }
      s.appendChild(head)
      for (const it of sec.items) s.appendChild(this.detailItem(it))
      root.appendChild(s)
    }
  }

  private detailItem(it: DetailItem): HTMLElement {
    switch (it.kind) {
      case 'text':
        return h('p', 'mw-d-text', it.text)
      case 'formula': {
        const p = h('p', 'mw-d-formula', it.formula.plain)
        return p
      }
      case 'matrix': {
        const wrap = h('div', 'mw-d-matrix')
        if (it.label) wrap.appendChild(h('span', undefined, `${it.label.plain} =`))
        const m = h('span', 'mw-matrix')
        m.setAttribute('role', 'table')
        m.setAttribute('aria-label', `${it.label?.plain ?? 'Matrix'}, ${it.rows.length} by ${it.rows[0]?.length ?? 0}`)
        m.style.gridTemplateColumns = `repeat(${Math.max(1, it.rows[0]?.length ?? 1)}, auto)`
        for (const row of it.rows) for (const cell of row) m.appendChild(h('span', undefined, cell.replace(/^-/, '−')))
        wrap.appendChild(m)
        return wrap
      }
      case 'pairs': {
        const dl = h('dl', 'mw-d-pairs')
        for (const r of it.rows) dl.append(h('dt', undefined, r.key.plain), h('dd', undefined, r.value.plain))
        return dl
      }
      case 'list': {
        const ul = h('ul', 'mw-d-list')
        for (const x of it.items) ul.appendChild(h('li', undefined, x.plain))
        return ul
      }
      case 'evidence': {
        const ul = h('ul', 'mw-ev')
        for (const e of it.items) {
          const li = h('li')
          li.dataset.current = String(e.current)
          const head = h('div', 'mw-ev-head')
          const st = h('span', 'mw-ev-status', EVIDENCE_STATUS[e.status])
          st.dataset.status = e.status
          head.append(h('span', 'mw-ev-label', e.label), st)
          li.appendChild(head)
          if (e.statement) li.appendChild(h('p', 'mw-ev-stmt', e.statement))
          const meta: string[] = []
          if (e.provenance) meta.push(e.provenance)
          if (e.message) meta.push(e.message)
          const m = h('p', 'mw-ev-meta', meta.join(' · '))
          if (!e.current) {
            const hist = h('span', 'mw-ev-hist', meta.length ? ' · historical: the data changed since this check' : 'Historical: the data changed since this check')
            m.appendChild(hist)
          }
          if (meta.length || !e.current) li.appendChild(m)
          ul.appendChild(li)
        }
        return ul
      }
      case 'action': {
        const wrap = h('div', 'mw-d-action')
        const b = h('button', 'mw-secondary')
        b.type = 'button'
        b.dataset.focusId = `detail:${it.id}`
        b.textContent = it.label.plain
        setEnabled(b, it.enabled, it.reason, null)
        b.addEventListener('click', () => this.onDetailAction(it.id))
        wrap.appendChild(b)
        return wrap
      }
    }
  }

  /** Rebuild a region and give focus back to the same logical control if it still exists. */
  private keepFocus(container: HTMLElement, rebuild: () => void): void {
    const active = this.root.ownerDocument.activeElement as HTMLElement | null
    const id = active && container.contains(active) ? active.dataset.focusId : undefined
    rebuild()
    if (id) container.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`)?.focus()
  }
}
