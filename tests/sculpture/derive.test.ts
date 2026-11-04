// Kinetic group sculpture: exact derivation checks (FOUR-DEMOS-PARALLEL-HANDOFF sections 4, 5, 11.1).
// Everything is checked against the group's multiplication, never against presentation geometry.

import { describe, it, expect } from 'vitest'
import { chronologicalProduct, groupOf, regularPermutation, type GroupDefinition } from '../../src/algebra/groups'
import { compose, cycles, identityPerm, permEq } from '../../src/algebra/permutation'
import type { GroupOperation, GroupSceneInput, SceneRecipe } from '../../src/domains/inputs'
import { deriveSculpture, SculptureError, historyWords, plainGroupLabel, type SculptureDesc } from '../../src/domains/sculpture/derive'
import { GROUP_SCULPTURE } from '../../src/recipes/recipe'

const RECIPE: SceneRecipe<GroupOperation> = {
  id: 'recipe-sculpture',
  name: 'Group sculpture',
  operations: [
    { kind: 'regular_action', group: 'group', operation: 'operation' },
    { kind: 'cycle_trails', group: 'group', operation: 'operation' },
    { kind: 'element_orders', group: 'group' },
  ],
}

const C4: GroupDefinition = { kind: 'cyclic', order: 4 }
const V4: GroupDefinition = { kind: 'klein_four' }

function input(definition: GroupDefinition, history: string[], operation: string | null = history[history.length - 1] ?? null, recipe: SceneRecipe<GroupOperation> | null = RECIPE): GroupSceneInput {
  const group = groupOf(definition)
  const label = definition.kind === 'cyclic' ? `C_{${definition.order}}` : 'V_{4}'
  return {
    experimentId: definition.kind === 'cyclic' ? `exp-c${definition.order}` : 'exp-v4',
    revision: history.length,
    mathRevision: history.length,
    groupId: definition.kind === 'cyclic' ? `grp-c${definition.order}` : 'grp-v4',
    groupLabel: label,
    definition,
    group,
    history: history.map((element) => ({ element, via: 'element' as const })),
    accumulated: chronologicalProduct(group, history),
    operands: [null, null],
    observation: 'none',
    item: operation,
    operation,
    recipe,
  }
}

const derive = (d: GroupDefinition, h: string[], op?: string | null) => deriveSculpture(input(d, h, op))
const cycleTexts = (d: SculptureDesc) => Object.fromEntries(d.cards.map((c) => [c.element, c.cycleText]))

describe('C4 and V4: orders and regular-action cycles from the multiplication', () => {
  it('C4 orders are 1, 4, 2, 4; V4 orders are 1, 2, 2, 2', () => {
    expect(derive(C4, []).orders.list).toEqual([1, 4, 2, 4])
    expect(derive(V4, []).orders.list).toEqual([1, 2, 2, 2])
    expect(derive(C4, []).cards.map((c) => c.order)).toEqual([1, 4, 2, 4])
  })

  it('C4: 1 and 3 give one 4-cycle, 2 gives two 2-cycles, 0 fixes all (never "all 4-cycles")', () => {
    const d = derive(C4, [])
    expect(cycleTexts(d)).toEqual({ c0: '()', c1: '(0 1 2 3)', c2: '(0 2)(1 3)', c3: '(0 3 2 1)' })
    expect(d.cards.map((c) => c.cycleType)).toEqual([[1, 1, 1, 1], [4], [2, 2], [4]])
    expect(d.cards.find((c) => c.element === 'c2')!.cycleTex).toBe('(0\\,2)(1\\,3)')
  })

  it('V4: every non-identity element gives two 2-cycles', () => {
    const d = derive(V4, [])
    expect(cycleTexts(d)).toEqual({ v00: '()', v10: '(0 1)(2 3)', v01: '(0 2)(1 3)', v11: '(0 3)(1 2)' })
    for (const c of d.cards.filter((c) => !c.identity)) expect(c.cycleType).toEqual([2, 2])
  })

  it('cards come from regularPermutation and generators are exactly the order-|G| elements', () => {
    for (const def of [C4, V4]) {
      const g = groupOf(def)
      const d = derive(def, [])
      d.cards.forEach((c) => {
        expect(c.permutation).toEqual([...regularPermutation(g, c.element)])
        expect(c.cycles).toEqual(cycles(regularPermutation(g, c.element)))
      })
    }
    expect(derive(C4, []).orders.generators).toEqual(['c1', 'c3'])
    expect(derive(C4, []).orders.cyclic).toBe(true)
    expect(derive(V4, []).orders.generators).toEqual([])
    expect(derive(V4, []).orders.cyclic).toBe(false)
    expect(derive(V4, []).orders.maxOrder).toBe(2)
  })
})

describe('beads: persistent identity, slot of k·x', () => {
  it('bead x sits in the slot of k·x and keeps its element', () => {
    for (const def of [C4, V4]) {
      const g = groupOf(def)
      for (const k of g.elements) {
        const d = derive(def, [k])
        expect(d.accumulated).toBe(k)
        d.beads.forEach((b, i) => {
          expect(b.element).toBe(g.elements[i])
          expect(b.index).toBe(i)
          expect(b.slot).toBe(g.indexOf(g.multiply(k, b.element)))
        })
        // A permutation of slots: every slot holds exactly one bead.
        expect([...d.beads.map((b) => b.slot)].sort()).toEqual([...identityPerm(g.order)])
      }
    }
  })

  it('C4 after 1 applied once: bead 0 in slot 1, bead 3 in slot 0 (beads are not renamed)', () => {
    const d = derive(C4, ['c1'])
    expect(d.beads.map((b) => [b.element, b.slot])).toEqual([['c0', 1], ['c1', 2], ['c2', 3], ['c3', 0]])
  })

  it('chronology: applying g, then h accumulates h·g', () => {
    const g = groupOf({ kind: 'cyclic', order: 6 })
    const d = derive({ kind: 'cyclic', order: 6 }, ['c1', 'c2'])
    expect(d.accumulated).toBe(g.multiply('c2', 'c1'))
    expect(d.steps[1]!.before).toBe('c1')
    expect(d.steps[1]!.after).toBe('c3')
  })

  it('refuses an accumulated element that is not the product of the history', () => {
    const bad = { ...input(C4, ['c1']), accumulated: 'c2' }
    expect(() => deriveSculpture(bad)).toThrow(SculptureError)
  })
})

describe('steps: motion assignments are the cycles of the applied element', () => {
  it('each move follows the regular permutation and the step cycles equal cycles(L_g)', () => {
    for (const def of [C4, V4]) {
      const g = groupOf(def)
      const d = derive(def, [g.elements[1]!, g.elements[2]!, g.elements[3]!, g.elements[1]!])
      d.steps.forEach((st) => {
        const p = regularPermutation(g, st.element)
        expect(st.cycles).toEqual(cycles(p))
        expect(st.permutation).toEqual([...p])
        st.moves.forEach((m, b) => {
          expect(m.beadIndex).toBe(b)
          expect(m.from).toBe(st.slotsBefore[b])
          expect(m.to).toBe(p[m.from])
          expect(m.to).toBe(st.slotsAfter[b])
          expect(st.cycles[m.cycle]).toContain(m.from)
          expect(m.cycleLength).toBe(st.cycles[m.cycle]!.length)
        })
        // slotsAfter = L_g after slotsBefore (as maps bead -> slot)
        expect(st.slotsAfter).toEqual(st.slotsBefore.map((s) => p[s]))
      })
    }
  })

  it('C4 generator: one 4-cycle moves every bead; c2: two 2-cycles; V4 v10: two 2-cycles', () => {
    const one = derive(C4, ['c1']).steps[0]!
    expect(one.moves.every((m) => m.cycleLength === 4)).toBe(true)
    const two = derive(C4, ['c2']).steps[0]!
    expect(two.moves.map((m) => [m.from, m.to])).toEqual([[0, 2], [1, 3], [2, 0], [3, 1]])
    expect(two.moves.every((m) => m.cycleLength === 2)).toBe(true)
    const v = derive(V4, ['v10']).steps[0]!
    expect(v.cycles).toEqual([[0, 1], [2, 3]])
    expect(v.moves.every((m) => m.cycleLength === 2)).toBe(true)
  })
})

describe('returning home', () => {
  it('C4: 1 applied four times returns every bead home exactly, not before', () => {
    for (let m = 0; m <= 4; m++) {
      const d = derive(C4, Array(m).fill('c1'))
      expect(d.atHome).toBe(m === 0 || m === 4)
      expect(d.beads.every((b) => b.home)).toBe(m === 0 || m === 4)
    }
    const d = derive(C4, ['c1', 'c1', 'c1', 'c1'])
    expect(d.timeline.map((t) => t.atHome)).toEqual([true, false, false, false, true])
    expect(d.timeline[4]!.slots).toEqual([0, 1, 2, 3])
    // The steps compose: chronological composition of the step permutations is the identity.
    const total = d.steps.reduce<readonly number[]>((acc, s) => compose(s.permutation, acc), identityPerm(4))
    expect(permEq(total, identityPerm(4))).toBe(true)
  })

  it('V4: (1,0) applied twice returns every bead home', () => {
    expect(derive(V4, ['v10']).atHome).toBe(false)
    expect(derive(V4, ['v10', 'v10']).atHome).toBe(true)
    expect(derive(V4, ['v10', 'v10']).beads.map((b) => b.slot)).toEqual([0, 1, 2, 3])
  })

  it('C4: c2 twice is home; c1 three times needs one more', () => {
    expect(derive(C4, ['c2', 'c2']).atHome).toBe(true)
    expect(derive(C4, ['c1', 'c1', 'c1']).timeline[3]!.homeLine).toBe('one more returns every bead home')
  })

  it('status lines', () => {
    expect(derive(C4, ['c1', 'c1', 'c1']).status).toBe('C4 · 1 applied 3 times · one more returns every bead home')
    expect(derive(V4, ['v10', 'v10']).status).toBe('V4 · (1,0) applied twice: every bead is home')
    expect(derive(C4, ['c1', 'c1', 'c1', 'c1']).status).toBe('C4 · 1 applied 4 times: every bead is home')
    expect(derive(C4, ['c1']).status).toBe('C4 · 1 applied once · three more return every bead home')
    expect(derive(C4, [], null).status).toBe('C4 · every bead is home · choose an operation card')
    expect(derive(C4, [], 'c1').status).toBe('C4 · every bead is home · 1 selected, order 4')
    expect(derive(C4, ['c1', 'c2']).status).toBe('C4 · 2 operations applied, k = 3 · applying 1 once returns every bead home')
  })
})

describe('the same recipe rebound from C4 to V4', () => {
  it('the rule is unchanged; the computed behaviour changes', () => {
    const c = derive(C4, ['c1', 'c1'], 'c1')
    // The same saved recipe, the same "apply the second element twice" request, now on V4.
    const v = derive(V4, ['v10', 'v10'], 'v10')
    expect(c.recipe).toEqual(v.recipe)
    expect(c.show).toEqual(v.show)
    expect(c.atHome).toBe(false)
    expect(v.atHome).toBe(true)
    expect(c.steps[0]!.cycles.map((x) => x.length)).toEqual([4])
    expect(v.steps[0]!.cycles.map((x) => x.length)).toEqual([2, 2])
    expect(c.orders.list).not.toEqual(v.orders.list)
    expect(c.order).toBe(v.order)
    expect(c.orders.contrastLines).toEqual(['two elements of order 4', 'each one cycles all four beads'])
    expect(v.orders.contrastLines).toEqual(['no element of order 4', 'repeat any card: home again within 2'])
  })

  it("the coordinator's prepared rule (GROUP_SCULPTURE) shows beads, trails and orders on both groups", () => {
    const prepared: SceneRecipe<GroupOperation> = { id: 'recipe-sculpture', name: GROUP_SCULPTURE.name, operations: GROUP_SCULPTURE.operations as GroupOperation[] }
    for (const def of [C4, V4]) expect(deriveSculpture(input(def, [], null, prepared)).show).toEqual({ beads: true, trails: true, orders: true })
  })

  it('the recipe decides what is shown', () => {
    const only: SceneRecipe<GroupOperation> = { id: 'r', name: 'r', operations: [{ kind: 'regular_action', group: 'group', operation: 'operation' }] }
    expect(deriveSculpture(input(C4, [], null, only)).show).toEqual({ beads: true, trails: false, orders: false })
    expect(deriveSculpture(input(C4, [], null, null)).show).toEqual({ beads: true, trails: false, orders: false })
    expect(derive(C4, []).show).toEqual({ beads: true, trails: true, orders: true })
  })
})

describe('generic groups (no special cases by name)', () => {
  it('cyclic groups of order 1, 2, 3, 6, 8 derive with orders n / gcd(k, n) and cycles of that length', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    for (const n of [1, 2, 3, 6, 8]) {
      const def: GroupDefinition = { kind: 'cyclic', order: n }
      const d = derive(def, [])
      expect(d.cards.map((c) => c.order)).toEqual(Array.from({ length: n }, (_, k) => n / gcd(k, n)))
      for (const c of d.cards) expect(c.cycles.every((cy) => cy.length === c.order)).toBe(true)
      // Applying the generator n times returns home, and not before.
      if (n > 1) {
        const h = derive(def, Array(n).fill('c1'))
        expect(h.timeline.map((t) => t.atHome)).toEqual(Array.from({ length: n + 1 }, (_, j) => j === 0 || j === n))
      }
    }
    expect(cycleTexts(derive({ kind: 'cyclic', order: 6 }, []))).toEqual({ c0: '()', c1: '(0 1 2 3 4 5)', c2: '(0 2 4)(1 3 5)', c3: '(0 3)(1 4)(2 5)', c4: '(0 4 2)(1 5 3)', c5: '(0 5 4 3 2 1)' })
  })

  it('refuses groups above the sculpture bound with a clear error', () => {
    expect(() => derive({ kind: 'cyclic', order: 9 }, [])).toThrow(/above 8/)
  })
})

describe('plain data', () => {
  it('is deterministic and survives a JSON round trip', () => {
    const a = derive(V4, ['v10', 'v01', 'v10'], 'v11')
    const b = derive(V4, ['v10', 'v01', 'v10'], 'v11')
    expect(a).toEqual(b)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    expect(a.cards.find((c) => c.element === 'v11')!.selected).toBe(true)
  })

  it('words', () => {
    expect(historyWords(['1', '1', '1'])).toBe('1, then 1, then 1')
    expect(historyWords(['1', '1', '1', '1', '2'])).toBe('5 steps: …, 1, then 1, then 2')
    expect(plainGroupLabel('C_{4}')).toBe('C4')
    expect(plainGroupLabel('V_{4}')).toBe('V4')
  })
})
