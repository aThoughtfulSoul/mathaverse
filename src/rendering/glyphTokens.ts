// Prebuilt glyph tokens for readouts that change during interaction (review C1, hitch half).
//
// A readout such as "Pu = Pv = (1, 0, 3/8)" is laid out from tokens that were typeset once:
// names, operators, punctuation and every coordinate value a 1/8-snapped drag can produce. Composition
// is synchronous, so a readout always matches the description of the same frame and no MathJax work
// happens while dragging. Each token keeps MathJax's own outlines (renderLatexToSVG -> manim-web
// svgToVMobjects -> earcut fills); MathTex is not used here because it re-centres every equation and
// would lose the baseline. Spacing between tokens follows TeX's math spacing classes approximately.

import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, Mesh, MeshBasicMaterial, FrontSide, Sphere, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { renderLatexToSVG, svgToVMobjects } from 'manim-web'
import { initMathJax, queueTask, texDebug } from './tex'

export type Space = 'ord' | 'rel' | 'punct' | 'open' | 'close' | 'word'

export interface TokenSpec {
  tex: string
  color: number
  space?: Space
}

interface TokenGeo {
  /** Glyph fills in em units, baseline at y = 0, origin at the token's left edge (non-indexed). */
  geometry: BufferGeometry
  /** The same triangle vertices as a flat array, read directly by compose(). */
  positions: Float32Array
  /** Ink bounds (em), precomputed so composition never scans vertices to centre a readout. */
  minX: number
  maxX: number
  minY: number
  maxY: number
  /** MathJax advance width (em). */
  advance: number
}

const ready = new Map<string, TokenGeo>()
const building = new Map<string, Promise<void>>()
const failed = new Map<string, string>()
export const tokenStats = { built: 0, failed: 0, totalMs: 0, maxMs: 0, composed: 0, version: 0 }

/** TeX math spacing (em): thick space around relations; after a tuple comma the readouts used ",\\ "
 * (thin + interword space), kept here so token readouts match the typeset ones. */
const AFTER: Record<Space, number> = { ord: 0, rel: 0.2778, punct: 0.1667 + 0.25, open: 0, close: 0, word: 0.3 }
const BEFORE: Record<Space, number> = { ord: 0, rel: 0.2778, punct: 0, open: 0, close: 0, word: 0.3 }

export function tokenState(tex: string): 'ready' | 'building' | 'failed' | 'missing' {
  if (ready.has(tex)) return 'ready'
  if (failed.has(tex)) return 'failed'
  return building.has(tex) ? 'building' : 'missing'
}

/** Queue builds for tokens not built yet (one per main-thread task, shared with equation builds). */
export function requestTokens(texes: Iterable<string>): void {
  for (const tex of texes) {
    if (ready.has(tex) || failed.has(tex) || building.has(tex)) continue
    const p = queueTask(() => buildToken(tex)).then(
      (g) => {
        ready.set(tex, g)
        tokenStats.version++
      },
      (err: unknown) => {
        failed.set(tex, String(err))
        tokenStats.failed++
        tokenStats.version++
      },
    )
    building.set(tex, p.finally(() => building.delete(tex)))
  }
}

async function buildToken(tex: string): Promise<TokenGeo> {
  await initMathJax()
  if (texDebug.failPattern?.test(tex)) throw new Error(`forced failure (texDebug): ${tex}`)
  const t0 = performance.now()
  const r = await renderLatexToSVG(tex, { displayMode: false, color: '#ffffff' })
  // 1 em = 1000 MathJax units. flipY false: the library reads MathJax glyph data as y-up, baseline 0.
  const vg = svgToVMobjects(r.svgElement, { scale: 1 / 1000, flipY: false, strokeWidth: 0, fillOpacity: 1, color: '#ffffff' })
  if (vg.children.length === 0) {
    vg.dispose()
    r.vmobjectGroup.dispose()
    throw new Error(`TeX produced no glyphs: ${tex}`)
  }
  vg.disableChildZLayering()
  const obj = vg.getThreeObject()
  obj.updateMatrixWorld(true)
  const geos: BufferGeometry[] = []
  obj.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || (m as unknown as { isLine2?: boolean }).isLine2) return
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry
    const g = new BufferGeometry()
    g.setAttribute('position', src.getAttribute('position').clone())
    g.applyMatrix4(m.matrixWorld)
    geos.push(g)
  })
  vg.dispose()
  r.vmobjectGroup.dispose()
  const geometry = mergeGeometries(geos, false)
  geos.forEach((g) => g.dispose())
  if (!geometry) throw new Error(`no fill geometry: ${tex}`)
  const ms = performance.now() - t0
  tokenStats.built++
  tokenStats.totalMs += ms
  tokenStats.maxMs = Math.max(tokenStats.maxMs, ms)
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox!
  return { geometry, positions: geometry.getAttribute('position').array as Float32Array, minX: bb.min.x, maxX: bb.max.x, minY: bb.min.y, maxY: bb.max.y, advance: r.width / 1000 }
}

/** Resolves when every listed token is built or has failed (never rejects). */
export async function whenTokensSettled(texes: string[]): Promise<void> {
  requestTokens(texes)
  for (;;) {
    const pending = texes.map((t) => building.get(t)).filter(Boolean)
    if (!pending.length) return
    await Promise.allSettled(pending)
  }
}

export interface Composed {
  group: Group
  width: number
  height: number
  dispose(): void
  /** One mesh per colour; a later compose() for the same slot takes these over instead of reallocating. */
  readonly meshes: Map<number, Mesh>
}

/**
 * Lay out tokens left to right at `em` metres per em, centred on the origin. Returns 'missing' (and
 * queues the builds) when a token is not ready, or an error string when one failed.
 *
 * R6 follow-up F1 (profiled: composition was ~80 % of drag-frame adapter work): vertices are written in
 * one pass from each token's prebuilt array, centred from precomputed ink bounds, into one buffer per
 * colour. Passing the slot's previous result reuses its meshes, materials and (when large enough) its
 * vertex buffers, so a changing readout updates GPU data in place instead of creating new objects.
 */
export function compose(specs: TokenSpec[], em: number, prev: Composed | null = null): Composed | 'missing' | { error: string } {
  const missing = specs.filter((s) => !ready.has(s.tex))
  const bad = missing.find((s) => failed.has(s.tex))
  if (bad) return { error: failed.get(bad.tex)! }
  if (missing.length) {
    requestTokens(missing.map((s) => s.tex))
    return 'missing'
  }
  // Layout: left offsets (em), ink bounds, vertex counts per colour.
  const offsets: number[] = []
  const counts = new Map<number, number>()
  let x = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  specs.forEach((s, i) => {
    if (i > 0) x += Math.max(AFTER[specs[i - 1]!.space ?? 'ord'], BEFORE[s.space ?? 'ord'])
    const tok = ready.get(s.tex)!
    offsets.push(x)
    minX = Math.min(minX, x + tok.minX)
    maxX = Math.max(maxX, x + tok.maxX)
    minY = Math.min(minY, tok.minY)
    maxY = Math.max(maxY, tok.maxY)
    counts.set(s.color, (counts.get(s.color) ?? 0) + tok.positions.length)
    x += tok.advance
  })
  const cx = ((minX + maxX) / 2) * em
  const cy = ((minY + maxY) / 2) * em
  const width = (maxX - minX) * em
  const height = (maxY - minY) * em
  const group = new Group()
  const meshes = new Map<number, Mesh>()
  const cursor = new Map<number, number>()
  for (const [color, n] of counts) {
    // Take over the previous mesh of this colour when its buffer can hold the new vertices.
    const old = prev?.meshes.get(color)
    let mesh: Mesh
    const attr = old?.geometry.getAttribute('position') as BufferAttribute | undefined
    if (old && attr && attr.array.length >= n) {
      prev!.meshes.delete(color)
      mesh = old
    } else {
      const geometry = new BufferGeometry()
      const capacity = Math.ceil((n / 3) * 1.5) * 3
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity), 3).setUsage(DynamicDrawUsage))
      const material = old ? (old.material as MeshBasicMaterial) : new MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: FrontSide })
      if (old) {
        // Keep the material (and its current opacity); replace only the too-small buffer.
        prev!.meshes.delete(color)
        old.geometry.dispose()
        old.geometry = geometry
        mesh = old
      } else {
        mesh = new Mesh(geometry, material)
        mesh.renderOrder = 6
      }
    }
    mesh.geometry.setDrawRange(0, n / 3)
    mesh.geometry.boundingSphere = new Sphere(new Vector3(), Math.hypot(width, height) / 2 + 1e-4)
    meshes.set(color, mesh)
    cursor.set(color, 0)
    group.add(mesh)
  }
  specs.forEach((s, i) => {
    const src = ready.get(s.tex)!.positions
    const mesh = meshes.get(s.color)!
    const attr = mesh.geometry.getAttribute('position') as BufferAttribute
    const dst = attr.array as Float32Array
    let o = cursor.get(s.color)!
    const ox = offsets[i]!
    for (let k = 0; k < src.length; k += 3) {
      dst[o] = (src[k]! + ox) * em - cx
      dst[o + 1] = src[k + 1]! * em - cy
      dst[o + 2] = src[k + 2]! * em
      o += 3
    }
    cursor.set(s.color, o)
  })
  for (const [color, mesh] of meshes) {
    const attr = mesh.geometry.getAttribute('position') as BufferAttribute
    attr.clearUpdateRanges()
    attr.addUpdateRange(0, cursor.get(color)!)
    attr.needsUpdate = true
  }
  tokenStats.composed++
  return {
    group,
    width,
    height,
    meshes,
    dispose() {
      group.removeFromParent()
      for (const m of meshes.values()) {
        m.removeFromParent()
        m.geometry.dispose()
        ;(m.material as MeshBasicMaterial).dispose()
      }
      meshes.clear()
    },
  }
}

/** Dev: forget built tokens (forces rebuilds) - used by the freshness checks. */
export function clearTokens(): void {
  for (const t of ready.values()) t.geometry.dispose()
  ready.clear()
  failed.clear()
  tokenStats.version++
}
