// Worker C: BraidScene behaviour without WebGL (a Canvas2D stub stands in for the DOM; TeX builds never
// resolve, so labels stay in their plain pending layer). Picks return the closed action JSON; committed
// changes choose the right presentation; an apply during an animation ends it at its exact end, and the
// scene then shows exactly the committed word.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Ray, Vector3 } from 'three'
import type { Generator } from '../../src/algebra/braid'

vi.mock('../../src/rendering/glyphTokens', () => ({ tokenStats: { version: 0 }, compose: () => 'missing' }))
vi.mock('../../src/rendering/tex', () => ({
  peekTex: () => null,
  claimEntry: () => undefined,
  releaseEntry: () => undefined,
  texGeometry: () => new Promise(() => undefined),
}))

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ font: '', textBaseline: '', fillStyle: '', measureText: (t: string) => ({ width: t.length * 20 }), fillText: () => undefined }),
    }),
  }
})

const { BraidScene } = await import('../../src/domains/braid/scene')
const { FIXTURES, braidFixture, simulate } = await import('../../src/domains/braid/harness')
const { GEOMETRY } = await import('../../src/domains/braid/constants')

const head = new Vector3(0, 0.2, 1.2)
const frame = (scene: InstanceType<typeof BraidScene>, dt: number) => scene.step({ time: 0, dt, frame: 0, presenting: false, xrFrame: null, head })
const rayAt = (x: number, y: number) => new Ray(new Vector3(x, y, 1), new Vector3(0, 0, -1))

function mounted() {
  const scene = new BraidScene()
  const bench = new Group()
  scene.mount(bench)
  bench.updateMatrixWorld(true)
  return scene
}

describe('BraidScene picks', () => {
  it('append plates, inverse and reset propose the closed action JSON', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relation!(), 'snap')
    expect(scene.pick(rayAt(-0.42, 0.195))?.actions).toEqual([{ kind: 'append_crossing', experimentId: 'exp-braid', target: 'word', generator: 1 }])
    expect(scene.pick(rayAt(-0.42, 0.195 - 3 * 0.045))?.actions).toEqual([{ kind: 'append_crossing', experimentId: 'exp-braid', target: 'word', generator: -2 }])
    expect(scene.pick(rayAt(-0.42, 0))?.actions).toEqual([{ kind: 'invert_braid', experimentId: 'exp-braid', target: 'word' }])
    expect(scene.pick(rayAt(-0.42, -0.044))?.actions).toEqual([{ kind: 'set_braid', experimentId: 'exp-braid', target: 'word', word: [] }])
    expect(scene.pick(rayAt(0, 0.4))).toBeNull()
    scene.dispose()
  })

  it('a crossing pick selects it; the selected crossing offers only matching rewrites', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relation!(), 'snap')
    // Main braid at x = -0.15 (comparison shown); crossing 0 occupies u in [lead, lead + pitch].
    const y0 = 0.255 - (GEOMETRY.lead + GEOMETRY.pitchMax / 2)
    const pick = scene.pick(rayAt(-0.15, y0))!
    expect(pick.id).toBe('crossing:0')
    expect(pick.actions).toEqual([{ kind: 'select_item', experimentId: 'exp-braid', item: 'crossing:0' }])
    scene.apply(FIXTURES.relationSelected!(), 'animate')
    expect(scene.pick(rayAt(0.42, 0.195))?.actions).toEqual([{ kind: 'rewrite_braid', experimentId: 'exp-braid', rule: 'braid_relation', at: 0, generator: null }])
    expect(scene.pick(rayAt(0.42, 0.15))?.actions).toEqual([{ kind: 'rewrite_braid', experimentId: 'exp-braid', rule: 'insert_pair', at: 0, generator: 1 }])
    expect(scene.pick(rayAt(0.42, 0.06))).toBeNull()
    expect(scene.pick(rayAt(-0.15, y0))?.actions).toEqual([{ kind: 'select_item', experimentId: 'exp-braid', item: null }])
    scene.dispose()
  })

  it('appending is refused at the 24-crossing bound', () => {
    const scene = mounted()
    scene.apply(braidFixture({ word: Array.from({ length: 24 }, () => 1 as Generator) }), 'snap')
    const p = scene.pick(rayAt(-0.42, 0.195))!
    expect(p.actions).toEqual([])
    expect(p.hint).toContain('unavailable')
    scene.dispose()
  })
})

describe('BraidScene transitions', () => {
  it('classifies committed changes: relation, cancel, insert, append; anything else jumps', () => {
    const scene = mounted()
    const go = (from: string, to: string) => {
      scene.apply(FIXTURES[from]!(), 'snap')
      scene.apply(FIXTURES[to]!(), 'animate')
      const kind = scene.playback().active ? scene.playback().phase.split(':')[0] : 'snap'
      scene.setPlayback('finish')
      return kind
    }
    expect(go('relation', 'relationDone')).toBe('relation')
    expect(go('long', 'longDone')).toBe('relation')
    expect(go('cancel', 'cancelDone')).toBe('cancel')
    expect(go('cancelDone', 'inserted')).toBe('insert')
    expect(go('double', 'relation')).toBe('snap')
    const d = FIXTURES.relation!()
    scene.apply(d, 'snap')
    scene.apply(simulate(d, [{ kind: 'append_crossing', experimentId: 'exp-braid', target: 'word', generator: 2 }])!, 'animate')
    expect(scene.playback().phase).toBe('append:retract')
    scene.apply(simulate(d, [{ kind: 'invert_braid', experimentId: 'exp-braid', target: 'word' }])!, 'animate')
    expect(scene.playback().active).toBe(false)
    scene.apply(FIXTURES.relationDone!(), 'snap')
    expect(scene.playback().active).toBe(false)
    scene.dispose()
  })

  it('an apply during an animation ends it at its exact end; the scene then shows the committed word', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relation!(), 'snap')
    scene.apply(FIXTURES.relationDone!(), 'animate')
    frame(scene, 0.1)
    frame(scene, 0.1)
    frame(scene, 0.1)
    expect(scene.playback().phase).toBe('relation:prepare')
    const next = simulate(FIXTURES.relationDone!(), [{ kind: 'append_crossing', experimentId: 'exp-braid', target: 'word', generator: -1 }])!
    scene.apply(next, 'animate')
    expect(scene.report().stats).toMatchObject({ interrupted: 1 })
    expect(scene.report().word).toEqual([2, 1, 2, -1])
    for (let i = 0; i < 40; i++) frame(scene, 0.05)
    const r = scene.report() as { playback: { active: boolean }; braids: { units: number; motif: number; reveal: number }[] }
    expect(r.playback.active).toBe(false)
    expect(r.braids[0]).toMatchObject({ units: 4, motif: 0, reveal: GEOMETRY.length })
    // Interrupting a mid-word relation (opened collars) ends on the static committed layout too.
    scene.apply(FIXTURES.long!(), 'snap')
    scene.apply(FIXTURES.longDone!(), 'animate')
    frame(scene, 1.0)
    expect(scene.playback().active).toBe(true)
    scene.apply(FIXTURES.longDone!(), 'snap')
    expect(scene.report()).toMatchObject({ word: [2, -1, 2, 1, 2, -2, 2], playback: { active: false } })
    expect((scene.report().braids as { units: number }[])[0]!.units).toBe(7)
    scene.dispose()
  })

  it('replays the construction crossing by crossing, following play_steps stepDuration', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relation!(), 'snap')
    scene.setStepDuration(2)
    const s = scene.setPlayback('replay')
    expect(s.active).toBe(true)
    expect(s.duration).toBeCloseTo(0.35 + 3 * 2 + 0.4, 9)
    expect(s.step).toMatchObject({ index: 0, count: 3 })
    scene.setPlayback({ seek: 0.35 + 2 * 1.5 })
    expect(scene.playback().step).toMatchObject({ index: 1, label: 'crossing 2: σ2' })
    expect(scene.setPlayback('toggle').playing).toBe(false)
    expect(scene.setPlayback('finish').active).toBe(false)
    scene.setStepDuration(99)
    expect(scene.setPlayback('replay').duration).toBeCloseTo(0.35 + 3 * 5 + 0.4, 9)
    scene.dispose()
  })

  it('status() is one plain line built from the supported checks', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relationDone!(), 'snap')
    expect(scene.status()).toBe('σ1 σ2 σ1 → σ2 σ1 σ2 by one supported rewrite; identical to the comparison')
    scene.apply(FIXTURES.double!(), 'snap')
    expect(scene.status()).toBe('σ1 σ1 vs identity: different from the comparison (exponent sums differ)')
    scene.apply(FIXTURES.relation!(), 'snap')
    expect(scene.status()).toContain('not established by the supported checks')
    scene.dispose()
  })
})
