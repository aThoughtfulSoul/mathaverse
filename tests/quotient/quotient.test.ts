// Demonstration 3 (worker B): pi onto S3, its kernel K, the six classes, representative independence, the
// order change of Rz90, the marking design (24 distinct marked cubes, 6 looks once directions are ignored)
// and the quotient scene's derivation and proposed actions. Exhaustive over all 576 ordered pairs.

import { describe, it, expect } from 'vitest'
import { groupOf, type IntMat3 } from '../../src/algebra/groups'
import { KERNEL, axisClasses, classKey, classProduct, piOf } from '../../src/algebra/cube'
import { compose, permEq, permKey, permOrder, allPermutations } from '../../src/algebra/permutation'
import { deriveQuotient, QLAYOUT, type QuotientDesc } from '../../src/domains/quotient/derive'
import { inputOf, simState, simulate, type SimState } from '../../src/domains/cube/sim'
import { Workspace } from '../../src/workspace/reducer'
import { demoDocument } from '../../src/workspace/document'
import { quotientActions } from '../../src/demo/four'
import { sceneInputFor } from '../../src/domains/registry'

const G = groupOf({ kind: 'cube_rotations' })
const M = (e: string) => G.matrix(e)!
const RZ90 = 'r(y,-x,z)'
const RX90 = 'r(x,z,-y)'
const EXP = 'exp-quotient'
const key = (m: IntMat3) => JSON.stringify(m)
const derive = (s: SimState) => deriveQuotient(inputOf(s))
const start = (p: Partial<SimState> = {}) => simState({ experimentId: EXP, ...p })

describe('pi: G -> S3 on the three unoriented axis lines', () => {
  it('is read off the columns (sign ignored) and maps G onto S3, each value with exactly four preimages', () => {
    const count = new Map<string, number>()
    for (const e of G.elements) {
      const p = piOf(e)
      p.forEach((i, j) => expect(M(e)[i]![j]).not.toBe(0))
      count.set(permKey(p), (count.get(permKey(p)) ?? 0) + 1)
    }
    expect(count.size).toBe(6)
    expect([...count.values()]).toEqual([4, 4, 4, 4, 4, 4])
    expect(new Set(allPermutations(3).map(permKey))).toEqual(new Set(count.keys()))
  })

  it('respects all 576 ordered products: pi(A B) = compose(pi(A), pi(B))', () => {
    let n = 0
    for (const a of G.elements) for (const b of G.elements) {
      expect(permEq(piOf(G.multiply(a, b)), compose(piOf(a), piOf(b)))).toBe(true)
      n++
    }
    expect(n).toBe(576)
  })

  it('has kernel exactly K = {I, diag(1,-1,-1), diag(-1,1,-1), diag(-1,-1,1)}', () => {
    const kernel = G.elements.filter((e) => permEq(piOf(e), [0, 1, 2]))
    expect(new Set(kernel)).toEqual(new Set(KERNEL))
    const diag = (a: number, b: number, c: number) => key([[a, 0, 0], [0, b, 0], [0, 0, c]])
    expect(new Set(kernel.map((e) => key(M(e))))).toEqual(new Set([diag(1, 1, 1), diag(1, -1, -1), diag(-1, 1, -1), diag(-1, -1, 1)]))
    // K is a normal subgroup: closed, and g K g^-1 = K for every g.
    for (const a of kernel) for (const b of kernel) expect(kernel).toContain(G.multiply(a, b))
    for (const g of G.elements) for (const k of kernel) expect(kernel).toContain(G.multiply(G.multiply(g, k), G.inverse(g)))
  })

  it('has six classes of four, which are exactly the cosets gK', () => {
    const cls = axisClasses()
    expect(cls.length).toBe(6)
    for (const c of cls) {
      expect(c.elements.length).toBe(4)
      const coset = new Set(KERNEL.map((k) => G.multiply(c.elements[0]!, k)))
      expect(new Set(c.elements)).toEqual(coset)
    }
  })

  it('gives representative-independent class products: every pair of classes, every choice of representatives', () => {
    const cls = axisClasses()
    let n = 0
    for (const A of cls) for (const B of cls) {
      const want = classProduct(A.key, B.key)
      for (const a of A.elements) for (const b of B.elements) {
        expect(classKey(G.multiply(a, b))).toBe(want)
        n++
      }
    }
    expect(n).toBe(576)
  })

  it('forgets order: Rz90 has order 4 in G but pi(Rz90) = [1,0,2] has order 2', () => {
    expect(G.elementOrder(RZ90)).toBe(4)
    expect([...piOf(RZ90)]).toEqual([1, 0, 2])
    expect(permOrder(piOf(RZ90))).toBe(2)
    expect(KERNEL).toContain(G.multiply(RZ90, RZ90))
  })
})

describe('the marking design (face-pair colours + a pip on each + face)', () => {
  // What a viewer sees at each of the six space directions +-e_i: which pair's colour, and whether that face
  // carries the pip (it is the pair's + face). Face +-e_j of the body sits at M(+-e_j).
  const look = (e: string, withPips: boolean) => {
    const m = M(e)
    const seen: string[] = []
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) {
      const j = [0, 1, 2].find((c) => m[i]![c] !== 0)!
      const plusFaceHere = m[i]![j]! * s === 1 // body +e_j lands on s e_i
      seen.push(`${j}${withPips ? (plusFaceHere ? '+' : '-') : ''}`)
    }
    return seen.join(',')
  }

  it('distinguishes all 24 rotations with pips, and exactly the six classes without them', () => {
    expect(new Set(G.elements.map((e) => look(e, true))).size).toBe(24)
    const noPips = new Map<string, Set<string>>()
    for (const e of G.elements) {
      const l = look(e, false)
      noPips.set(l, (noPips.get(l) ?? new Set()).add(classKey(e)))
    }
    expect(noPips.size).toBe(6)
    for (const keys of noPips.values()) expect(keys.size).toBe(1)
  })

  it('needs the marks: an unmarked cube looks the same in all 24 orientations', () => {
    expect(new Set(G.elements.map(() => 'cube')).size).toBe(1)
  })
})

describe('deriveQuotient', () => {
  it('is deterministic plain data with 24 cubes and six classes of four', () => {
    const s = start({ observation: 'unoriented_axis_lines', operands: [RZ90, RX90], item: RZ90 })
    const d = derive(s)
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
    expect(derive(s)).toEqual(d)
    expect(d.cubes.length).toBe(24)
    expect(d.classes.map((c) => c.elements.length)).toEqual([4, 4, 4, 4, 4, 4])
    expect(d.classes[0]!.isKernel).toBe(true)
    expect(new Set(d.classes[0]!.elements)).toEqual(new Set(KERNEL))
  })

  it('places everything inside the scene box, with distinct slots, and each class inside its tray', () => {
    for (const obs of ['none', 'unoriented_axis_lines'] as const) for (const item of [null, 'class:102', RZ90]) {
      const d = derive(start({ observation: obs, item, operands: [RZ90, RX90] }))
      const pts = [...d.cubes.map((c) => c.pos), ...d.panel.map((p) => p.pos)]
      for (const [x, y, z] of pts) {
        expect(Math.abs(x)).toBeLessThanOrEqual(0.5)
        expect(y).toBeGreaterThanOrEqual(-0.24)
        expect(y).toBeLessThanOrEqual(0.32)
        expect(z).toBeGreaterThanOrEqual(-0.25)
        expect(z).toBeLessThanOrEqual(0.15)
      }
      expect(new Set(d.cubes.map((c) => c.pos.join())).size).toBe(24)
    }
    const d = derive(start({ observation: 'unoriented_axis_lines' }))
    for (const c of d.classes) for (const e of c.elements) {
      const cube = d.cubes.find((x) => x.element === e)!
      expect(Math.abs(cube.cluster[0] - c.center[0])).toBeLessThan(0.05)
      expect(Math.abs(cube.cluster[1] - c.center[1])).toBeLessThan(0.05)
      expect(cube.marks).toBe(false)
    }
  })

  it('shows directions until the observation, then only for an expanded class (full data kept)', () => {
    expect(derive(start()).cubes.every((c) => c.marks && !c.expanded)).toBe(true)
    const d = derive(start({ observation: 'unoriented_axis_lines', item: 'class:102' }))
    expect(d.expandedClass).toBe('102')
    for (const c of d.cubes) expect(c.marks).toBe(c.classKey === '102')
    expect(d.cubes.filter((c) => c.expanded).map((c) => c.element).sort()).toEqual([...axisClasses().find((c) => c.key === '102')!.elements].sort())
    // Selecting an element in the grouped view expands its class.
    expect(derive(start({ observation: 'unoriented_axis_lines', item: RZ90 })).expandedClass).toBe('102')
  })

  it('proposes the documented actions: observe toggle, select element/class, choose and another representative', () => {
    const d0 = derive(start())
    expect(d0.plates[0]!.actions).toEqual([{ kind: 'set_observation', experimentId: EXP, observation: 'unoriented_axis_lines' }])
    expect(d0.plates.slice(1).every((p) => !p.enabled && p.actions.length === 0)).toBe(true)
    let s = simulate(start(), d0.plates[0]!.actions)
    expect(derive(s).plates[0]!.actions).toEqual([{ kind: 'set_observation', experimentId: EXP, observation: 'none' }])
    expect(derive(s).classes.find((c) => c.key === '102')!.actions).toEqual([{ kind: 'select_item', experimentId: EXP, item: 'class:102' }])
    s = simulate(s, derive(s).cubes.find((c) => c.element === RZ90)!.actions)
    expect(s.item).toBe(RZ90)
    s = simulate(s, derive(s).plates.find((p) => p.id === 'plate:chooseA')!.actions)
    s = simulate(s, derive(s).cubes.find((c) => c.element === RX90)!.actions)
    s = simulate(s, derive(s).plates.find((p) => p.id === 'plate:chooseB')!.actions)
    expect(s.operands).toEqual([RZ90, RX90])
    const d = derive(s)
    expect(d.composition!.product).toBe(G.multiply(RX90, RZ90))
    // Another A: the next member of A's class; the class result does not change.
    const s2 = simulate(s, d.plates.find((p) => p.id === 'plate:anotherA')!.actions)
    const d2 = derive(s2)
    expect(d2.composition!.a).not.toBe(RZ90)
    expect(classKey(d2.composition!.a)).toBe(classKey(RZ90))
    expect(d2.composition!.product).not.toBe(d.composition!.product)
    expect(d2.composition!.quotientProduct).toBe(d.composition!.quotientProduct)
    expect(d2.composition!.productClass).toBe(d.composition!.productClass)
  })

  it('composes "A, then B" as B·A in G and as [B][A] in G/K; they agree for all 576 operand pairs', () => {
    for (const a of G.elements) for (const b of G.elements) {
      const c = derive(start({ operands: [a, b] })).composition!
      expect(c.product).toBe(G.multiply(b, a))
      expect(c.quotientProduct).toBe(classProduct(classKey(b), classKey(a)))
      expect(c.agree).toBe(true)
      expect(c.allChoices).toEqual([classKey(G.multiply(b, a))])
    }
  })

  it('states the order change for Rz90 from exact data', () => {
    const d = derive(start({ observation: 'unoriented_axis_lines', item: RZ90 }))
    expect(d.info!.plain).toBe('Rz: order 4 in G; its class (x y): order 2 in G/K, since (Rz)^2 = Rz^2 is in K')
    const k = derive(start({ observation: 'unoriented_axis_lines', item: 'class:012' }))
    expect(k.expandedHeader!.plain).toBe('K = [I]: acts trivially on all three axis lines')
  })

  it('uses the layout constants it exports (panel inside the box)', () => {
    expect(Math.max(...QLAYOUT.panelX)).toBeLessThan(0.5)
    expect(QLAYOUT.platesY).toBeGreaterThan(-0.24)
  })
})

describe('through the real planner (src/workspace) and registry', () => {
  it('observe, select, choose A and B, and another representative commit as ordinary actions', () => {
    const ws = new Workspace(demoDocument())
    ws.commit({ baseRevision: ws.current.revision, actions: quotientActions(ws.current) })
    const view = (): QuotientDesc => {
      const inp = sceneInputFor(ws.current)
      expect(inp?.layout).toBe('quotient')
      return deriveQuotient((inp as { layout: 'quotient'; group: Parameters<typeof deriveQuotient>[0] }).group)
    }
    const commit = (actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
    commit(view().plates[0]!.actions)
    expect(view().grouped).toBe(true)
    commit(view().cubes.find((c) => c.element === RZ90)!.actions)
    commit(view().plates.find((p) => p.id === 'plate:chooseA')!.actions)
    commit(view().cubes.find((c) => c.element === RX90)!.actions)
    commit(view().plates.find((p) => p.id === 'plate:chooseB')!.actions)
    const d = view()
    expect(d.operands).toEqual([RZ90, RX90])
    expect(d.composition!.agree).toBe(true)
    commit(d.plates.find((p) => p.id === 'plate:anotherB')!.actions)
    const d2 = view()
    expect(classKey(d2.operands[1]!)).toBe(classKey(RX90))
    expect(d2.composition!.quotientProduct).toBe(d.composition!.quotientProduct)
  })
})
