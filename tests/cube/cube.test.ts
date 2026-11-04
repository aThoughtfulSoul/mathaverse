// Demonstration 2 (worker B): the exact group G, the correspondence phi with the diagonal lines, the cube
// scene's derivation (chronological composition, the swap-from-objects convention, cards, limits) and the
// rotation path the scene animates. Exhaustive where the group is finite: all 24 elements, all 576 products.

import { describe, it, expect } from 'vitest'
import { Matrix4, Quaternion } from 'three'
import { groupOf, chronologicalProduct, matMul3, rotationInfo, transpose3, type IntMat3 } from '../../src/algebra/groups'
import { DIAGONALS, phiOf, rotationForDiagonalPermutation } from '../../src/algebra/cube'
import { compose, permEq, permKey, transposition, cycleText } from '../../src/algebra/permutation'
import { deriveCube, swapPermutation, type CubeDesc } from '../../src/domains/cube/derive'
import { inputOf, simState, simulate, type SimState } from '../../src/domains/cube/sim'
import { axisAngleMatrix, displayMatrix, displayQuaternion, displayVector } from '../../src/domains/cube/common'
import { DOMAIN_LIMITS } from '../../src/domains/inputs'
import { Workspace } from '../../src/workspace/reducer'
import { demoDocument } from '../../src/workspace/document'
import { cubeActions } from '../../src/demo/four'
import { sceneInputFor } from '../../src/domains/registry'

const G = groupOf({ kind: 'cube_rotations' })
const M = (e: string) => G.matrix(e)!
const RZ90 = 'r(y,-x,z)'
const H = 'r(-x,z,y)'
const RX90 = 'r(x,z,-y)'
const det = (m: IntMat3) => m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
const key = (m: IntMat3) => JSON.stringify(m)
const derive = (s: SimState) => deriveCube(inputOf(s))
const press = (s: SimState, actions: unknown[]) => simulate(s, actions)

describe('G: the 24 determinant-one signed permutation matrices', () => {
  it('has exactly 24 distinct matrices, each a signed permutation matrix with determinant +1', () => {
    expect(G.order).toBe(24)
    const mats = G.elements.map(M)
    expect(new Set(mats.map(key)).size).toBe(24)
    for (const m of mats) {
      expect(m.flat().every((v) => v === -1 || v === 0 || v === 1)).toBe(true)
      for (let i = 0; i < 3; i++) {
        expect(m[i]!.filter((v) => v !== 0).length).toBe(1)
        expect([0, 1, 2].filter((r) => m[r]![i] !== 0).length).toBe(1)
      }
      expect(det(m)).toBe(1)
    }
    // And nothing else: of the 48 signed permutation matrices exactly these 24 have determinant +1.
    let all = 0
    for (const p of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) for (let s = 0; s < 8; s++) {
      const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (p[j] === i ? (s >> j) & 1 ? -1 : 1 : 0)))
      if (det(m) === 1) {
        all++
        expect(mats.some((x) => key(x) === key(m))).toBe(true)
      }
    }
    expect(all).toBe(24)
  })

  it('is closed under the matrix product (all 576 ordered pairs) and multiply is that product', () => {
    const byKey = new Map(G.elements.map((e) => [key(M(e)), e]))
    for (const a of G.elements) for (const b of G.elements) {
      const p = matMul3(M(a), M(b))
      expect(byKey.get(key(p))).toBe(G.multiply(a, b))
    }
  })

  it('has the identity first and inverse = transpose', () => {
    expect(key(M(G.identity))).toBe(key([[1, 0, 0], [0, 1, 0], [0, 0, 1]]))
    for (const e of G.elements) {
      expect(key(M(G.inverse(e)))).toBe(key(transpose3(M(e))))
      expect(G.multiply(e, G.inverse(e))).toBe(G.identity)
    }
  })

  it('has the fixture matrices Rz90 (order 4) and H (a proper half-turn, order 2)', () => {
    expect(key(M(RZ90))).toBe(key([[0, -1, 0], [1, 0, 0], [0, 0, 1]]))
    expect(key(M(H))).toBe(key([[-1, 0, 0], [0, 0, 1], [0, 1, 0]]))
    expect(det(M(H))).toBe(1)
    expect(G.elementOrder(RZ90)).toBe(4)
    expect(G.elementOrder(H)).toBe(2)
  })
})

describe('phi: G -> S4 on the four unoriented diagonal lines', () => {
  it('is defined by M d_i = +-d_j and is a bijection onto all 24 permutations of 4 points', () => {
    const seen = new Set<string>()
    for (const e of G.elements) {
      const p = phiOf(e)
      DIAGONALS.forEach((d, i) => {
        const v = [0, 1, 2].map((r) => M(e)[r]!.reduce((s, x, c) => s + x * d[c]!, 0))
        const t = DIAGONALS[p[i]!]!
        expect(v.every((x, k) => x === t[k]) || v.every((x, k) => x === -t[k]!)).toBe(true)
      })
      seen.add(permKey(p))
      expect(rotationForDiagonalPermutation(p)).toBe(e)
    }
    expect(seen.size).toBe(24)
  })

  it('preserves all 576 ordered products: phi(A B) = compose(phi(A), phi(B))', () => {
    let n = 0
    for (const a of G.elements) for (const b of G.elements) {
      expect(permEq(phiOf(G.multiply(a, b)), compose(phiOf(a), phiOf(b)))).toBe(true)
      n++
    }
    expect(n).toBe(576)
  })

  it('matches the fixtures phi(Rz90) = [1,3,0,2] and phi(H) = [1,0,2,3]', () => {
    expect([...phiOf(RZ90)]).toEqual([1, 3, 0, 2])
    expect([...phiOf(H)]).toEqual([1, 0, 2, 3])
    expect(cycleText(phiOf(RZ90))).toBe('(0 1 3 2)')
  })
})

describe('deriveCube: plain, deterministic, chronological', () => {
  it('is deterministic plain data (JSON round trip, two derivations equal)', () => {
    const s = simState({ history: [{ element: RZ90, via: 'element' }, { element: H, via: 'diagonal_lines' }], item: 'line:2' })
    const a = derive(s)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    expect(derive(s)).toEqual(a)
  })

  it('resolves history [A, B] to B·A, labelled "A, then B", for all 576 pairs; cube and objects agree', () => {
    for (const a of G.elements) for (const b of G.elements) {
      const s = simState({ history: [{ element: a, via: 'element' }, { element: b, via: 'element' }] })
      const d = derive(s)
      expect(d.element).toBe(G.multiply(b, a))
      expect(d.element).toBe(chronologicalProduct(G, [a, b]))
      expect(d.agree).toBe(true)
      expect(d.objectsPerm).toEqual([...phiOf(d.element)])
      expect(d.history[1]!.before).toBe(a)
      expect(d.history[1]!.slotsAfter).toEqual([...phiOf(d.element)])
      expect(d.word!.plain).toBe(`steps: ${G.label(a).plain}, then ${G.label(b).plain}`)
    }
    const d = derive(simState({ history: [{ element: RZ90, via: 'element' }, { element: H, via: 'element' }] }))
    // Conventional product written right to left: k = H Rz.
    expect(d.state.tex).toBe(`k = ${G.label(H).tex}\\,${G.label(RZ90).tex} = ${G.label(G.multiply(H, RZ90)).tex}`)
    expect(d.status).toMatch(/^Rz then Eyz: the cube and the four diagonals agree/)
  })

  it('shows Rz90 driven by the cube with phi = (0 1 3 2) and the objects on lines [1,3,0,2]', () => {
    const d = derive(press(simState(), [{ kind: 'apply_element', experimentId: 'exp-cube', element: RZ90 }]))
    expect(d.driver).toBe('cube')
    expect(d.phi).toEqual([1, 3, 0, 2])
    expect(d.occupant).toEqual([2, 0, 3, 1])
    expect(d.phiText.tex).toBe('\\varphi(k) = (0\\;1\\;3\\;2)')
  })
})

describe('swap from the objects: transposition of the line SLOTS the two chosen objects occupy', () => {
  it('for every orientation k and every pair a, b: exactly one rotation; a and b exchange lines, the other two stay', () => {
    let checked = 0
    for (const k of G.elements) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      if (a === b) continue
      const before = phiOf(k)
      // Build the state with orientation k, press object a, then object b (the scene's own actions).
      const s0 = simState({ history: k === G.identity ? [] : [{ element: k, via: 'element' }] })
      const s1 = press(s0, derive(s0).objects[a]!.actions)
      expect(derive(s1).selectedLine).toBe(a)
      const proposal = derive(s1).objects[b]!
      expect(proposal.actions[0]).toEqual({ kind: 'apply_permutation', experimentId: 'exp-cube', representation: 'diagonal_lines', permutation: [...transposition(4, before[a]!, before[b]!)] })
      const s2 = press(s1, proposal.actions)
      const d = derive(s2)
      const step = d.history[d.history.length - 1]!
      expect(step.via).toBe('diagonal_lines')
      expect(d.driver).toBe('objects')
      expect(d.selectedLine).toBe(null)
      // Exactly one rotation g with phi(g) = the slot transposition, and the step is that g.
      const candidates = G.elements.filter((g) => permEq(phiOf(g), proposal.swap!.permutation))
      expect(candidates).toEqual([step.element])
      expect(proposal.swap!.element).toBe(step.element)
      // a and b exchanged their lines; the other two objects did not move.
      expect(d.phi[a]).toBe(before[b])
      expect(d.phi[b]).toBe(before[a])
      for (let c = 0; c < 4; c++) if (c !== a && c !== b) expect(d.phi[c]).toBe(before[c])
      expect(step.swapped).toEqual([Math.min(a, b), Math.max(a, b)])
      expect(d.agree).toBe(true)
      checked++
    }
    expect(checked).toBe(24 * 12)
  })

  it('is not the same as transposing the identities (that would be wrong once k is not the identity)', () => {
    let differs = 0
    for (const k of G.elements) for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const wrong = rotationForDiagonalPermutation(transposition(4, a, b))!
      const right = rotationForDiagonalPermutation(swapPermutation(k, a, b))!
      const after = phiOf(G.multiply(wrong, k))
      const swappedCorrectly = after[a] === phiOf(k)[b] && after[b] === phiOf(k)[a]
      if (wrong !== right) {
        differs++
        expect(swappedCorrectly).toBe(false)
      }
    }
    expect(differs).toBeGreaterThan(0)
  })

  it('at the identity, swapping objects 0 and 1 is the half-turn H', () => {
    const s1 = press(simState(), derive(simState()).objects[0]!.actions)
    const d = derive(press(s1, derive(s1).objects[1]!.actions))
    expect(d.element).toBe(H)
    expect(d.phi).toEqual([1, 0, 2, 3])
  })
})

describe('cards, return and limits', () => {
  it('cards are Rx, Ry, Rz quarter turns and H; Return applies the inverse and comes home', () => {
    const d0 = derive(simState())
    expect(d0.cards.map((c) => c.element)).toEqual([RX90, 'r(-z,y,x)', RZ90, H, null])
    expect(d0.cards[4]!.enabled).toBe(false)
    let s = simState()
    for (const id of ['card:rz', 'card:h']) s = press(s, derive(s).cards.find((c) => c.id === id)!.actions)
    const d1 = derive(s)
    expect(d1.element).toBe(G.multiply(H, RZ90))
    const ret = d1.cards.find((c) => c.id === 'card:return')!
    expect(ret.actions).toEqual([{ kind: 'apply_element', experimentId: 'exp-cube', element: G.inverse(d1.element) }])
    const d2 = derive(press(s, ret.actions))
    expect(d2.element).toBe(G.identity)
    expect(d2.isHome).toBe(true)
    expect(d2.history.length).toBe(3)
    expect(d2.phi).toEqual([0, 1, 2, 3])
  })

  it('refuses nothing silently at 24 steps: every card and swap proposes no action and says why', () => {
    const s = simState({ history: Array.from({ length: DOMAIN_LIMITS.history }, () => ({ element: RX90, via: 'element' as const })), item: 'line:0' })
    const d = derive(s)
    expect(d.historyFull).toBe(true)
    for (const c of d.cards) expect(c.actions).toEqual([])
    for (const o of d.objects.slice(1)) {
      expect(o.actions).toEqual([])
      expect(o.hint).toMatch(/24 steps/)
    }
  })
})

describe('the animated path (presentation): rigid rotation about the step axis ends exactly at g·k', () => {
  it('rotating by rotationInfo(g) about its axis reproduces matrix(g) for every element', () => {
    for (const e of G.elements) {
      const info = rotationInfo(M(e))
      if (!info.axis) continue
      const r = axisAngleMatrix(info.axis, info.angle)
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(Math.abs(r[i]![j]! - M(e)[i]![j]!)).toBeLessThan(1e-12)
    }
  })

  it('in display coordinates (E3), axis-angle about E3(axis) times Q(k) equals Q(g·k) for all 576 pairs', () => {
    const q = new Quaternion()
    for (const g of G.elements) {
      const info = rotationInfo(M(g))
      if (!info.axis) continue
      const axis = displayVector(info.axis, 1)
      for (const k of G.elements) {
        q.setFromAxisAngle(axis, info.angle).multiply(displayQuaternion(M(k)))
        const want = displayQuaternion(M(G.multiply(g, k)))
        expect(Math.abs(Math.abs(q.dot(want)) - 1)).toBeLessThan(1e-9)
      }
    }
  })

  it('displayMatrix is E M E^T (Rz90 turns display x toward display -z, i.e. math y)', () => {
    const d = displayMatrix(M(RZ90))
    const m4 = new Matrix4().makeRotationFromQuaternion(displayQuaternion(M(RZ90)))
    const e = m4.elements
    // Column 0 of D is where display x goes: E3(Rz90 e_x) = E3(e_y) = (0, 0, -1).
    expect([d[0]![0], d[1]![0], d[2]![0]]).toEqual([0, 0, -1])
    expect([e[0], e[1], e[2]].map((v) => Math.round(v!))).toEqual([0, 0, -1])
  })

  it('generic mid-path orientations are not cube symmetries; some special ones are, so motion is never labelled', () => {
    const signed = (r: number[][]) => r.flat().every((v) => Math.abs(v) < 1e-9 || Math.abs(Math.abs(v) - 1) < 1e-9)
    for (const e of G.elements) {
      const info = rotationInfo(M(e))
      if (!info.axis) continue
      expect(signed(axisAngleMatrix(info.axis, info.angle * 0.37))).toBe(false)
    }
    // Halfway through the face half-turn Rx^2 the cube passes through Rx: geometry alone must not name a state.
    const rx2 = rotationInfo(M('r(x,-y,-z)'))
    expect(signed(axisAngleMatrix(rx2.axis!, rx2.angle * 0.5))).toBe(true)
  })
})

describe('through the real planner (src/workspace) and registry', () => {
  it('cards and the swap commit as ordinary actions; the derived scene matches the exact history', () => {
    const ws = new Workspace(demoDocument())
    ws.commit({ baseRevision: ws.current.revision, actions: cubeActions(ws.current) })
    const view = (): CubeDesc => {
      const inp = sceneInputFor(ws.current)
      expect(inp?.layout).toBe('cube')
      return deriveCube((inp as { layout: 'cube'; group: Parameters<typeof deriveCube>[0] }).group)
    }
    const commit = (actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
    commit(view().cards.find((c) => c.id === 'card:rz')!.actions)
    commit(view().cards.find((c) => c.id === 'card:h')!.actions)
    expect(view().element).toBe(G.multiply(H, RZ90))
    // Swap objects 0 and 2 from the objects.
    const before = view().phi
    commit(view().objects[0]!.actions)
    commit(view().objects[2]!.actions)
    const d = view()
    expect(d.history.map((h) => h.via)).toEqual(['element', 'element', 'diagonal_lines'])
    expect(d.phi[0]).toBe(before[2])
    expect(d.phi[2]).toBe(before[0])
    expect(d.phi[1]).toBe(before[1])
    expect(d.phi[3]).toBe(before[3])
    expect(d.selectedLine).toBe(null)
    // Return comes home.
    commit(d.cards.find((c) => c.id === 'card:return')!.actions)
    expect(view().element).toBe(G.identity)
  })
})
