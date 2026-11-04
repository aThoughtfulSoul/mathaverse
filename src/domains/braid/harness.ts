// DEV harness for the braid scene (harness.html?domain=braid&fixture=<name>). Fixtures are built from exact
// words through deriveBraid; onPick simulates the planner for this track's actions (append_crossing,
// rewrite_braid via applyRewrite, invert_braid, set_braid, select_item) so the scene can be exercised before
// integration. The real planner (coordinator) validates the same action JSON.

import { type Generator, type RewriteStep, applyRewrite, invertWord } from '../../algebra/braid'
import type { HarnessModule } from '../../dev/harness'
import type { Item } from '../inputs'
import { type BraidDesc, deriveBraid } from './derive'
import { BraidScene } from './scene'

interface State {
  word: Generator[]
  origin?: Generator[]
  rewrites?: RewriteStep[]
  compare?: Generator[] | null
  item?: Item
  revision?: number
}

let revision = 1

export function braidFixture(s: State): BraidDesc {
  return deriveBraid({
    experimentId: 'exp-braid',
    revision: s.revision ?? revision++,
    mathRevision: s.revision ?? revision,
    word: s.word,
    origin: s.origin ?? s.word,
    rewrites: s.rewrites ?? [],
    compare: s.compare === undefined ? null : s.compare,
    item: s.item ?? null,
    recipe: { id: 'recipe-braid', name: 'weaving', operations: [{ kind: 'braid_diagram', word: 'word', compare: 'compare' }, { kind: 'braid_invariants', word: 'word', compare: 'compare' }] },
  })
}

const rel = (at: number): RewriteStep => ({ rule: 'braid_relation', at, generator: null })
const LONG: Generator[] = [2, -1, 1, 2, 1, -2, 2]
const LONG_R: Generator[] = [2, -1, 2, 1, 2, -2, 2]

export const FIXTURES: Record<string, () => BraidDesc> = {
  /** Hero: sigma1 sigma2 sigma1 beside sigma2 sigma1 sigma2 (equal invariants, no witness yet). */
  relation: () => braidFixture({ word: [1, 2, 1], compare: [2, 1, 2] }),
  relationSelected: () => braidFixture({ word: [1, 2, 1], compare: [2, 1, 2], item: 'crossing:0' }),
  /** After the braid_relation rewrite at 0: identical to the comparison, equal by one supported rewrite. */
  relationDone: () => braidFixture({ word: [2, 1, 2], origin: [1, 2, 1], rewrites: [rel(0)], compare: [2, 1, 2], item: 'crossing:0' }),
  /** Two positive crossings vs the identity: endpoints agree, E = 2 vs 0, so different. */
  double: () => braidFixture({ word: [1, 1], compare: [] }),
  /** An inverse pair vs the identity: invariants agree; not established until the cancellation. */
  cancel: () => braidFixture({ word: [1, -1], compare: [], item: 'crossing:0' }),
  cancelDone: () => braidFixture({ word: [], origin: [1, -1], rewrites: [{ rule: 'cancel_pair', at: 0, generator: null }], compare: [] }),
  /** The cancelled word with the pair inserted again (insert_pair plays the cancellation backwards). */
  inserted: () => braidFixture({ word: [1, -1], origin: [1, -1], rewrites: [{ rule: 'cancel_pair', at: 0, generator: null }, { rule: 'insert_pair', at: 0, generator: 1 }], compare: [], item: 'crossing:0' }),
  /** A longer edited word with a relation span in the middle (prefix and suffix stay put). */
  long: () => braidFixture({ word: LONG, compare: LONG_R, item: 'crossing:2' }),
  longDone: () => braidFixture({ word: LONG_R, origin: LONG, rewrites: [rel(2)], compare: LONG_R, item: 'crossing:2' }),
  empty: () => braidFixture({ word: [] }),
  max: () => braidFixture({ word: [1, 2, -1, 2, 1, 1, -2, 1, 2, 2, -1, -2, 1, 2, 1, -1, 2, 1, -2, -1, 1, 2, 1, 2] }),
}

/** The planner's effect of an action list on the state a description was derived from (harness only). */
export function simulate(d: BraidDesc, actions: unknown[]): BraidDesc | null {
  const s: Required<State> = {
    word: [...d.main.word],
    origin: [...d.origin],
    rewrites: d.rewrites.map((r) => ({ ...r })),
    compare: d.compare ? [...d.compare.word] : null,
    item: d.item,
    revision: d.revision + 1,
  }
  for (const raw of actions) {
    const a = raw as Record<string, unknown>
    switch (a.kind) {
      case 'append_crossing':
        if (a.target === 'compare') s.compare = [...(s.compare ?? []), a.generator as Generator]
        else {
          s.word = [...s.word, a.generator as Generator]
          s.origin = [...s.word]
          s.rewrites = []
        }
        break
      case 'rewrite_braid': {
        const step: RewriteStep = { rule: a.rule as RewriteStep['rule'], at: a.at as number, generator: (a.generator ?? null) as Generator | null }
        s.word = applyRewrite(s.word, step)
        s.rewrites = [...s.rewrites, step]
        break
      }
      case 'invert_braid':
        if (a.target === 'compare') s.compare = s.compare ? invertWord(s.compare) : null
        else {
          s.word = invertWord(s.word)
          s.origin = [...s.word]
          s.rewrites = []
          s.item = null
        }
        break
      case 'set_braid':
        if (a.target === 'compare') s.compare = (a.word as Generator[] | null) ?? null
        else {
          s.word = [...(a.word as Generator[])]
          s.origin = [...s.word]
          s.rewrites = []
          s.item = null
        }
        break
      case 'select_item':
        s.item = (a.item ?? null) as Item
        break
      default:
        return null
    }
  }
  const k = typeof s.item === 'string' && s.item.startsWith('crossing:') ? Number(s.item.split(':')[1]) : -1
  if (k >= s.word.length) s.item = null
  return braidFixture(s)
}

const mod: HarnessModule<BraidDesc> = {
  title: 'Braids (B3, bounded words)',
  create: () => new BraidScene(),
  fixtures: FIXTURES,
  onPick: (pick, current) => (pick.actions.length ? simulate(current, pick.actions) : null),
}

export default mod
