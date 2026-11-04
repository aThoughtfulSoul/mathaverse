// A minimal FAKE DOM for the desktop assistant content (no DOM library is installed): elements with
// attributes, children, listeners and bubbling events. Enough for src/ui/assistant/dom.ts, nothing more.

export interface FakeEvent {
  type: string
  key?: string
  shiftKey?: boolean
  isComposing?: boolean
  button?: number
  detail?: number
  pointerId?: number
  target: FakeEl | null
  defaultPrevented: boolean
  propagationStopped: boolean
  preventDefault(): void
  stopPropagation(): void
}

type Listener = (e: FakeEvent) => void

export class FakeEl {
  children: FakeEl[] = []
  parent: FakeEl | null = null
  className = ''
  id = ''
  type = ''
  rows = 0
  placeholder = ''
  title = ''
  value = ''
  hidden = false
  disabled = false
  private text = ''
  private html = ''
  attrs: Record<string, string> = {}
  listeners: Record<string, Listener[]> = {}
  constructor(readonly tagName: string, readonly ownerDocument: FakeDoc) {}
  get textContent(): string {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this.text
  }
  set textContent(t: string) {
    this.children = []
    this.text = t
  }
  get innerHTML(): string {
    return this.html
  }
  set innerHTML(h: string) {
    this.children = []
    this.text = ''
    this.html = h
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null
  }
  append(...cs: FakeEl[]) {
    for (const c of cs) {
      c.remove()
      c.parent = this
      this.children.push(c)
    }
  }
  replaceChildren(...cs: FakeEl[]) {
    for (const c of this.children) c.parent = null
    this.children = []
    this.text = ''
    this.append(...cs)
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
  get parentElement(): FakeEl | null {
    return this.parent
  }
  /** Insert (or move) `node` before `ref`, a child of this element (at the end when ref is null). */
  insertBefore(node: FakeEl, ref: FakeEl | null) {
    node.remove()
    const i = ref ? this.children.indexOf(ref) : -1
    node.parent = this
    if (i < 0) this.children.push(node)
    else this.children.splice(i, 0, node)
    return node
  }
  addEventListener(t: string, fn: Listener) {
    ;(this.listeners[t] ??= []).push(fn)
  }
  removeEventListener(t: string, fn: Listener) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn)
  }
  setPointerCapture() {}
  /** Dispatch at this element and bubble to the ancestors unless propagation is stopped. */
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = { type, target: this, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.propagationStopped = true }, ...init }
    for (let n: FakeEl | null = this; n && !e.propagationStopped; n = n.parent) for (const fn of [...(n.listeners[type] ?? [])]) fn(e)
    return e
  }
  /** Depth-first search by an attribute value. */
  all(attr: string, value?: string): FakeEl[] {
    const out: FakeEl[] = []
    const walk = (n: FakeEl) => {
      if (n.attrs[attr] !== undefined && (value === undefined || n.attrs[attr] === value)) out.push(n)
      n.children.forEach(walk)
    }
    walk(this)
    return out
  }
  find(attr: string, value?: string): FakeEl {
    const hit = this.all(attr, value)[0]
    if (!hit) throw new Error(`no [${attr}${value ? `=${value}` : ''}]`)
    return hit
  }
  /** Visible = neither it nor an ancestor is hidden. */
  get shown(): boolean {
    for (let n: FakeEl | null = this; n; n = n.parent) if (n.hidden) return false
    return true
  }
}

export class FakeDoc {
  createElement(tag: string) {
    return new FakeEl(tag.toUpperCase(), this)
  }
}
