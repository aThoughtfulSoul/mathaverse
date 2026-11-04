// The six domain presenters (docs/INTERFACES.md "UI refinement"; src/ui/model.ts Presenter). Each is a pure
// function of PresenterInput: the experiment's variant subtitle, its context actions (validated actions,
// scene playback, the drag mode or a Lean check request), status line, playback availability, reset entries,
// mathematical detail and the scene presentation options. docs/UI-SCENES.md describes each one.

import type { DemoKind } from '../../demo/order'
import type { Presenter } from '../model'
import { presentPq } from './pq'
import { presentOrder } from './order'
import { presentSculpture } from './sculpture'
import { presentCube } from './cube'
import { presentQuotient } from './quotient'
import { presentBraid } from './braid'
import { presentProof } from './proof'

export const PRESENTERS: Record<DemoKind, Presenter> = {
  pq: presentPq,
  order: presentOrder,
  sculpture: presentSculpture,
  cube: presentCube,
  quotient: presentQuotient,
  braid: presentBraid,
  proof: presentProof,
}
