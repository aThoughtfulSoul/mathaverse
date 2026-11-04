// A minimal stand-in for the planner, for the cube and quotient harnesses and focused tests (worker B). It
// applies exactly the group actions these scenes propose, with the same semantics as src/workspace/reducer.ts
// (apply_permutation resolves the unique rotation through rotationForDiagonalPermutation), and builds the
// GroupSceneInput the registry would. The real app commits through Workspace instead.

import type { GroupSceneInput, GroupStep, Observation } from '../inputs'
import { DOMAIN_LIMITS } from '../inputs'
import { chronologicalProduct, groupOf } from '../../algebra/groups'
import { isClassKey, rotationForDiagonalPermutation } from '../../algebra/cube'
import { checkPermutation } from '../../algebra/permutation'

export interface SimState {
  experimentId: string
  revision: number
  mathRevision: number
  history: GroupStep[]
  operands: [string | null, string | null]
  observation: Observation
  item: string | null
}

export function simState(partial: Partial<SimState> = {}): SimState {
  return { experimentId: 'exp-cube', revision: 1, mathRevision: 1, history: [], operands: [null, null], observation: 'none', item: null, ...partial }
}

const G = () => groupOf({ kind: 'cube_rotations' })

function checkItem(item: string | null): void {
  if (item === null) return
  if (G().has(item) || /^line:[0-3]$/.test(item) || /^axis:[0-2]$/.test(item) || (item.startsWith('class:') && isClassKey(item.slice(6)))) return
  throw new Error(`sim: bad item ${JSON.stringify(item)}`)
}

/** Apply a transaction (all or nothing); throws on anything the real planner would refuse here. */
export function simulate(state: SimState, actions: readonly unknown[]): SimState {
  const g = G()
  const s: SimState = { ...state, history: [...state.history], operands: [...state.operands] as [string | null, string | null] }
  let math = false
  for (const raw of actions) {
    const a = raw as Record<string, unknown>
    if (a.experimentId !== s.experimentId) throw new Error(`sim: action for ${String(a.experimentId)}`)
    switch (a.kind) {
      case 'apply_element': {
        const el = a.element as string
        if (!g.has(el)) throw new Error('sim: not an element')
        if (s.history.length >= DOMAIN_LIMITS.history) throw new Error('sim: history full')
        s.history.push({ element: el, via: 'element' })
        math = true
        break
      }
      case 'apply_permutation': {
        if (a.representation !== 'diagonal_lines') throw new Error('sim: representation')
        const p = checkPermutation(a.permutation, 'permutation', 4)
        const el = rotationForDiagonalPermutation(p)
        if (!el) throw new Error('sim: no rotation')
        if (s.history.length >= DOMAIN_LIMITS.history) throw new Error('sim: history full')
        s.history.push({ element: el, via: 'diagonal_lines' })
        math = true
        break
      }
      case 'undo_step':
        if (!s.history.length) throw new Error('sim: nothing to undo')
        s.history.pop()
        math = true
        break
      case 'reset_group':
        if (s.history.length) math = true
        s.history = []
        break
      case 'set_operands': {
        const ops = a.operands as [string | null, string | null]
        for (const o of ops) if (o !== null && !g.has(o)) throw new Error('sim: operand')
        s.operands = [ops[0], ops[1]]
        break
      }
      case 'set_observation':
        if (a.observation !== 'none' && a.observation !== 'unoriented_axis_lines') throw new Error('sim: observation')
        s.observation = a.observation
        break
      case 'select_item':
        checkItem(a.item as string | null)
        s.item = a.item as string | null
        break
      default:
        throw new Error(`sim: unsupported action ${String(a.kind)}`)
    }
  }
  s.revision++
  if (math) s.mathRevision++
  return s
}

export function inputOf(s: SimState): GroupSceneInput {
  const group = G()
  return {
    experimentId: s.experimentId,
    revision: s.revision,
    mathRevision: s.mathRevision,
    groupId: 'grp-cube',
    groupLabel: 'G',
    definition: { kind: 'cube_rotations' },
    group,
    history: s.history,
    accumulated: chronologicalProduct(group, s.history.map((h) => h.element)),
    operands: s.operands,
    observation: s.observation,
    item: s.item,
    operation: s.item !== null && group.has(s.item) ? s.item : null,
    recipe: null,
  }
}
