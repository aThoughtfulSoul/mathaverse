// Transient UI state (UI-REFINEMENT-SPEC section 9): which inspector and popover are open and the unsent
// assistant draft. It lives outside the mathematical document, its revision, recipes and Undo stack, so
// opening a panel never bumps a revision or makes a pending assistant request stale. One viewer convenience is
// remembered in browser storage when available: that the learner closed the assistant panel.

export interface UiState {
  inspector: 'assistant' | 'math' | null
  popover: 'experiments' | 'more' | null
  /** Unsent typed question (kept across close/reopen; never submitted on its own). */
  draft: string
  /** The learner closed the assistant panel: keep it closed when switching experiments (and on later visits). */
  assistantDismissed: boolean
}

const DISMISSED_KEY = 'math-workspace.ui.assistantDismissed'

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(v: boolean): void {
  try {
    if (v) globalThis.localStorage?.setItem(DISMISSED_KEY, '1')
    else globalThis.localStorage?.removeItem(DISMISSED_KEY)
  } catch {
    /* private mode or blocked storage: the in-memory state still applies */
  }
}

export class UiStore {
  private s: UiState
  private readonly listeners = new Set<(s: UiState, prev: UiState) => void>()

  constructor(initial: Partial<UiState> = {}) {
    const dismissed = initial.assistantDismissed ?? readDismissed()
    // First visit: the assistant panel is open (without starting a request or the microphone).
    this.s = { inspector: dismissed ? null : 'assistant', popover: null, draft: '', assistantDismissed: dismissed, ...initial }
  }

  get state(): UiState {
    return this.s
  }

  subscribe(fn: (s: UiState, prev: UiState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  set(patch: Partial<UiState>): void {
    const prev = this.s
    const next = { ...prev, ...patch }
    if (Object.keys(next).every((k) => next[k as keyof UiState] === prev[k as keyof UiState])) return
    this.s = next
    if (next.assistantDismissed !== prev.assistantDismissed) writeDismissed(next.assistantDismissed)
    this.listeners.forEach((fn) => fn(next, prev))
  }
}
