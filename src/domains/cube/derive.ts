// Demonstration 2, "two worlds, one structure" (FOUR-DEMOS-PARALLEL-HANDOFF section 6): the derivation of
// the cube scene's description from exact input. Pure and deterministic (no three.js, no time).
//
// Conventions (docs/CUBE-QUOTIENT.md):
// - The cube's orientation is the accumulated element k (applying g, then h gives h·g).
// - Diagonal object i keeps its identity i forever; with orientation k it lies on the geometric line slot
//   phi(k)[i]. A step g moves the object on slot s to slot phi(g)[s] (phi is a homomorphism, so the slots
//   after the history equal phi(k) applied to the identities).
// - Swapping two chosen objects a, b: they occupy slots s_a = phi(k)[a], s_b = phi(k)[b]; the proposed
//   permutation is the transposition (s_a s_b) of those SLOTS. The planner resolves the unique g with
//   phi(g) = (s_a s_b); then g·k puts a on s_b, b on s_a and leaves the other two objects where they were.

import type { GroupSceneInput } from '../inputs'
import { DOMAIN_LIMITS } from '../inputs'
import { rotationId, rotationInfo, type ElementLabel, type FiniteGroup, type IntMat3, type RotationInfo } from '../../algebra/groups'
import { phiOf, rotationForDiagonalPermutation } from '../../algebra/cube'
import { composeChronological, cycleText, inverse, isIdentityPerm, permEq, transposition, type Perm } from '../../algebra/permutation'

/** The rotation cards (exact matrices; IDs from their columns). */
export const CUBE_CARD_DEFS: readonly { id: string; matrix: IntMat3; caption: string }[] = [
  { id: 'card:rx', matrix: [[1, 0, 0], [0, 0, -1], [0, 1, 0]], caption: '¼ turn about x' },
  { id: 'card:ry', matrix: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]], caption: '¼ turn about y' },
  { id: 'card:rz', matrix: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], caption: '¼ turn about z' },
  { id: 'card:h', matrix: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], caption: 'half-turn H' },
]

export interface TextDesc {
  tex: string
  plain: string
}

export interface CubeStepDesc {
  index: number
  element: string
  via: 'element' | 'diagonal_lines'
  label: ElementLabel
  kind: RotationInfo['kind']
  /** Unit rotation axis in mathematical coordinates (floats, presentation of the exact matrix), or null. */
  axis: [number, number, number] | null
  /** Angle about `axis`, radians, in (0, pi]. Rotating by it about `axis` gives exactly matrix(element). */
  angle: number
  /** phi(g) on line slots: the object on slot s moves to slot phi[s]. */
  phi: number[]
  phiCycles: string
  /** Accumulated element before and after this step (exact prefix products). */
  before: string
  after: string
  /** Slot of each identity before and after the step. */
  slotsBefore: number[]
  slotsAfter: number[]
  /** The two identities exchanged when phi(g) is a transposition, else null. */
  swapped: [number, number] | null
  /** "applying R_z: a quarter turn about z" (shown during the motion; no state label). */
  op: TextDesc
}

export interface CubeCard {
  id: string
  element: string | null
  label: TextDesc
  caption: TextDesc
  hint: string
  actions: unknown[]
  enabled: boolean
}

export interface CubeObjectDesc {
  /** Identity of the diagonal / object (never renamed). */
  identity: number
  /** The geometric line slot it lies on now: phi(k)[identity]. */
  slot: number
  selected: boolean
  /** Actions a press on this object (its token or its diagonal) proposes. */
  actions: unknown[]
  hint: string
  /** When the press would propose a swap: the slot transposition and the rotation the planner resolves. */
  swap: { permutation: number[]; element: string; label: ElementLabel } | null
}

export interface CubeDesc {
  layout: 'cube'
  experimentId: string
  revision: number
  mathRevision: number
  groupId: string
  /** The accumulated element k (committed orientation). */
  element: string
  label: ElementLabel
  matrix: number[][]
  /** phi(k): identity i lies on slot phi[i]. */
  phi: number[]
  phiCycles: string
  /** slot j holds identity occupant[j] (the inverse of phi). */
  occupant: number[]
  /** The objects' own record: the per-step slot permutations composed chronologically. */
  objectsPerm: number[]
  /** The cube's phi(k) equals the objects' record (phi is a homomorphism; computed exactly). */
  agree: boolean
  history: CubeStepDesc[]
  /** The chronological word ("R_z, then E_yz") and the product k written right to left, or null when empty. */
  word: TextDesc | null
  /** "k = E_yz R_z = V_1" and "phi(k) = (0 1 3 2)": committed state only. */
  state: TextDesc
  phiText: TextDesc
  /** Which representation drove the last step. */
  driver: 'cube' | 'objects' | null
  /** One plain sentence about the last step's driver ("swap 0 and 1 resolved to E_yz"). */
  driverText: string | null
  selectedLine: number | null
  objects: CubeObjectDesc[]
  cards: CubeCard[]
  isHome: boolean
  historyFull: boolean
  status: string
}

const AXES = ['x', 'y', 'z'] as const

export function cyclesTex(p: Perm): string {
  return isIdentityPerm(p) ? '\\mathrm{id}' : cycleText(p).replace(/ /g, '\\;')
}

function num(v: number): string {
  return v < 0 ? `-${-v}` : String(v)
}

/** Words for a turn, from the exact matrix (the axis direction is read off the integer matrix). */
export function turnWords(m: IntMat3): { tex: string; plain: string } {
  const info = rotationInfo(m)
  if (info.kind === 'identity') return { tex: '\\textsf{no turn}', plain: 'no turn' }
  const t = m[0]![0]! + m[1]![1]! + m[2]![2]!
  if (info.kind === 'face') {
    const i = info.axis!.findIndex((v) => Math.abs(v) > 0.5)
    const neg = info.axis![i]! < 0
    if (t === -1) return { tex: `\\textsf{a half-turn about }${AXES[i]}`, plain: `a half-turn about ${AXES[i]}` }
    return { tex: `\\textsf{a quarter turn about }${neg ? '-' : ''}${AXES[i]}`, plain: `a quarter turn about ${neg ? '−' : ''}${AXES[i]}` }
  }
  if (info.kind === 'vertex') {
    const w = [m[2]![1]! - m[1]![2]!, m[0]![2]! - m[2]![0]!, m[1]![0]! - m[0]![1]!].map(Math.sign)
    const v = `(${w.map(num).join(',')})`
    return { tex: `\\textsf{a third of a turn about }${v}`, plain: `a third of a turn about ${v}` }
  }
  // Edge half-turn: the axis spans the columns of M + I (integer, first nonzero positive).
  const s = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[i]![j]! + (i === j ? 1 : 0)))
  const j = [0, 1, 2].find((c) => s.some((row) => row[c] !== 0))!
  let a = s.map((row) => Math.sign(row[j]!))
  if (a.find((v) => v !== 0)! < 0) a = a.map((v) => -v)
  const v = `(${a.map(num).join(',')})`
  return { tex: `\\textsf{a half-turn about }${v}`, plain: `a half-turn about ${v}` }
}

function slotsOf(phi: Perm): number[] {
  return [...phi]
}

/** The slot transposition that swaps the objects with identities a and b under orientation k. */
export function swapPermutation(k: string, a: number, b: number): number[] {
  const phi = phiOf(k)
  return [...transposition(4, phi[a]!, phi[b]!)]
}

/** Chronological word of labels: "A, then B, then C" (the last four steps when longer). */
export function wordOf(labels: readonly ElementLabel[]): TextDesc | null {
  if (!labels.length) return null
  const shown = labels.length > 4 ? labels.slice(-3) : labels
  const lead = labels.length > 4 ? { tex: `\\textsf{${labels.length - 3} earlier steps, then }`, plain: `${labels.length - 3} earlier steps, then ` } : { tex: '', plain: '' }
  return {
    tex: `\\textsf{steps: }${lead.tex}${shown.map((l) => l.tex).join('\\textsf{, then }')}`,
    plain: `steps: ${lead.plain}${shown.map((l) => l.plain).join(', then ')}`,
  }
}

/** The product of a chronological list written conventionally, right to left ("E_{yz}\,R_{z}"). */
export function productTex(labels: readonly ElementLabel[]): string {
  return [...labels].reverse().map((l) => l.tex).join('\\,')
}

export function deriveCube(input: GroupSceneInput): CubeDesc {
  const g: FiniteGroup = input.group
  if (g.definition.kind !== 'cube_rotations') throw new Error('deriveCube: the cube scene needs the cube-rotation group')
  const k = input.accumulated
  const matrix = g.matrix(k)!.map((r) => [...r])
  const phi = slotsOf(phiOf(k))
  const occupant = [...inverse(phi)]
  const exp = input.experimentId
  const full = input.history.length >= DOMAIN_LIMITS.history

  // History with exact prefix products.
  const history: CubeStepDesc[] = []
  let acc = g.identity
  input.history.forEach((h, index) => {
    const m = g.matrix(h.element)!
    const info = rotationInfo(m)
    const before = acc
    const after = g.multiply(h.element, acc)
    const p = phiOf(h.element)
    const sb = slotsOf(phiOf(before))
    const sa = sb.map((s) => p[s]!)
    const moved = p.map((d, s) => (d !== s ? s : -1)).filter((s) => s >= 0)
    const occ = inverse(sb)
    const swapped: [number, number] | null = moved.length === 2 ? [Math.min(occ[moved[0]!]!, occ[moved[1]!]!), Math.max(occ[moved[0]!]!, occ[moved[1]!]!)] : null
    const words = turnWords(m)
    const label = g.label(h.element)
    history.push({
      index,
      element: h.element,
      via: h.via,
      label,
      kind: info.kind,
      axis: info.axis ? [info.axis[0], info.axis[1], info.axis[2]] : null,
      angle: info.angle,
      phi: [...p],
      phiCycles: cycleText(p),
      before,
      after,
      slotsBefore: sb,
      slotsAfter: sa,
      swapped,
      op: { tex: `\\textsf{applying }${label.tex}\\textsf{: }${words.tex}`, plain: `applying ${label.plain}: ${words.plain}` },
    })
    acc = after
  })
  if (acc !== k) throw new Error('deriveCube: accumulated element disagrees with the history')

  const objectsPerm = [...composeChronological(input.history.map((h) => phiOf(h.element)), 4)]
  const agree = permEq(objectsPerm, phi)
  const labels = input.history.map((h) => g.label(h.element))
  const kLabel = g.label(k)
  const word = wordOf(labels)
  const product = labels.length >= 2 && labels.length <= 4 ? `${productTex(labels)} = ` : ''
  const state: TextDesc = { tex: `k = ${product}${kLabel.tex}`, plain: `k = ${kLabel.plain}` }
  const phiText: TextDesc = { tex: `\\varphi(k) = ${cyclesTex(phi)}`, plain: `phi(k) = ${isIdentityPerm(phi) ? 'id' : cycleText(phi)}` }

  const last = history[history.length - 1] ?? null
  const driver = last ? (last.via === 'diagonal_lines' ? 'objects' : 'cube') : null
  const driverText = !last
    ? null
    : last.via === 'diagonal_lines'
      ? last.swapped
        ? `driven by the objects: swapping ${last.swapped[0]} and ${last.swapped[1]} resolved to the unique rotation ${last.label.plain}`
        : `driven by the objects: the permutation ${last.phiCycles} resolved to the unique rotation ${last.label.plain}`
      : `driven by the cube: ${last.label.plain} moves the objects by ${last.phiCycles}`

  const lineMatch = input.item ? /^line:([0-3])$/.exec(input.item) : null
  const selectedLine = lineMatch ? Number(lineMatch[1]) : null

  const objects: CubeObjectDesc[] = [0, 1, 2, 3].map((i) => {
    const slot = phi[i]!
    if (selectedLine === null) return { identity: i, slot, selected: false, actions: [{ kind: 'select_item', experimentId: exp, item: `line:${i}` }], hint: `Select diagonal ${i}`, swap: null }
    if (selectedLine === i) return { identity: i, slot, selected: true, actions: [{ kind: 'select_item', experimentId: exp, item: null }], hint: `Deselect diagonal ${i}`, swap: null }
    const permutation = swapPermutation(k, selectedLine, i)
    const element = rotationForDiagonalPermutation(permutation)!
    const label = g.label(element)
    if (full) return { identity: i, slot, selected: false, actions: [], hint: `The history holds ${DOMAIN_LIMITS.history} steps: reset first`, swap: { permutation, element, label } }
    return {
      identity: i,
      slot,
      selected: false,
      actions: [
        { kind: 'apply_permutation', experimentId: exp, representation: 'diagonal_lines', permutation },
        { kind: 'select_item', experimentId: exp, item: null },
      ],
      hint: `Swap ${Math.min(selectedLine, i)} and ${Math.max(selectedLine, i)}: the unique rotation ${label.plain}`,
      swap: { permutation, element, label },
    }
  })

  const cards: CubeCard[] = CUBE_CARD_DEFS.map((c) => {
    const element = rotationId(c.matrix)
    if (!g.has(element)) throw new Error(`deriveCube: card ${c.id} is not a rotation`)
    const label = g.label(element)
    const words = turnWords(c.matrix)
    return {
      id: c.id,
      element,
      label: c.id === 'card:h' ? { tex: `H = ${label.tex}`, plain: `H = ${label.plain}` } : label,
      caption: { tex: '', plain: c.caption },
      hint: full ? `The history holds ${DOMAIN_LIMITS.history} steps: reset first` : `Rotate the cube: ${label.plain}, ${words.plain}`,
      actions: full ? [] : [{ kind: 'apply_element', experimentId: exp, element }],
      enabled: !full,
    }
  })
  const kInv = g.inverse(k)
  const home = k === g.identity
  cards.push({
    id: 'card:return',
    element: home ? null : kInv,
    label: { tex: '\\textsf{Return}', plain: 'Return' },
    caption: home ? { tex: '', plain: 'already home' } : { tex: `k^{-1} = ${g.label(kInv).tex}`, plain: `k⁻¹ = ${g.label(kInv).plain}` },
    hint: home ? 'Already at the identity' : full ? `The history holds ${DOMAIN_LIMITS.history} steps: reset first` : `Return: apply ${g.label(kInv).plain}, the inverse of k`,
    actions: home || full ? [] : [{ kind: 'apply_element', experimentId: exp, element: kInv }],
    enabled: !home && !full,
  })

  const said = labels.length > 4 ? `${labels.length - 3} earlier steps then ${labels.slice(-3).map((l) => l.plain).join(' then ')}` : labels.map((l) => l.plain).join(' then ')
  const status = !last
    ? 'Home: each diagonal on its own line; rotate the cube or swap two objects'
    : home
      ? `${said}: back at the identity; the cube and the four diagonals agree, driven by the ${driver === 'objects' ? 'objects' : 'cube'}`
      : `${said}: the cube and the four diagonals agree (phi = ${isIdentityPerm(phi) ? 'id' : cycleText(phi)}); driven by the ${driver === 'objects' ? 'objects' : 'cube'}`

  return {
    layout: 'cube',
    experimentId: exp,
    revision: input.revision,
    mathRevision: input.mathRevision,
    groupId: input.groupId,
    element: k,
    label: kLabel,
    matrix,
    phi,
    phiCycles: cycleText(phi),
    occupant,
    objectsPerm,
    agree,
    history,
    word,
    state,
    phiText,
    driver,
    driverText,
    selectedLine,
    objects,
    cards,
    isHome: home,
    historyFull: full,
    status,
  }
}
