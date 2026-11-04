// Demonstration 3, "choose what matters" (FOUR-DEMOS-PARALLEL-HANDOFF section 7): the 24 rotations as
// marked cubes, the observation pi (which opposite-face pair lies on which unoriented axis line), the six
// classes of four (cosets of K) and composition of representatives. Pure and deterministic: exact data from
// src/algebra, plus plain layout numbers (bench metres) for the scene.
//
// Composition: "A, then B" is the element B·A; in the quotient, "[A], then [B]" is [B]·[A] = [B·A]. The
// description also checks, for the displayed pair of classes, all 16 choices of representatives.

import type { GroupSceneInput } from '../inputs'
import { rotationInfo, type ElementLabel, type FiniteGroup } from '../../algebra/groups'
import { DIAGONALS, KERNEL, axisClasses, classKey, classProduct, piOf } from '../../algebra/cube'
import { cycleText, isIdentityPerm, permOrder, type Perm } from '../../algebra/permutation'

export type Vec3 = [number, number, number]

export interface TextDesc {
  tex: string
  plain: string
}

export interface QCube {
  element: string
  /** Index 0..23 (group order), the instance slot in the scene. */
  index: number
  label: ElementLabel
  kind: 'identity' | 'face' | 'vertex' | 'edge'
  /** Exact matrix (rows). */
  matrix: number[][]
  classKey: string
  inKernel: boolean
  orderG: number
  /** Constellation slot (by kind of turn) and cluster slot (by class). */
  home: Vec3
  cluster: Vec3
  /** Where it is shown now, its size factor and whether its direction marks are shown. */
  pos: Vec3
  scale: number
  marks: boolean
  /** True while its class is expanded into the inspection row. */
  expanded: boolean
  selected: boolean
  dim: boolean
  operand: 'A' | 'B' | null
  actions: unknown[]
  hint: string
}

export interface QClass {
  key: string
  perm: number[]
  /** "(x\;y)" / "\mathrm{id}", plain "(x y)" / "id". */
  name: TextDesc
  elements: string[]
  isKernel: boolean
  /** Order of the class in G/K (= order of pi as a permutation). */
  order: number
  center: Vec3
  labelAt: Vec3
  expanded: boolean
  selected: boolean
  actions: unknown[]
  hint: string
}

export interface QPanelCube {
  role: 'A' | 'B' | 'BA' | 'qA' | 'qB' | 'qBA'
  element: string
  pos: Vec3
  marks: boolean
  label: TextDesc
  labelAt: Vec3
  actions: unknown[]
  hint: string
}

export interface QComposition {
  a: string
  b: string | null
  product: string | null
  aClass: string
  bClass: string | null
  productClass: string | null
  /** classProduct(bClass, aClass): [B]·[A] computed from class keys alone. */
  quotientProduct: string | null
  /** The detailed result's class equals the quotient product (computed exactly). */
  agree: boolean | null
  /** Distinct classes of b'·a' over all 16 representative choices a' in [A], b' in [B] (always one). */
  allChoices: string[] | null
  detail: TextDesc
  quotient: TextDesc
  check: TextDesc | null
}

export interface QPlate {
  id: string
  label: string
  actions: unknown[]
  hint: string
  enabled: boolean
  pos: Vec3
}

export interface QuotientDesc {
  layout: 'quotient'
  experimentId: string
  revision: number
  mathRevision: number
  observation: 'none' | 'unoriented_axis_lines'
  grouped: boolean
  cubes: QCube[]
  classes: QClass[]
  /** The class shown in the inspection row (from a class or element selection), or null. */
  expandedClass: string | null
  expandedHeader: TextDesc | null
  expandedLabels: { element: string; label: TextDesc; at: Vec3 }[]
  /** Constellation block captions (shown while not grouped). */
  blocks: { id: string; text: string; at: Vec3 }[]
  operands: [string | null, string | null]
  panel: QPanelCube[]
  composition: QComposition | null
  /** About the selected element or class (orders in G and in G/K). */
  info: TextDesc | null
  selectedElement: string | null
  selectedClass: string | null
  title: TextDesc
  legend: { parts: { tex: string; color: 'x' | 'y' | 'z' | 'text' | 'dim' }[]; plain: string }
  plates: QPlate[]
  status: string
}

/** Bench layout (metres). Kept inside x in [-0.5, 0.5], y in [-0.24, 0.32], z in [-0.25, 0.15]. */
export const QLAYOUT = {
  size: 0.036,
  cell: 0.055,
  clusterCols: [-0.335, -0.15, 0.035],
  clusterRows: [0.165, -0.005],
  clusterHalf: 0.028,
  shelfX: [0.215, 0.29, 0.365, 0.44],
  shelfY: 0.195,
  shelfScale: 1.0,
  detailY: 0.06,
  quotientY: -0.067,
  panelX: [0.235, 0.335, 0.445],
  platesY: -0.215,
  platesX: [-0.38, -0.19, 0, 0.19, 0.38],
} as const

/** Cluster order: the even permutations on top (K first), the transpositions below. */
const CLUSTER_ORDER = ['012', '120', '201', '102', '210', '021']
const AXES = ['x', 'y', 'z']

export function className(p: Perm): TextDesc {
  if (isIdentityPerm(p)) return { tex: '\\mathrm{id}', plain: 'id' }
  return { tex: cycleText(p, (i) => AXES[i]!).replace(/ /g, '\\;'), plain: cycleText(p, (i) => AXES[i]!) }
}

/** Slot in the constellation (by kind of turn); exact data decides the slot, never float comparisons. */
function homeSlot(m: readonly (readonly number[])[]): { block: number; row: number; col: number } {
  const t = m[0]![0]! + m[1]![1]! + m[2]![2]!
  const info = rotationInfo(m)
  if (info.kind === 'identity') return { block: 0, row: 0, col: 0 }
  if (info.kind === 'face') {
    // Fixed axis i: the diagonal entry 1 (quarter turns) or the one positive diagonal entry (half turns).
    const i = [0, 1, 2].find((k) => m[k]![k] === 1)!
    if (t === -1) return { block: 1, row: i, col: 1 }
    // Quarter turn: positive about +e_i when the skew part is positive.
    const w = [m[2]![1]! - m[1]![2]!, m[0]![2]! - m[2]![0]!, m[1]![0]! - m[0]![1]!]
    return { block: 1, row: i, col: w[i]! > 0 ? 0 : 2 }
  }
  if (info.kind === 'vertex') {
    const w = [m[2]![1]! - m[1]![2]!, m[0]![2]! - m[2]![0]!, m[1]![0]! - m[0]![1]!].map(Math.sign)
    const i = DIAGONALS.findIndex((d) => d.every((v, k) => v === w[k]) || d.every((v, k) => -v === w[k]))
    const positive = DIAGONALS[i]!.every((v, k) => v === w[k])
    return { block: 2, row: i, col: positive ? 0 : 1 }
  }
  // Edge half-turn: axis spans the columns of M + I; nonzero coordinates (i, k), same or opposite signs.
  const s = [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[r]![c]! + (r === c ? 1 : 0)))
  const c = [0, 1, 2].find((cc) => s.some((row) => row[cc] !== 0))!
  const a = s.map((row) => row[c]!)
  const nz = [0, 1, 2].filter((k) => a[k] !== 0)
  const pair = nz[0] === 0 && nz[1] === 1 ? 0 : nz[0] === 0 ? 1 : 2
  return { block: 3, row: pair, col: Math.sign(a[nz[0]!]!) === Math.sign(a[nz[1]!]!) ? 0 : 1 }
}

function homePosition(slot: { block: number; row: number; col: number }): Vec3 {
  const C = QLAYOUT.cell
  const top = 0.2
  switch (slot.block) {
    case 0:
      return [-0.44, 0.145, 0]
    case 1:
      return [-0.355 + slot.col * C, top - slot.row * C, 0]
    case 2:
      return [-0.165 + slot.col * C, top - slot.row * C, 0]
    default:
      return [-0.012 + slot.col * C, top - slot.row * C, 0]
  }
}

const r4 = (v: number) => Math.round(v * 10000) / 10000

export function deriveQuotient(input: GroupSceneInput): QuotientDesc {
  const g: FiniteGroup = input.group
  if (g.definition.kind !== 'cube_rotations') throw new Error('deriveQuotient: the quotient scene needs the cube-rotation group')
  const exp = input.experimentId
  const grouped = input.observation === 'unoriented_axis_lines'
  const item = input.item
  const selectedElement = item !== null && g.has(item) ? item : null
  const selectedClass = item !== null && item.startsWith('class:') ? item.slice(6) : null
  const classes0 = axisClasses()
  const expandedClass = selectedClass ?? (selectedElement && grouped ? classKey(selectedElement) : null)
  const [A, B] = input.operands

  const clusterIndex = new Map(CLUSTER_ORDER.map((k, i) => [k, i]))
  const clusterCenter = (key: string): Vec3 => {
    const i = clusterIndex.get(key)!
    return [QLAYOUT.clusterCols[i % 3]!, QLAYOUT.clusterRows[Math.floor(i / 3)]!, 0]
  }

  const cubes: QCube[] = g.elements.map((e, index) => {
    const m = g.matrix(e)!
    const key = classKey(e)
    const cls = classes0.find((c) => c.key === key)!
    const member = cls.elements.indexOf(e)
    const cc = clusterCenter(key)
    const h = QLAYOUT.clusterHalf
    const cluster: Vec3 = [r4(cc[0] + (member % 2 ? h : -h)), r4(cc[1] + (member < 2 ? h : -h)), 0]
    const home = homePosition(homeSlot(m)).map(r4) as Vec3
    const expanded = expandedClass === key
    const shelf: Vec3 = [QLAYOUT.shelfX[member]!, QLAYOUT.shelfY, 0.02]
    const pos = expanded ? shelf : grouped ? cluster : home
    const info = rotationInfo(m)
    const label = g.label(e)
    const selected = selectedElement === e
    return {
      element: e,
      index,
      label,
      kind: info.kind,
      matrix: m.map((r) => [...r]),
      classKey: key,
      inKernel: (KERNEL as readonly string[]).includes(e),
      orderG: g.elementOrder(e),
      home,
      cluster,
      pos,
      scale: expanded ? QLAYOUT.shelfScale : 1,
      marks: expanded || !grouped,
      expanded,
      selected,
      dim: expandedClass !== null && !expanded,
      operand: e === A ? 'A' : e === B ? 'B' : null,
      actions: [{ kind: 'select_item', experimentId: exp, item: selected ? null : e }],
      hint: selected ? `Deselect ${label.plain}` : `Select ${label.plain} (class ${key === '012' ? 'K' : className(piOf(e)).plain})`,
    }
  })

  const classes: QClass[] = CLUSTER_ORDER.map((key) => {
    const c = classes0.find((x) => x.key === key)!
    const center = clusterCenter(key)
    const name = className(c.perm)
    const sel = selectedClass === key
    return {
      key,
      perm: [...c.perm],
      name,
      elements: [...c.elements],
      isKernel: key === '012',
      order: permOrder(c.perm),
      center,
      labelAt: [center[0], r4(center[1] - 0.076), 0],
      expanded: expandedClass === key,
      selected: sel,
      actions: [{ kind: 'select_item', experimentId: exp, item: sel ? null : `class:${key}` }],
      hint: sel ? `Collapse class ${name.plain}` : `Expand class ${name.plain}${key === '012' ? ' (K)' : ''}`,
    }
  })

  // Inspection row header and labels.
  const ex = expandedClass ? classes.find((c) => c.key === expandedClass)! : null
  const expandedHeader: TextDesc | null = ex
    ? ex.isKernel
      ? { tex: `K = [I]\\textsf{: acts trivially on all three axis lines}`, plain: 'K = [I]: acts trivially on all three axis lines' }
      : { tex: `\\textsf{class }${ex.name.tex}\\textsf{: four rotations, one face-pair pattern}`, plain: `class ${ex.name.plain}: four rotations, one face-pair pattern` }
    : null
  const expandedLabels = ex ? ex.elements.map((e, i) => ({ element: e, label: g.label(e), at: [QLAYOUT.shelfX[i]!, QLAYOUT.shelfY - 0.046, 0.02] as Vec3 })) : []

  // Composition panel.
  const panel: QPanelCube[] = []
  let composition: QComposition | null = null
  const nm = (e: string) => className(piOf(e))
  const sel = (e: string) => [{ kind: 'select_item', experimentId: exp, item: e }]
  if (A !== null) {
    const product = B !== null ? g.multiply(B, A) : null
    const [x0, x1, x2] = QLAYOUT.panelX
    const dY = QLAYOUT.detailY
    const qY = QLAYOUT.quotientY
    const la = g.label(A)
    panel.push({ role: 'A', element: A, pos: [x0, dY, 0.02], marks: true, label: { tex: `A = ${la.tex}`, plain: `A = ${la.plain}` }, labelAt: [x0, dY - 0.041, 0.02], actions: sel(A), hint: `Select A = ${la.plain}` })
    panel.push({ role: 'qA', element: A, pos: [x0, qY, 0.02], marks: false, label: { tex: `[A] = ${nm(A).tex}`, plain: `[A] = ${nm(A).plain}` }, labelAt: [x0, qY - 0.041, 0.02], actions: [{ kind: 'select_item', experimentId: exp, item: `class:${classKey(A)}` }], hint: `Expand the class of A` })
    let detail: TextDesc = { tex: `\\textsf{in }G\\textsf{:}\\quad A\\textsf{; now choose }B`, plain: `in G: A = ${la.plain}; now choose B` }
    let quotient: TextDesc = { tex: `\\textsf{in }G/K\\textsf{:}\\quad [A]`, plain: `in G/K: [A] = ${nm(A).plain}` }
    let check: TextDesc | null = null
    let agree: boolean | null = null
    let allChoices: string[] | null = null
    let quotientProduct: string | null = null
    if (B !== null && product !== null) {
      const lb = g.label(B)
      const lp = g.label(product)
      panel.push({ role: 'B', element: B, pos: [x1, dY, 0.02], marks: true, label: { tex: `B = ${lb.tex}`, plain: `B = ${lb.plain}` }, labelAt: [x1, dY - 0.041, 0.02], actions: sel(B), hint: `Select B = ${lb.plain}` })
      panel.push({ role: 'BA', element: product, pos: [x2, dY, 0.02], marks: true, label: { tex: `B\\,A = ${lp.tex}`, plain: `BA = ${lp.plain}` }, labelAt: [x2, dY - 0.041, 0.02], actions: sel(product), hint: `Select B·A = ${lp.plain}` })
      panel.push({ role: 'qB', element: B, pos: [x1, qY, 0.02], marks: false, label: { tex: `[B] = ${nm(B).tex}`, plain: `[B] = ${nm(B).plain}` }, labelAt: [x1, qY - 0.041, 0.02], actions: [{ kind: 'select_item', experimentId: exp, item: `class:${classKey(B)}` }], hint: 'Expand the class of B' })
      quotientProduct = classProduct(classKey(B), classKey(A))
      const pClass = classKey(product)
      agree = pClass === quotientProduct
      panel.push({ role: 'qBA', element: product, pos: [x2, qY, 0.02], marks: false, label: { tex: `[B][A] = ${className(piOf(product)).tex}`, plain: `[B][A] = ${className(piOf(product)).plain}` }, labelAt: [x2, qY - 0.041, 0.02], actions: [{ kind: 'select_item', experimentId: exp, item: `class:${pClass}` }], hint: 'Expand the class of B·A' })
      const ca = classes0.find((c) => c.key === classKey(A))!
      const cb = classes0.find((c) => c.key === classKey(B))!
      const set = new Set<string>()
      for (const a2 of ca.elements) for (const b2 of cb.elements) set.add(classKey(g.multiply(b2, a2)))
      allChoices = [...set]
      // Row headers state the convention; the cube labels carry the values (plain text has the full equation).
      detail = { tex: `\\textsf{in }G\\textsf{:}\\quad A\\textsf{, then }B = B\\,A`, plain: `in G: A, then B = BA = ${lb.plain} ${la.plain} = ${lp.plain}` }
      quotient = { tex: `\\textsf{in }G/K\\textsf{:}\\quad [A]\\textsf{, then }[B] = [B][A]`, plain: `in G/K: [A], then [B] = [B][A] = ${nm(B).plain} ${nm(A).plain} = ${className(piOf(product)).plain}` }
      check = {
        tex: `\\textsf{all 16 choices of representatives give }${className(piOf(product)).tex}`,
        plain: `all 16 choices of representatives give ${className(piOf(product)).plain}`,
      }
      if (allChoices.length !== 1) check = { tex: '\\textsf{representatives disagree}', plain: 'representatives disagree' }
    }
    composition = {
      a: A,
      b: B,
      product,
      aClass: classKey(A),
      bClass: B !== null ? classKey(B) : null,
      productClass: product !== null ? classKey(product) : null,
      quotientProduct,
      agree,
      allChoices,
      detail,
      quotient,
      check,
    }
  } else if (B !== null) {
    const lb = g.label(B)
    panel.push({ role: 'B', element: B, pos: [QLAYOUT.panelX[1], QLAYOUT.detailY, 0.02], marks: true, label: { tex: `B = ${lb.tex}`, plain: `B = ${lb.plain}` }, labelAt: [QLAYOUT.panelX[1], QLAYOUT.detailY - 0.042, 0.02], actions: sel(B), hint: `Select B = ${lb.plain}` })
  }

  // Orders for the selection (Rz: 4 in G, its class 2 in G/K, because Rz^2 lies in K).
  let info: TextDesc | null = null
  if (selectedElement) {
    const l = g.label(selectedElement)
    const p = piOf(selectedElement)
    const m = permOrder(p)
    let pw = g.identity
    for (let i = 0; i < m; i++) pw = g.multiply(selectedElement, pw)
    const n = g.elementOrder(selectedElement)
    const cn = className(p)
    info =
      m === n
        ? { tex: `${l.tex}\\textsf{: order ${n} in }G\\textsf{; its class }${cn.tex}\\textsf{: order ${m} in }G/K`, plain: `${l.plain}: order ${n} in G; its class ${cn.plain}: order ${m} in G/K` }
        : {
            tex: `${l.tex}\\textsf{: order ${n} in }G\\textsf{; its class }${cn.tex}\\textsf{: order ${m} in }G/K\\textsf{, since }(${l.tex})^{${m}} = ${g.label(pw).tex} \\in K`,
            plain: `${l.plain}: order ${n} in G; its class ${cn.plain}: order ${m} in G/K, since (${l.plain})^${m} = ${g.label(pw).plain} is in K`,
          }
  } else if (ex) {
    const orders = ex.elements.map((e) => g.elementOrder(e))
    const nameTex = ex.isKernel ? 'K' : ex.name.tex
    const namePlain = ex.isKernel ? 'K' : ex.name.plain
    info = {
      tex: `\\textsf{class }${nameTex}\\textsf{: order ${ex.order} in }G/K\\textsf{; its members have orders ${orders.join(', ')} in }G`,
      plain: `class ${namePlain}: order ${ex.order} in G/K; its members have orders ${orders.join(', ')} in G`,
    }
  }

  const plates: QPlate[] = []
  const P = (i: number): Vec3 => [QLAYOUT.platesX[i]!, QLAYOUT.platesY, 0.05]
  plates.push(
    grouped
      ? { id: 'plate:observe', label: 'Show all 24', actions: [{ kind: 'set_observation', experimentId: exp, observation: 'none' }], hint: 'Show all 24 rotations with their direction marks', enabled: true, pos: P(0) }
      : { id: 'plate:observe', label: 'Track opposite-face pairs', actions: [{ kind: 'set_observation', experimentId: exp, observation: 'unoriented_axis_lines' }], hint: 'Track only which opposite-face pair goes where', enabled: true, pos: P(0) },
  )
  const choose = (which: 0 | 1): QPlate => {
    const id = which === 0 ? 'plate:chooseA' : 'plate:chooseB'
    const label = which === 0 ? 'Choose as A' : 'Choose as B'
    if (!selectedElement) return { id, label, actions: [], hint: 'Select a rotation first', enabled: false, pos: P(1 + which) }
    const ops: [string | null, string | null] = which === 0 ? [selectedElement, B] : [A, selectedElement]
    return { id, label, actions: [{ kind: 'set_operands', experimentId: exp, operands: ops }], hint: `${which === 0 ? 'A' : 'B'} = ${g.label(selectedElement).plain}`, enabled: true, pos: P(1 + which) }
  }
  plates.push(choose(0), choose(1))
  const another = (which: 0 | 1): QPlate => {
    const id = which === 0 ? 'plate:anotherA' : 'plate:anotherB'
    const label = which === 0 ? 'Another A' : 'Another B'
    const cur = which === 0 ? A : B
    if (cur === null) return { id, label, actions: [], hint: `Choose ${which === 0 ? 'A' : 'B'} first`, enabled: false, pos: P(3 + which) }
    const members = classes0.find((c) => c.key === classKey(cur))!.elements
    const next = members[(members.indexOf(cur) + 1) % members.length]!
    const ops: [string | null, string | null] = which === 0 ? [next, B] : [A, next]
    return { id, label, actions: [{ kind: 'set_operands', experimentId: exp, operands: ops }], hint: `Replace ${which === 0 ? 'A' : 'B'} by ${g.label(next).plain}, another representative of its class`, enabled: true, pos: P(3 + which) }
  }
  plates.push(another(0), another(1))

  // Captions of the constellation (shown while not grouped): block names below, turn angles above columns.
  const C = QLAYOUT.cell
  const blocks = [
    { id: 'block:identity', text: 'identity', at: [-0.44, -0.012, 0] as Vec3 },
    { id: 'block:face', text: 'face turns', at: [-0.355 + C, -0.012, 0] as Vec3 },
    { id: 'block:vertex', text: 'vertex turns', at: [-0.165 + C / 2, -0.012, 0] as Vec3 },
    { id: 'block:edge', text: 'edge half-turns', at: [-0.012 + C / 2, -0.012, 0] as Vec3 },
    { id: 'col:90', text: '90°', at: [-0.355, 0.238, 0] as Vec3 },
    { id: 'col:180', text: '180°', at: [-0.355 + C, 0.238, 0] as Vec3 },
    { id: 'col:270', text: '270°', at: [-0.355 + 2 * C, 0.238, 0] as Vec3 },
    { id: 'col:120', text: '120°', at: [-0.165, 0.238, 0] as Vec3 },
    { id: 'col:240', text: '240°', at: [-0.165 + C, 0.238, 0] as Vec3 },
  ]

  const title: TextDesc = grouped
    ? { tex: '\\textsf{Track only which opposite-face pair goes where: 6 classes of 4}', plain: 'Track only which opposite-face pair goes where: 6 classes of 4' }
    : { tex: '\\textsf{The 24 rotations of the cube, each a marked cube}', plain: 'The 24 rotations of the cube, each a marked cube' }
  const legend: QuotientDesc['legend'] = grouped
    ? {
        parts: [
          { tex: '\\textsf{kept: face colours (pairs }', color: 'text' },
          { tex: 'x', color: 'x' },
          { tex: '\\,y', color: 'y' },
          { tex: '\\,z', color: 'z' },
          { tex: '\\textsf{) on the axis lines}\\quad', color: 'text' },
          { tex: '\\textsf{ignored: the dots (directions)}', color: 'dim' },
        ],
        plain: 'kept: face colours (pairs x y z) on the axis lines; ignored: the dots (directions)',
      }
    : {
        parts: [
          { tex: '\\textsf{face colour: which opposite-face pair }', color: 'text' },
          { tex: 'x', color: 'x' },
          { tex: '\\,y', color: 'y' },
          { tex: '\\,z', color: 'z' },
          { tex: '\\quad\\textsf{dot: the pair\'s + face}', color: 'text' },
        ],
        plain: "face colour: which opposite-face pair (x y z); dot: the pair's + face",
      }

  const status = composition && composition.product !== null
    ? `A, then B: BA = ${g.label(composition.product).plain} in class ${className(piOf(composition.product)).plain}; [A] then [B] gives ${className(piOf(composition.product)).plain} too: detail and class results agree`
    : grouped
      ? 'Tracking only opposite-face pairs: 24 rotations fall into 6 classes of 4; K acts trivially on all three axis lines'
      : '24 rotations as marked cubes, grouped by kind of turn; nothing is forgotten yet'

  return {
    layout: 'quotient',
    experimentId: exp,
    revision: input.revision,
    mathRevision: input.mathRevision,
    observation: input.observation,
    grouped,
    cubes,
    classes,
    expandedClass,
    expandedHeader,
    expandedLabels,
    blocks,
    operands: [A, B],
    panel,
    composition,
    info,
    selectedElement,
    selectedClass,
    title,
    legend,
    plates,
    status,
  }
}
