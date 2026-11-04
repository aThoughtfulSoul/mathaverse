// Review C1 regression: TextSlot never shows content belonging to another key, and its pending/error
// layer always draws the CURRENT content. Builders are mocked; a stub canvas stands in for Canvas2D.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group } from 'three'

const h = vi.hoisted(() => ({
  composeResult: new Map<string, 'missing' | { error: string } | 'ok'>(),
  tokenStats: { version: 0 },
  pendingTex: new Map<string, { resolve: (e: unknown) => void; reject: (e: unknown) => void }>(),
}))

vi.mock('../src/rendering/glyphTokens', () => ({
  tokenStats: h.tokenStats,
  compose: (specs: { tex: string }[]) => {
    const key = specs.map((s) => s.tex).join('|')
    const r = h.composeResult.get(key) ?? 'missing'
    if (r === 'ok') {
      const group = new Group()
      group.add(new Group())
      return { group, width: 0.1, height: 0.02, dispose: () => group.removeFromParent() }
    }
    return r
  },
}))

vi.mock('../src/rendering/tex', () => ({
  peekTex: () => null,
  claimEntry: (e: { refs: number }) => void e.refs++,
  releaseEntry: (e: { refs: number; holder: Group }) => {
    e.refs--
    if (e.refs <= 0) e.holder.removeFromParent()
  },
  texGeometry: (parts: { tex: string }[]) =>
    new Promise((resolve, reject) => h.pendingTex.set(parts.map((p) => p.tex).join('|'), { resolve, reject })),
}))

beforeAll(() => {
  // Minimal Canvas2D stand-in (node has no DOM).
  ;(globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ font: '', textBaseline: '', fillStyle: '', measureText: (t: string) => ({ width: t.length * 20 }), fillText: () => undefined }),
    }),
  }
})

const { TextSlot } = await import('../src/rendering/textSlot')
const tokens = (plain: string, ...texes: string[]) => ({ kind: 'tokens' as const, tokens: texes.map((tex) => ({ tex, color: 0xffffff })), em: 0.02, color: 0xffffff, plain })
const texContent = (plain: string, tex: string) => ({ kind: 'tex' as const, parts: [{ tex }], em: 0.02, color: 0xffffff, plain })
const entry = () => ({ holder: new Group(), refs: 0, width: 0.1, height: 0.02 })

beforeEach(() => {
  h.composeResult.clear()
  h.pendingTex.clear()
})

describe('TextSlot freshness (review C1)', () => {
  it('a pending token readout redraws when its content changes while still pending (C1-a)', () => {
    const s = new TextSlot('eq:out')
    s.set(tokens('Pv = Pu = (1, 0, 0)', 'P', 'v'))
    expect(s.report().state).toBe('pending')
    expect(s.report().drawnPlain).toBe('Pv = Pu = (1, 0, 0)')
    s.set(tokens('Pv = (1/2, 0, 0)', 'P', 'v', 'x'))
    expect(s.report().state).toBe('pending')
    expect(s.report().drawnPlain).toBe('Pv = (1/2, 0, 0)')
    expect(s.report().typesetAttached).toBe(0)
  })

  it('composes as soon as the tokens exist, and drops the plain layer', () => {
    const s = new TextSlot('eq:sel')
    s.set(tokens('u = (1, 0, 1)', 'u'))
    h.composeResult.set('u', 'ok')
    h.tokenStats.version++
    s.frame(0)
    const r = s.report()
    expect(r.state).toBe('fresh')
    expect(r.drawnPlain).toBeNull()
    expect(r.typesetAttached).toBe(1)
    expect(r.shownKey).toBe(r.wantedKey)
  })

  it('a token build failure shows an explicit error with the current plain text', () => {
    const s = new TextSlot('eq:sel')
    h.composeResult.set('u|bad', { error: 'forced' })
    s.set(tokens('u = (1, 0, 5/8)', 'u', 'bad'))
    expect(s.report().state).toBe('error')
    expect(s.report().drawnPlain).toBe('u = (1, 0, 5/8)')
  })

  it('old typeset content is removed at once when the key changes; a late build for an old key is never shown', async () => {
    const s = new TextSlot('caption:out')
    s.set(texContent('3 samples share this exact output', 'A'))
    const eA = entry()
    h.pendingTex.get('A')!.resolve(eA)
    await Promise.resolve()
    s.frame(0)
    expect(s.report().state).toBe('fresh')
    expect(s.report().typesetAttached).toBe(1)
    s.set(texContent('no other sample shares this output', 'B'))
    expect(s.report().state).toBe('pending')
    expect(s.report().typesetAttached).toBe(0) // the "3 samples" geometry is gone immediately
    expect(s.report().drawnPlain).toBe('no other sample shares this output')
    s.set(texContent('4 samples share this exact output', 'C'))
    h.pendingTex.get('B')!.resolve(entry()) // late arrival for B
    await Promise.resolve()
    s.frame(0)
    expect(s.report().state).toBe('pending')
    expect(s.report().drawnPlain).toBe('4 samples share this exact output')
    const eC = entry()
    h.pendingTex.get('C')!.resolve(eC)
    await Promise.resolve()
    s.frame(0)
    expect(s.report().state).toBe('fresh')
    expect(s.report().shownKey).toBe(s.report().wantedKey)
  })

  it('a rejected build becomes an explicit error; a superseded one does not', async () => {
    const s = new TextSlot('caption:map')
    s.set(texContent('Coordinate projection discarding z', 'M'))
    h.pendingTex.get('M')!.reject(new Error('superseded'))
    await Promise.resolve()
    s.frame(0)
    expect(s.report().state).toBe('pending')
    s.set(texContent('Shear', 'S'))
    h.pendingTex.get('S')!.reject(new Error('MathJax failed'))
    await Promise.resolve()
    s.frame(0)
    expect(s.report().state).toBe('error')
    expect(s.report().drawnPlain).toBe('Shear')
    expect(s.report().error).toContain('MathJax failed')
  })
})
