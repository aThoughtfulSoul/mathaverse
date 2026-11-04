// DEV harness module for the cube scene: harness.html?domain=cube. Fixtures are built from exact inputs
// through the same action path a press uses (the scene description's actions, applied by the planner
// stand-in in sim.ts), so clicking through reproduces each fixture.

import type { HarnessModule } from '../../dev/harness'
import type { ScenePick } from '../scene'
import { CubeScene } from './scene'
import { deriveCube, type CubeDesc } from './derive'
import { inputOf, simState, simulate, type SimState } from './sim'

const EXP = 'exp-cube'

function stateOf(d: CubeDesc): SimState {
  return simState({
    experimentId: d.experimentId,
    revision: d.revision,
    mathRevision: d.mathRevision,
    history: d.history.map((h) => ({ element: h.element, via: h.via })),
    item: d.selectedLine === null ? null : `line:${d.selectedLine}`,
  })
}

const derive = (s: SimState) => deriveCube(inputOf(s))
const press = (s: SimState, pick: (d: CubeDesc) => unknown[]) => simulate(s, pick(derive(s)))
const card = (id: string) => (d: CubeDesc) => d.cards.find((c) => c.id === id)!.actions
const object = (i: number) => (d: CubeDesc) => d.objects[i]!.actions

/** Chains of presses from home (each step is what a click proposes). */
function chain(...steps: ((d: CubeDesc) => unknown[])[]): CubeDesc {
  let s = simState({ experimentId: EXP })
  for (const p of steps) s = press(s, p)
  return derive(s)
}

const mod: HarnessModule<CubeDesc> = {
  title: 'Cube and four diagonals',
  create: () => new CubeScene(),
  fixtures: {
    home: () => chain(),
    rz: () => chain(card('card:rz')),
    rz_h: () => chain(card('card:rz'), card('card:h')),
    select0: () => chain(object(0)),
    swap01: () => chain(object(0), object(1)),
    rz_select0: () => chain(card('card:rz'), object(0)),
    rz_swap02: () => chain(card('card:rz'), object(0), object(2)),
    rz_h_return: () => chain(card('card:rz'), card('card:h'), card('card:return')),
    rx_ry: () => chain(card('card:rx'), card('card:ry')),
  },
  onPick(pick: ScenePick, current: CubeDesc): CubeDesc | null {
    if (!pick.actions.length) return null
    return derive(simulate(stateOf(current), pick.actions))
  },
}

export default mod
