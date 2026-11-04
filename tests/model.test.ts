// ACCEPTANCE A1 fixtures against the shared exact model, independent of any renderer.
import { describe, expect, it } from 'vitest'
import { q, fromJson, toJson, add, CapacityError, RationalFormatError, snapEighth, format, mul } from '../src/model/rational'
import { Workspace, TransactionError } from '../src/workspace/reducer'
import { demoDocument } from '../src/workspace/document'
import {
  apply, compose, mat, vec, vecEq, matEq, presets, identity, withColumn, exactOutputGroups, selectedFiberSegment,
  projectorNullityOne, describeMap, differenceWitness, gridSamples, DimensionError, type Sample,
} from '../src/model/linear'

const s = (id: string, ...c: (number | ReturnType<typeof q>)[]): Sample => ({ id, label: id, coords: vec(...c) })

describe('A1 rational normalization', () => {
  it('normalizes signs, gcd and zero', () => {
    expect(q(6, -8)).toEqual({ n: -3n, d: 4n })
    expect(q(0, -5)).toEqual({ n: 0n, d: 1n })
    expect(toJson(q(-3, 8))).toEqual({ n: '-3', d: '8' })
  })
  it('rejects zero denominators and non-canonical JSON', () => {
    expect(() => q(1, 0)).toThrow(RationalFormatError)
    expect(() => fromJson({ n: '2', d: '4' })).toThrow(RationalFormatError)
    expect(() => fromJson({ n: '0', d: '3' })).toThrow(RationalFormatError)
    expect(() => fromJson({ n: '1', d: '-2' })).toThrow(RationalFormatError)
    expect(() => fromJson({ n: '1.5', d: '2' })).toThrow(RationalFormatError)
    expect(() => fromJson({ n: '1', d: '2', extra: 1 })).toThrow(RationalFormatError)
    expect(() => fromJson({ n: '-0', d: '1' })).toThrow(RationalFormatError)
    expect(fromJson({ n: '-3', d: '8' })).toEqual(q(-3, 8))
  })
  it('rejects arithmetic beyond the 256-bit budget instead of approximating', () => {
    let x = q(2n ** 200n)
    expect(() => {
      x = mul(x, x)
    }).toThrow(CapacityError)
  })
  it('snaps previews to eighths within the authored box', () => {
    expect(format(snapEighth(0.37))).toBe('3/8')
    expect(format(snapEighth(9))).toBe('4')
    expect(format(snapEighth(-0.06))).toBe('0')
  })
})

describe('workspace transactions', () => {
  const U = 's(1,0,1)'
  const coordsOf = (w: Workspace, id: string) => w.current.sampleSets[0]!.samples.find((s) => s.id === id)!.coords
  it('re-selecting the selected sample is not a new revision or undo step', () => {
    const w = new Workspace(demoDocument())
    w.commit({ baseRevision: 0, actions: [{ kind: 'select', experimentId: 'exp-p', sampleId: U }] })
    expect(w.current.revision).toBe(0)
    expect(w.canUndo).toBe(false)
  })
  it('a stale base revision is rejected and changes nothing; undo restores through a new revision', () => {
    const w = new Workspace(demoDocument())
    w.commit({ baseRevision: 0, actions: [{ kind: 'update_sample', sampleSetId: 'grid3', sampleId: U, coords: vec(1, 0, q(3, 8)).map(toJson) }] })
    expect(() => w.commit({ baseRevision: 0, actions: [{ kind: 'select', experimentId: 'exp-p', sampleId: 's(0,0,0)' }] })).toThrow(TransactionError)
    expect(w.current.revision).toBe(1)
    expect(w.current.mathRevision).toBe(1)
    w.undo()
    expect(w.current.revision).toBe(2)
    expect(vecEq(coordsOf(w, U), vec(1, 0, 1))).toBe(true)
  })
  it('an invalid last action leaves the state unchanged (all or nothing)', () => {
    const w = new Workspace(demoDocument())
    expect(() => w.commit({ baseRevision: 0, actions: [{ kind: 'update_sample', sampleSetId: 'grid3', sampleId: U, coords: vec(1, 0, 2).map(toJson) }, { kind: 'update_sample', sampleSetId: 'grid3', sampleId: U, coords: vec(9, 0, 0).map(toJson) }] })).toThrow(/authored range/)
    expect(w.current.revision).toBe(0)
    expect(vecEq(coordsOf(w, U), vec(1, 0, 1))).toBe(true)
  })
})

describe('A1 mathematical fixtures', () => {
  it('identity', () => {
    const v = vec(q(1, 3), -2, q(7, 8))
    expect(vecEq(apply(identity(3), v), v)).toBe(true)
    expect(vecEq(apply(identity(2), vec(1, -4)), vec(1, -4))).toBe(true)
  })
  it('composition order: R then S vs S then R', () => {
    const R = mat([[0, -1], [1, 0]])
    const S = mat([[1, 0], [0, -1]])
    const e1 = vec(1, 0)
    expect(vecEq(apply(compose(2, [R, S]), e1), vec(0, -1))).toBe(true)
    expect(vecEq(apply(compose(2, [S, R]), e1), vec(0, 1))).toBe(true)
    expect(matEq(compose(2, []), identity(2))).toBe(true)
  })
  it('additivity', () => {
    const A = mat([[2, 1], [0, 1]])
    const u = vec(1, 2)
    const v = vec(-1, 1)
    const Au = apply(A, u)
    const Av = apply(A, v)
    expect(vecEq(Au, vec(4, 2))).toBe(true)
    expect(vecEq(Av, vec(-1, 1))).toBe(true)
    expect(vecEq(apply(A, u.map((x, i) => add(x, v[i]!))), vec(3, 3))).toBe(true)
    expect(vecEq(Au.map((x, i) => add(x, Av[i]!)), vec(3, 3))).toBe(true)
  })
  it('scaling and collapse', () => {
    const A = presets.scaling([q(2), q(0)])
    expect(vecEq(apply(A, vec(1, 3)), vec(2, 0))).toBe(true)
    expect(describeMap(A)).toBe('Scaling')
  })
  it('shear convention I + 2E01', () => {
    expect(vecEq(apply(presets.shear(2, 0, 1, q(2)), vec(1, 3)), vec(7, 3))).toBe(true)
  })
  it('3D rotation +90 about z sends e_x to e_y', () => {
    expect(vecEq(apply(presets.rotation(3, 1, 2), vec(1, 0, 0)), vec(0, 1, 0))).toBe(true)
  })
  it('P collision, fiber direction e_z', () => {
    const P = presets.projection([true, true, false])
    const u = s('u', 1, 0, 1)
    const v = s('v', 1, 0, -1)
    expect(vecEq(u.coords, v.coords)).toBe(false)
    const groups = exactOutputGroups(P, [u, v])
    expect(groups).toHaveLength(1)
    expect(vecEq(groups[0]!.output, vec(1, 0, 0))).toBe(true)
    expect(projectorNullityOne(P)).toBe(2)
    const seg = selectedFiberSegment(P, u.coords)!
    expect(seg.direction).toBe(2)
    expect(vecEq(seg.from, vec(1, 0, -4))).toBe(true)
    expect(vecEq(seg.to, vec(1, 0, 4))).toBe(true)
  })
  it('Q changes groups and has a new collision along e_x', () => {
    const Q = presets.projection([false, true, true])
    const groupsUV = exactOutputGroups(Q, [s('u', 1, 0, 1), s('v', 1, 0, -1)])
    expect(groupsUV).toHaveLength(2)
    expect(vecEq(apply(Q, vec(1, 0, 1)), vec(0, 0, 1))).toBe(true)
    expect(vecEq(apply(Q, vec(1, 0, -1)), vec(0, 0, -1))).toBe(true)
    const groupsAB = exactOutputGroups(Q, [s('a', 1, 1, 0), s('b', -1, 1, 0)])
    expect(groupsAB).toHaveLength(1)
    expect(vecEq(groupsAB[0]!.output, vec(0, 1, 0))).toBe(true)
    expect(projectorNullityOne(Q)).toBe(0)
  })
  it('projection equality: P then P equals P', () => {
    const P = presets.projection([true, true, false])
    expect(matEq(compose(3, [P, P]), P)).toBe(true)
  })
  it('near but unequal outputs stay in different groups', () => {
    const P = presets.projection([true, true, false])
    const groups = exactOutputGroups(P, [s('o', 0, 0, 0), s('n', q(1, 1_000_000), 0, 0)])
    expect(groups).toHaveLength(2)
  })
  it('unsupported line fiber for diag(1, 0, 0)', () => {
    const A = presets.projection([true, false, false])
    expect(exactOutputGroups(A, [s('a', 1, 2, 3), s('b', 1, -1, 0)])).toHaveLength(1)
    expect(projectorNullityOne(A)).toBeNull()
    expect(selectedFiberSegment(A, vec(1, 2, 3))).toBeNull()
  })
  it('basis handle edits column 0', () => {
    const A = withColumn(identity(2), 0, vec(2, 1))
    expect(matEq(A, mat([[2, 0], [1, 1]]))).toBe(true)
    expect(vecEq(apply(A, vec(1, 1)), vec(2, 2))).toBe(true)
  })
  it('maps agreeing on samples can still differ on a basis vector', () => {
    const A = mat([[1, 0], [0, 1]])
    const B = mat([[1, 1], [0, 1]])
    expect(vecEq(apply(A, vec(1, 0)), apply(B, vec(1, 0)))).toBe(true)
    expect(differenceWitness(A, B)).toBe(1)
    expect(differenceWitness(A, A)).toBeNull()
  })
  it('mixed dimensions are rejected', () => {
    expect(() => apply(identity(2), vec(1, 2, 3))).toThrow(DimensionError)
    expect(() => compose(3, [identity(2) as never])).toThrow(DimensionError)
  })
  it('preset metadata is recomputed from the matrix', () => {
    expect(describeMap(presets.projection([true, true, false]))).toBe('Coordinate projection discarding z')
    expect(describeMap(mat([[1, 0, 0], [0, 1, 0], [0, 0, q(1, 2)]]))).toBe('Scaling')
    expect(describeMap(mat([[1, 1, 0], [0, 1, 0], [0, 0, 1]]))).toBe('Shear: output x gains 1 × input y')
    expect(describeMap(presets.shear(3, 0, 2, q(1, 2)))).toBe('Shear: output x gains 1/2 × input z')
    expect(describeMap(mat([[1, 1, 0], [0, 1, 1], [0, 0, 1]]))).toBe('Custom linear map')
  })
  it('default grid preset contains all four P/Q witnesses', () => {
    const ids = new Set(gridSamples(3).map((x) => x.id))
    for (const id of ['s(1,0,1)', 's(1,0,-1)', 's(1,1,0)', 's(-1,1,0)']) expect(ids.has(id)).toBe(true)
    expect(gridSamples(3)).toHaveLength(27)
    expect(gridSamples(2)).toHaveLength(9)
  })
})
