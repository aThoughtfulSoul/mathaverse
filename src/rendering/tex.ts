// Equation geometry from manim-web's MathTex (MathJax -> SVG -> filled VMobjects -> three meshes).
// Builds run on their own main-thread tasks, one build per task, posted through a MessageChannel, so a
// request made from the frame callback never typesets inside that frame's task (R3). A newer request
// for the same slot supersedes a queued older one. MathJax still runs on the main thread: a Worker is
// the next step if headset traces show these tasks delaying frames.
// Settings come from the R6 source/runtime evidence (docs/COMPATIBILITY-REPORT.md):
//  - setMathJaxScriptUrl(null): no CDN fallback, failures stay local and immediate.
//  - strokeWidth 0: the default 1e-5 builds invisible Line2 strokes per glyph (draw calls, triangles).
//  - disableChildZLayering(): otherwise glyph i is pushed 0.01*i along z, visible as depth in stereo.
//  - a TeX error yields zero children with no thrown error, so that is treated as a failure here.
//  - each glyph is its own transparent DoubleSide mesh (two passes each): ~430 of 537 draw calls in the
//    first scene. The glyph fills are therefore merged into one single-pass mesh per colour; the
//    geometry is still manim-web's (MathJax outlines -> earcut fills), only the draw packaging changes.

import { Box3, Group, Vector3, Mesh, MeshBasicMaterial, BufferGeometry, FrontSide, type Material } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MathTex, setMathJaxScriptUrl, preloadMathJax } from 'manim-web'
import { hex } from '../ui/palette'

export interface TexPart {
  tex: string
  color?: number
}

export interface TexEntry {
  key: string
  /** Host-owned holder with one merged mesh per glyph colour. */
  holder: Group
  glyphs: number
  width: number
  height: number
  ms: number
  /** Slots currently holding this entry (claimEntry / releaseEntry). */
  refs: number
  /** Still reachable from the cache; uncached entries are disposed when their last holder releases them. */
  cached: boolean
}

let mathJaxReady: Promise<void> | null = null

export function initMathJax(): Promise<void> {
  if (!mathJaxReady) {
    setMathJaxScriptUrl(null)
    mathJaxReady = preloadMathJax()
  }
  return mathJaxReady
}

const cache = new Map<string, Promise<TexEntry>>()
const LIMIT = 160

export const texStats = { built: 0, failures: 0, superseded: 0, disposed: 0, totalMs: 0, maxMs: 0, queued: 0 }

function keyOf(parts: TexPart[], height: number, color: number, scope: string): string {
  return JSON.stringify([scope, parts.map((p) => [p.tex, p.color ?? null]), height, color])
}

interface Job {
  /** Cache key and slot scope for equation builds (supersession); null for other queued tasks. */
  key: string | null
  scope: string | null
  run: () => Promise<unknown>
  resolve: (v: never) => void
  reject: (err: unknown) => void
}

/**
 * Dev/test seams for C1 verification: delay every queued build, or make builds whose TeX matches a
 * pattern fail. Never set in normal use.
 */
export const texDebug = { delayMs: 0, failPattern: null as RegExp | null }

/** Resolved entries by cache key, so a slot can show cached geometry synchronously (no pending flash). */
const resolved = new Map<string, TexEntry>()

const queue: Job[] = []
let running = false
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null
if (channel) channel.port1.onmessage = () => void runNext()

function schedule(): void {
  if (running || !queue.length) return
  running = true
  if (channel) channel.port2.postMessage(0)
  else setTimeout(() => void runNext(), 0)
}

async function runNext(): Promise<void> {
  const job = queue.shift()
  texStats.queued = queue.length
  if (!job) {
    running = false
    return
  }
  try {
    if (texDebug.delayMs > 0) await new Promise((r) => setTimeout(r, texDebug.delayMs))
    job.resolve((await job.run()) as never)
  } catch (err) {
    job.reject(err)
  }
  running = false
  schedule()
}

/**
 * Build (or reuse) equation geometry. `em` is the font em in metres (consistent glyph size whatever the
 * content; sizing by total height would shrink words with descenders).
 * `scope` names the slot that will hold it: a three object has one parent, so two slots showing the
 * same TeX get separate entries. Callers claimEntry() what they show and releaseEntry() it afterwards.
 */
export function texGeometry(parts: TexPart[], em: number, color: number, scope: string): Promise<TexEntry> {
  const key = keyOf(parts, em, color, scope)
  let p = cache.get(key)
  if (p) {
    cache.delete(key) // LRU: re-insert on hit
    cache.set(key, p)
    return p
  }
  // A newer request for this slot supersedes its queued (not yet started) builds.
  for (let i = queue.length - 1; i >= 0; i--) {
    const j = queue[i]!
    if (j.scope === scope) {
      queue.splice(i, 1)
      if (j.key) cache.delete(j.key)
      texStats.superseded++
      j.reject(new Error('superseded'))
    }
  }
  p = new Promise<TexEntry>((resolve, reject) =>
    queue.push({ key, scope, run: () => build(key, parts, em, color), resolve: resolve as (v: never) => void, reject }),
  )
  p.then(
    (e) => {
      if (cache.get(key) === p) resolved.set(key, e)
    },
    () => cache.delete(key),
  )
  cache.set(key, p)
  texStats.queued = queue.length
  schedule()
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next().value!
    const victim = cache.get(oldest)!
    cache.delete(oldest)
    resolved.delete(oldest)
    void victim.then(
      (e) => {
        e.cached = false
        if (e.refs <= 0) disposeEntry(e)
      },
      () => undefined,
    )
  }
  return p
}

/** A finished, cached entry for exactly this content and slot, or null (never waits). */
export function peekTex(parts: TexPart[], em: number, color: number, scope: string): TexEntry | null {
  return resolved.get(keyOf(parts, em, color, scope)) ?? null
}

/** Run any other main-thread build (glyph tokens) on the same one-task-at-a-time queue. */
export function queueTask<T>(run: () => Promise<T>): Promise<T> {
  const p = new Promise<T>((resolve, reject) => queue.push({ key: null, scope: null, run, resolve: resolve as (v: never) => void, reject }))
  texStats.queued = queue.length
  schedule()
  return p
}

export function claimEntry(e: TexEntry): void {
  e.refs++
}

/** Detach; dispose once no slot holds it and the cache no longer references it. */
export function releaseEntry(e: TexEntry): void {
  e.refs = Math.max(0, e.refs - 1)
  if (e.refs === 0) {
    e.holder.removeFromParent()
    if (!e.cached) disposeEntry(e)
  }
}

/** Drop every cache reference; unheld entries are disposed now, held ones when released. */
export function clearTexCache(): void {
  const all = [...cache.values()]
  cache.clear()
  resolved.clear()
  for (const p of all) {
    void p.then(
      (e) => {
        e.cached = false
        if (e.refs <= 0) disposeEntry(e)
      },
      () => undefined,
    )
  }
}

async function build(key: string, parts: TexPart[], em: number, color: number): Promise<TexEntry> {
  await initMathJax()
  if (texDebug.failPattern && parts.some((p) => texDebug.failPattern!.test(p.tex))) {
    texStats.failures++
    throw new Error(`forced failure (texDebug): ${parts.map((p) => p.tex).join(' ')}`)
  }
  const t0 = performance.now()
  const multi = parts.length > 1
  // manim-web: 1 em = fontSize * 0.5 / 48 world units (constants/fontRender.ts), so fontSize = 96 * em.
  const mob = new MathTex({ latex: multi ? parts.map((p) => p.tex) : parts[0]!.tex, strokeWidth: 0, fontSize: 96 * em, color: hex(color) })
  await mob.waitForRender()
  if (mob.children.length === 0) {
    texStats.failures++
    throw new Error(`TeX produced no glyphs: ${parts.map((p) => p.tex).join(' ')}`)
  }
  mob.disableChildZLayering()
  if (multi) {
    parts.forEach((part, i) => {
      if (part.color !== undefined) mob.getPart(i)?.setColor(hex(part.color))
    })
  }
  const obj = mob.getThreeObject()
  obj.updateMatrixWorld(true)
  const byColor = new Map<number, BufferGeometry[]>()
  let glyphs = 0
  obj.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || (m as unknown as { isLine2?: boolean }).isLine2) return
    const mat = m.material as MeshBasicMaterial
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
    const g = new BufferGeometry()
    g.setAttribute('position', src.getAttribute('position').clone())
    g.applyMatrix4(m.matrixWorld)
    const c = mat.color.getHex()
    if (!byColor.has(c)) byColor.set(c, [])
    byColor.get(c)!.push(g)
    glyphs++
  })
  mob.dispose()
  const holder = new Group()
  holder.name = `tex:${parts.map((p) => p.tex).join('')}`.slice(0, 60)
  for (const [c, geos] of byColor) {
    const merged = mergeGeometries(geos, false)
    geos.forEach((g) => g.dispose())
    if (!merged) continue
    // Depth-tested so geometry in front occludes text in both eyes; no depth write (thin, blended).
    const mesh = new Mesh(merged, new MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, side: FrontSide }))
    mesh.renderOrder = 6
    holder.add(mesh)
  }
  const box = new Box3().setFromObject(holder)
  const size = box.getSize(new Vector3())
  const ms = performance.now() - t0
  texStats.built++
  texStats.totalMs += ms
  texStats.maxMs = Math.max(texStats.maxMs, ms)
  return { key, holder, glyphs, width: size.x, height: size.y, ms, refs: 0, cached: true }
}

export function disposeEntry(e: TexEntry): void {
  texStats.disposed++
  e.holder.removeFromParent()
  e.holder.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      ;(m.material as Material).dispose()
    }
  })
}
