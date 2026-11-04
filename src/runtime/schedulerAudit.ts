// Runtime evidence for "exactly one active scheduler" (RUNTIME-ADAPTER R2, R6.2). Imported before
// three or manim-web so every requestAnimationFrame / setTimeout / setInterval registration is seen.
// It records distinct rAF callback functions per second (three's animation loop re-registers one
// function every frame; any second loop shows up as a second callback) and every timer with its
// caller stack, so a timer started by the dependency can be named.

interface TimerRecord {
  kind: 'setTimeout' | 'setInterval'
  delay: number
  stack: string
  at: number
}

interface XRSessionLike {
  requestAnimationFrame(cb: (t: number, f: unknown) => void): number
}

const w = window as unknown as Record<string, unknown>
const origRaf = window.requestAnimationFrame.bind(window)
const origSetTimeout = window.setTimeout.bind(window)
const origSetInterval = window.setInterval.bind(window)
const origClearInterval = window.clearInterval.bind(window)

const timers: TimerRecord[] = []
const liveIntervals = new Map<number, TimerRecord>()
let windowRafCalls = 0
let xrRafCalls = 0
let windowCallbacks = new Set<unknown>()
let xrCallbacks = new Set<unknown>()
let lastWindow = { calls: 0, distinctCallbacks: 0, names: [] as string[] }
let lastXr = { calls: 0, distinctCallbacks: 0, names: [] as string[] }
const nameOf = (f: unknown) => (typeof f === 'function' ? f.name || '(anonymous)' : String(f))

function callerStack(): string {
  const s = new Error().stack ?? ''
  return s.split('\n').slice(3, 9).map((l) => l.trim()).join(' | ')
}

/** Count a window-rAF registration (also called by the DEV rAF shim, which replaces window.rAF). */
export function noteWindowRaf(cb: unknown): void {
  windowRafCalls++
  windowCallbacks.add(cb)
}

window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  noteWindowRaf(cb)
  return origRaf(cb)
}

w.setTimeout = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
  timers.push({ kind: 'setTimeout', delay: delay ?? 0, stack: callerStack(), at: performance.now() })
  if (timers.length > 400) timers.splice(0, 100)
  return origSetTimeout(handler, delay, ...rest)
}) as typeof setTimeout

w.setInterval = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
  const rec: TimerRecord = { kind: 'setInterval', delay: delay ?? 0, stack: callerStack(), at: performance.now() }
  timers.push(rec)
  const id = origSetInterval(handler, delay, ...rest)
  liveIntervals.set(id, rec)
  return id
}) as typeof setInterval

w.clearInterval = ((id?: number) => {
  if (id !== undefined) liveIntervals.delete(id)
  origClearInterval(id)
}) as typeof clearInterval

/** Wrap an XRSession's rAF so the XR-side loop is counted the same way. */
export function auditXRSession(session: XRSessionLike): void {
  const orig = session.requestAnimationFrame.bind(session)
  session.requestAnimationFrame = (cb) => {
    xrRafCalls++
    xrCallbacks.add(cb)
    return orig(cb)
  }
}

origSetInterval(() => {
  lastWindow = { calls: windowRafCalls, distinctCallbacks: windowCallbacks.size, names: [...windowCallbacks].map(nameOf) }
  lastXr = { calls: xrRafCalls, distinctCallbacks: xrCallbacks.size, names: [...xrCallbacks].map(nameOf) }
  windowRafCalls = 0
  xrRafCalls = 0
  windowCallbacks = new Set()
  xrCallbacks = new Set()
}, 1000)

export function schedulerReport() {
  return {
    lastSecond: { windowRaf: lastWindow, xrRaf: lastXr },
    liveIntervals: [...liveIntervals.values()].map((r) => ({ delay: r.delay, stack: r.stack })),
    timersSinceLoad: timers.length,
    manimWebTimers: timers.filter((t) => /manim-web/.test(t.stack)).map((t) => ({ kind: t.kind, delay: t.delay, stack: t.stack })),
    recentTimers: timers.slice(-12).map((t) => ({ kind: t.kind, delay: t.delay, stack: t.stack.slice(0, 240) })),
  }
}
