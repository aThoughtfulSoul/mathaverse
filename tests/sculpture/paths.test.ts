// Kinetic group sculpture: presentation path checks. The paths carry no algebra; these checks confirm they
// realise the derived assignments exactly (endpoints) and keep beads apart (depth-separated exchanges).

import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { groupOf, regularPermutation, type GroupDefinition } from '../../src/algebra/groups'
import { cycles } from '../../src/algebra/permutation'
import { evalPath, pathSpecs, ringFrame, slotPosition, RING } from '../../src/domains/sculpture/paths'

const f = ringFrame()
const defs: GroupDefinition[] = [2, 3, 4, 5, 6, 7, 8].map((order) => ({ kind: 'cyclic', order }) as GroupDefinition).concat([{ kind: 'klein_four' }])

describe('paths realise the cycles exactly', () => {
  it('every path starts at its source slot and ends exactly at the slot g·s', () => {
    for (const def of defs) {
      const g = groupOf(def)
      const n = g.order
      for (const x of g.elements) {
        const p = regularPermutation(g, x)
        const specs = pathSpecs(cycles(p), n)
        specs.forEach((sp, s) => {
          expect(sp.from).toBe(s)
          expect(sp.to).toBe(p[s])
          const a = evalPath(f, sp, n, 0, new Vector3())
          const b = evalPath(f, sp, n, 1, new Vector3())
          expect(a.distanceTo(slotPosition(f, s, n, new Vector3()))).toBeLessThan(1e-9)
          expect(b.equals(slotPosition(f, p[s]!, n, new Vector3()))).toBe(true)
        })
      }
    }
  })

  it('templates follow cycle length only', () => {
    const g = groupOf({ kind: 'cyclic', order: 4 })
    expect(pathSpecs(cycles(regularPermutation(g, 'c1')), 4).map((s) => s.kind)).toEqual(['flow', 'flow', 'flow', 'flow'])
    expect(pathSpecs(cycles(regularPermutation(g, 'c2')), 4).map((s) => s.kind)).toEqual(['swap', 'swap', 'swap', 'swap'])
    expect(pathSpecs(cycles(regularPermutation(g, 'c0')), 4).map((s) => s.kind)).toEqual(['stay', 'stay', 'stay', 'stay'])
    // A 4-cycle flows coherently: one direction, a quarter turn each.
    const flow = pathSpecs(cycles(regularPermutation(g, 'c1')), 4)
    expect(flow.map((s) => (s.kind === 'flow' ? s.delta : NaN))).toEqual(Array(4).fill(Math.PI / 2))
    const back = pathSpecs(cycles(regularPermutation(g, 'c3')), 4)
    expect(back.map((s) => (s.kind === 'flow' ? s.delta : NaN))).toEqual(Array(4).fill(-Math.PI / 2))
  })

  it('V4 and C4 c2: the two exchanges sit at opposite depths', () => {
    const v = groupOf({ kind: 'klein_four' })
    for (const x of ['v10', 'v01', 'v11']) {
      const specs = pathSpecs(cycles(regularPermutation(v, x)), 4)
      const depths = specs.map((s) => (s.kind === 'swap' ? s.depth : NaN))
      expect(new Set(depths)).toEqual(new Set([RING.depth, -RING.depth]))
    }
  })
})

describe('beads stay apart during every move', () => {
  it('minimum centre distance between any two beads exceeds two bead radii (groups up to order 8)', () => {
    let worst = Infinity
    for (const def of defs) {
      const g = groupOf(def)
      const n = g.order
      for (const x of g.elements) {
        const specs = pathSpecs(cycles(regularPermutation(g, x)), n)
        const a = new Vector3()
        const b = new Vector3()
        for (let k = 0; k <= 200; k++) {
          const t = k / 200
          for (let i = 0; i < n; i++)
            for (let j = i + 1; j < n; j++) {
              evalPath(f, specs[i]!, n, t, a)
              evalPath(f, specs[j]!, n, t, b)
              worst = Math.min(worst, a.distanceTo(b))
            }
        }
      }
    }
    expect(worst).toBeGreaterThan(2 * RING.bead + 0.01)
  })

  it('stays inside the bench frame for the sculpture', () => {
    for (const def of defs) {
      const g = groupOf(def)
      for (const x of g.elements) {
        for (const sp of pathSpecs(cycles(regularPermutation(g, x)), g.order)) {
          for (let k = 0; k <= 40; k++) {
            const p = evalPath(f, sp, g.order, k / 40, new Vector3())
            expect(p.x).toBeGreaterThan(-0.5)
            expect(p.x).toBeLessThan(0.5)
            expect(p.y).toBeGreaterThan(-0.24)
            expect(p.y).toBeLessThan(0.32)
            expect(p.z).toBeGreaterThan(-0.25)
            expect(p.z).toBeLessThan(0.15)
          }
        }
      }
    }
  })
})
