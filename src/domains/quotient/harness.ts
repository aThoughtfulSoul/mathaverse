// DEV harness module for the quotient scene: harness.html?domain=quotient. Fixtures are built from exact
// inputs through the same actions a press proposes (applied by the planner stand-in in ../cube/sim.ts).

import type { HarnessModule } from '../../dev/harness'
import type { ScenePick } from '../scene'
import { QuotientScene } from './scene'
import { deriveQuotient, type QuotientDesc } from './derive'
import { inputOf, simState, simulate, type SimState } from '../cube/sim'

const EXP = 'exp-quotient'
const RZ = 'r(y,-x,z)'
const RX = 'r(x,z,-y)'

function stateOf(d: QuotientDesc): SimState {
  const item = d.selectedElement ?? (d.selectedClass ? `class:${d.selectedClass}` : null)
  return simState({ experimentId: d.experimentId, revision: d.revision, mathRevision: d.mathRevision, observation: d.observation, operands: [...d.operands] as [string | null, string | null], item })
}

const derive = (s: SimState) => deriveQuotient(inputOf(s))
type Press = (d: QuotientDesc) => unknown[]
const plate = (id: string): Press => (d) => d.plates.find((p) => p.id === id)!.actions
const cube = (e: string): Press => (d) => d.cubes.find((c) => c.element === e)!.actions
const cls = (key: string): Press => (d) => d.classes.find((c) => c.key === key)!.actions

function chain(...steps: Press[]): QuotientDesc {
  let s = simState({ experimentId: EXP })
  for (const p of steps) s = simulate(s, p(derive(s)))
  return derive(s)
}

const grouped = plate('plate:observe')

const mod: HarnessModule<QuotientDesc> = {
  title: 'Quotient: 24 rotations, six classes',
  create: () => new QuotientScene(),
  fixtures: {
    all24: () => chain(),
    rz: () => chain(cube(RZ)),
    grouped: () => chain(grouped),
    expandK: () => chain(grouped, cls('012')),
    expandRz: () => chain(grouped, cls('102')),
    rzSelected: () => chain(grouped, cube(RZ)),
    chooseA: () => chain(grouped, cube(RZ), plate('plate:chooseA')),
    compose: () => chain(grouped, cube(RZ), plate('plate:chooseA'), cube(RX), plate('plate:chooseB')),
    anotherA: () => chain(grouped, cube(RZ), plate('plate:chooseA'), cube(RX), plate('plate:chooseB'), plate('plate:anotherA')),
    anotherB: () => chain(grouped, cube(RZ), plate('plate:chooseA'), cube(RX), plate('plate:chooseB'), plate('plate:anotherA'), plate('plate:anotherB')),
    ungrouped: () => chain(grouped, grouped),
  },
  onPick(pick: ScenePick, current: QuotientDesc): QuotientDesc | null {
    if (!pick.actions.length) return null
    return derive(simulate(stateOf(current), pick.actions))
  },
}

export default mod
