// Kinetic group sculpture: the scene (FOUR-DEMOS-PARALLEL-HANDOFF sections 5, 9; src/domains/scene.ts).
//
// A tilted ring of |G| slots floats above a low plinth. One luminous bead per element rides it, each with a
// persistent identity colour, a distinct silhouette and its element label. Each slot has a thin collar in the
// colour of the bead whose home it is: a collar glows when its own bead sits in it, so "every bead is home"
// lights the whole ring. In front, one tangible card per element (label, and with element_orders its order as
// pips and the cycle notation of its regular action); an Apply plate, Reset and Replay. A short info column on
// the right gives the group, the chronological history, k and how far home is.
//
// Motion comes only from the description: a step's moves are the cycles of the applied element (derive.ts);
// path templates are chosen by cycle length (paths.ts). The scene never edits state: presses return actions.

import {
  AdditiveBlending, BoxGeometry, CanvasTexture, CapsuleGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry,
  DodecahedronGeometry, ExtrudeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry,
  PlaneGeometry, Quaternion, Raycaster, RingGeometry, Shape, ShapeGeometry, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  TetrahedronGeometry, TorusGeometry, TubeGeometry, Vector3, type BufferGeometry, type Intersection, type Material,
  type Object3D, type Ray,
} from 'three'
import type { FrameContext } from '../../runtime/host'
import type { PlaybackCommand, PlaybackState } from '../../rendering/adapter'
import { TextSlot, type SlotContent } from '../../rendering/textSlot'
import { palette } from '../../ui/palette'
import { IDLE_PLAYBACK, type DomainScene, type ScenePick, type SceneTransition } from '../scene'
import type { ScenePresentation } from '../../ui/model'
import type { SculptureDesc } from './derive'
import { ease, pathSpecs, PathCurve, ringFrame, RING, slotPosition, type RingFrame } from './paths'

/** Identity colours by element index (the first four are the workspace identity colours). */
export const BEAD_COLORS = [palette.identity[0], palette.identity[1], palette.identity[2], palette.identity[3], 0x7fb6ff, 0xff9fd2, 0xa6df6b, 0xe8ecf4] as const
/** Secondary identity cue by element index: the bead's silhouette. */
export const BEAD_SHAPES = ['sphere', 'octahedron', 'cube', 'torus', 'tetrahedron', 'puck', 'dodecahedron', 'capsule'] as const

const ACCENT = 0xffd27a
const HOME = 0xbff7e2
const CARD = 0x1a2130
const CARD_HOVER = 0x2a3550
const CARD_SELECTED = 0x252f46
/** Emissive added to the card whose element is moving the beads right now. */
const CARD_ACTIVE = 0x1c2a48
const PLATE = 0x222b3c
const PLATE_APPLY = 0x34405a

/** Font em sizes (metres) at the ~1.1 m viewing distance; nothing below 13.5 mm (Quest 3S legibility report). */
const EM = { title: 0.04, sub: 0.015, line: 0.0185, k: 0.03, home: 0.0185, small: 0.015, beadLabel: 0.021, slotNo: 0.0135, cardLabel: 0.032, cardCycle: 0.0168, cardOrder: 0.0145, plate: 0.017 } as const
const TIME = { motion: 1.6, hold: 0.5, trailFade: 0.9, appear: 0.5, homePulse: 1.5 } as const
const CARDS = { y: -0.178, z: 0.075, tilt: -0.3, gap: 0.014, h: 0.112, applyW: 0.09, smallW: 0.078 } as const
const INFO = { x: 0.31 } as const
/** Offset of text anchors above a card or plate face (TeX glyphs are built at z = -1 mm). */
const FACE_Z = 0.0026
const TRAIL = { radius: 0.0042, segments: 72, motion: 0.95, preview: 0.42 } as const

interface BeadRec {
  mesh: Mesh
  mat: MeshStandardMaterial
  halo: Mesh
  haloMat: MeshBasicMaterial
  label: TextSlot
  color: Color
  pos: Vector3
  wobble: number
}

interface SlotRec {
  collar: Mesh
  mat: MeshBasicMaterial
  base: Color
  glow: number
  number: TextSlot
}

interface CardRec {
  element: string
  pickId: string
  base: Group
  lifted: Group
  slabMat: MeshStandardMaterial
  rim: Mesh
  stripe: Mesh
  pips: Mesh[]
  pipMat: MeshBasicMaterial
  label: TextSlot
  cycles: TextSlot
  order: TextSlot
  hit: Mesh
  lift: number
  flash: number
}

interface PlateRec {
  id: 'apply' | 'reset' | 'replay'
  pickId: string
  rimMat: MeshBasicMaterial | null
  base: Group
  slabMat: MeshStandardMaterial
  label: TextSlot
  hit: Mesh
  enabled: boolean
}

interface PathRec {
  curve: PathCurve
  tube: TubeGeometry | null
  arrowPos: Vector3
  arrowQuat: Quaternion
}

interface TrailSet {
  meshes: Mesh[]
  mats: ShaderMaterial[]
  /** Per-bead brightness: trails in front of the ring plane a little brighter, behind it dimmer. */
  gains: number[]
  step: number
  /** Host time the step arrived, or -1 while moving. */
  arrived: number
  live: boolean
}

interface Built {
  key: string
  n: number
  /** Outer radius of a slot collar (metres). */
  collarOuter: number
  /** Card width (metres): face text is scaled down to fit it. */
  cardW: number
  holder: Group
  beads: BeadRec[]
  slots: SlotRec[]
  cards: CardRec[]
  /** paths[element index][source slot] */
  paths: PathRec[][]
  trails: [TrailSet, TrailSet]
  preview: { meshes: Mesh[]; mats: ShaderMaterial[]; arrows: Mesh[]; arrowMats: MeshBasicMaterial[] }
  geos: BufferGeometry[]
  mats: Material[]
  texts: TextSlot[]
}

interface Anim {
  first: number
  count: number
  time: number
  duration: number
  playing: boolean
  mode: 'apply' | 'replay'
  configured: number
}

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

function outlineGeometry(w: number, h: number, r: number, width: number): ShapeGeometry {
  const outer = roundedRect(w + width * 2, h + width * 2, r + width)
  outer.holes.push(roundedRect(w, h, r))
  return new ShapeGeometry(outer, 8)
}

function slabGeometry(w: number, h: number, depth: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(roundedRect(w, h, Math.min(w, h) * 0.12), { depth, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 6 })
  g.translate(0, 0, -depth - 0.0012)
  return g
}

function beadGeometry(i: number, r: number): BufferGeometry {
  switch (BEAD_SHAPES[i % BEAD_SHAPES.length]) {
    case 'sphere': return new SphereGeometry(r, 28, 18)
    case 'octahedron': return new OctahedronGeometry(r * 1.22)
    case 'cube': return new BoxGeometry(r * 1.42, r * 1.42, r * 1.42)
    case 'torus': return new TorusGeometry(r * 0.8, r * 0.36, 14, 28)
    case 'tetrahedron': return new TetrahedronGeometry(r * 1.4)
    case 'puck': return new CylinderGeometry(r, r, r * 0.95, 28).rotateX(Math.PI / 2)
    case 'dodecahedron': return new DodecahedronGeometry(r * 1.12)
    default: return new CapsuleGeometry(r * 0.62, r * 0.9, 6, 14)
  }
}

function haloTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.32)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** Soft additive tube: brighter toward its head, faded at the cut ends, rim-softened; an optional travelling pulse. */
function trailMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color() }, head: { value: 1 }, opacity: { value: 0 }, pulse: { value: -1 }, cutStart: { value: 0 }, cutEnd: { value: 1 } },
    vertexShader: `varying float vU; varying vec3 vN; varying vec3 vV;
      void main() {
        vU = uv.x;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float head; uniform float opacity; uniform float pulse; uniform float cutStart; uniform float cutEnd;
      varying float vU; varying vec3 vN; varying vec3 vV;
      void main() {
        if (vU > head) discard;
        float grad = mix(0.25, 1.0, smoothstep(head - 0.8, head, vU));
        float ends = smoothstep(cutStart, cutStart + 0.08, vU) * (1.0 - smoothstep(cutEnd - 0.08, cutEnd, vU));
        float rim = 0.35 + 0.65 * pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float p = pulse < 0.0 ? 0.0 : 0.9 * exp(-pow((vU - pulse) / 0.07, 2.0));
        gl_FragColor = vec4(color * (1.0 + 0.6 * p), (grad + p) * ends * rim * opacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/** The step index that is moving now, or -1 (at rest or holding between replay steps). */
const st0 = (stepIdx: number, p: number): number => (stepIdx >= 0 && p < 1 ? stepIdx : -1)

const plainText = (plain: string, em: number, color: number = palette.text): SlotContent => ({ kind: 'plain', plain, em, color })
const texText = (tex: string, plain: string, em: number, color: number = palette.text): SlotContent => ({ kind: 'tex', parts: [{ tex }], em, color, plain })

// Scratch objects (step() never allocates).
const vA = new Vector3()
const vB = new Vector3()
const vHead = new Vector3()
const UP = new Vector3(0, 1, 0)

export class SculptureScene implements DomainScene<SculptureDesc> {
  readonly layout = 'sculpture' as const
  private readonly root = new Group()
  private readonly frame: RingFrame = ringFrame()
  private readonly raycaster = new Raycaster()
  private readonly hits: Intersection[] = []
  private pickables: Object3D[] = []
  private desc: SculptureDesc | null = null
  private built: Built | null = null
  private anim: Anim | null = null
  private motion: number = TIME.motion
  private hold: number = TIME.hold
  private hover: string | null = null
  private now = 0
  private appearStart = -1
  private shownMoment = -1
  private homePulseStart = -10
  private previewOp = -2
  private previewMoment = -2
  private previewOpacity = 0
  private stepElement = 0
  private numbersOpacity = 1
  private shownMovingStep = -1

  // Static parts (independent of the group).
  private readonly statics = { geos: [] as BufferGeometry[], mats: [] as Material[] }
  private readonly ring = new Group()
  private readonly pulse: Mesh
  private readonly pulseMat: MeshBasicMaterial
  private readonly halo: CanvasTexture
  private readonly info: Record<'title' | 'sub' | 'history' | 'k' | 'home' | 'orders' | 'contrastA' | 'contrastB' | 'explainA' | 'explainB', TextSlot>
  private readonly plates: PlateRec[] = []
  private readonly allTexts: TextSlot[] = []
  private readonly billboards: TextSlot[] = []
  /** Under the UI shell (inSceneControls false) the cards, plates and info column are the shell's; the ring,
   * beads, collars, slot numbers, bead labels and paths stay. Hidden controls have no hit targets. */
  private presentation: ScenePresentation = { inSceneControls: true, detailsOpen: false }

  constructor() {
    this.root.name = 'sculpture'
    this.halo = haloTexture()
    const f = this.frame

    // The ring: a thin rail in the tilted plane, above a low plinth.
    this.ring.position.copy(f.center)
    this.ring.rotation.x = -RING.tilt
    const railGeo = this.sgeo(new TorusGeometry(RING.radius, 0.0026, 10, 180))
    const railMat = this.smat(new MeshStandardMaterial({ color: 0x7d89a0, metalness: 0.55, roughness: 0.32, emissive: 0x1b2232 }))
    this.ring.add(new Mesh(railGeo, railMat))
    const glowGeo = this.sgeo(new RingGeometry(RING.radius - 0.009, RING.radius + 0.009, 180))
    const glow = new Mesh(glowGeo, this.smat(new MeshBasicMaterial({ color: 0x3a4a6a, transparent: true, opacity: 0.16, depthWrite: false, blending: AdditiveBlending })))
    glow.position.z = -0.002
    this.ring.add(glow)
    this.pulseMat = this.smat(new MeshBasicMaterial({ color: HOME, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending })) as MeshBasicMaterial
    this.pulse = new Mesh(this.sgeo(new RingGeometry(RING.radius - 0.005, RING.radius + 0.005, 180)), this.pulseMat)
    this.pulse.visible = false
    this.ring.add(this.pulse)
    this.root.add(this.ring)

    const plinth = new Mesh(this.sgeo(new CylinderGeometry(0.105, 0.118, 0.012, 64)), this.smat(new MeshStandardMaterial({ color: 0x161c28, metalness: 0.2, roughness: 0.7 })))
    plinth.position.set(f.center.x, -0.118, f.center.z + 0.03)
    this.root.add(plinth)
    const plinthRim = new Mesh(this.sgeo(new RingGeometry(0.1, 0.104, 96)), this.smat(new MeshBasicMaterial({ color: 0x3b4760, transparent: true, opacity: 0.7, depthWrite: false })))
    plinthRim.rotation.x = -Math.PI / 2
    plinthRim.position.set(f.center.x, -0.1115, f.center.z + 0.03)
    this.root.add(plinthRim)

    // Info column (billboarded text).
    const mk = (id: string, y: number) => {
      const s = this.text(`sc:${id}`, this.root, true)
      s.anchor.position.set(INFO.x, y, -0.06)
      return s
    }
    this.info = {
      title: mk('title', 0.245),
      sub: mk('sub', 0.205),
      history: mk('history', 0.158),
      k: mk('k', 0.112),
      home: mk('home', 0.066),
      orders: mk('orders', 0.004),
      contrastA: mk('contrastA', -0.03),
      contrastB: mk('contrastB', -0.054),
      explainA: mk('explainA', -0.094),
      explainB: mk('explainB', -0.116),
    }

    for (const id of ['apply', 'reset', 'replay'] as const) this.plates.push(this.makePlate(id))
  }

  // ---------------------------------------------------------------- DomainScene

  mount(parent: Object3D): void {
    parent.add(this.root)
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  /** Presentation options from the shell (src/ui/model.ts ScenePresentation): never changes the mathematics. */
  setPresentation(p: ScenePresentation): void {
    if (p.inSceneControls === this.presentation.inSceneControls && p.detailsOpen === this.presentation.detailsOpen) return
    this.presentation = { ...p }
    this.applyPresentation()
  }

  /** Show or hide the scene's own controls and text column; the pickables follow what is visible. */
  private applyPresentation(): void {
    const own = this.presentation.inSceneControls
    for (const s of Object.values(this.info)) s.setWanted(own)
    for (const p of this.plates) p.base.visible = own
    if (this.built) for (const c of this.built.cards) c.base.visible = own
    this.pickables = own ? [...(this.built?.cards.map((c) => c.hit) ?? []), ...this.plates.map((p) => p.hit)] : []
  }

  setStepDuration(seconds: number): void {
    this.motion = Math.min(5, Math.max(0.3, seconds))
    this.hold = Math.min(0.6, this.motion * 0.3)
  }

  apply(desc: SculptureDesc, transition: SceneTransition): void {
    // Edit during playback: finish the running animation at its exact committed end first.
    if (this.anim) this.finishAnim()
    const prev = this.desc
    const key = `${desc.groupId}|${desc.groupKey}|${desc.elements.join(',')}`
    const sameGroup = !!this.built && this.built.key === key
    if (!sameGroup) this.rebuild(desc, key)
    this.desc = desc
    const grew =
      transition === 'animate' &&
      !!prev &&
      sameGroup &&
      prev.experimentId === desc.experimentId &&
      desc.history.length === prev.history.length + 1 &&
      prev.history.every((h, i) => h.element === desc.history[i]!.element)
    if (grew && desc.show.beads) {
      this.anim = { first: desc.history.length - 1, count: 1, time: 0, duration: this.motion, playing: true, mode: 'apply', configured: -1 }
    } else if (!(prev && sameGroup && prev.experimentId === desc.experimentId && prev.history.length === desc.history.length && prev.history.every((h, i) => h.element === desc.history[i]!.element))) {
      // Reset, undo, rebind, another experiment: jump to the committed state, no trails left behind.
      this.hideTrails()
      this.shownMoment = -1
    }
    this.previewOp = -2
    this.applyStatic(desc)
    this.applyPresentation()
  }

  step(ctx: FrameContext): void {
    this.now = ctx.time
    const d = this.desc
    const b = this.built
    if (!d || !b) return
    const n = b.n
    if (this.appearStart < 0) this.appearStart = ctx.time

    // Animation clock -> displayed moment and the moving step.
    let moment = d.history.length
    let stepIdx = -1
    let p = 1
    const a = this.anim
    if (a) {
      if (a.playing) a.time = Math.min(a.duration, a.time + ctx.dt)
      const span = this.motion + this.hold
      const j = Math.min(a.count - 1, Math.floor(a.time / span))
      p = Math.min(1, (a.time - j * span) / this.motion)
      stepIdx = a.first + j
      moment = stepIdx + (p >= 1 ? 1 : 0)
      if (a.configured !== stepIdx) this.configureTrails(stepIdx)
      if (a.playing && a.time >= a.duration) {
        this.finishAnim()
        moment = d.history.length
        stepIdx = -1
        p = 1
      }
    }
    if (moment !== this.shownMoment) this.showMoment(moment)
    const slots = d.timeline[moment]!.slots

    // While a step moves, the info column names it and its cycles; at rest it says how far home is.
    const movingStep = st0(stepIdx, p)
    if (movingStep !== this.shownMovingStep) {
      this.shownMovingStep = movingStep
      if (movingStep >= 0) {
        const ms = d.steps[movingStep]!
        this.info.home.set(plainText(`applying ${ms.label.plain} · ${ms.cycleText === '()' ? 'every bead stays' : ms.cycleText}`, EM.home, palette.text))
      } else this.showMoment(moment, false)
    }
    this.root.worldToLocal(vHead.copy(ctx.head))

    // Beads.
    const appear = ease(Math.min(1, (ctx.time - this.appearStart) / TIME.appear))
    const st = stepIdx >= 0 ? d.steps[stepIdx]! : null
    const ep = ease(p)
    for (let i = 0; i < n; i++) {
      const bead = b.beads[i]!
      if (st && p < 1) b.paths[this.stepElement]![st.moves[i]!.from]!.curve.getPoint(ep, bead.pos)
      else slotPosition(this.frame, slots[i]!, n, bead.pos)
      bead.mesh.position.copy(bead.pos)
      bead.mesh.scale.setScalar(appear)
      bead.mesh.rotation.y = 0.45 * Math.sin(ctx.time * 0.55 + bead.wobble)
      bead.mesh.rotation.x = -RING.tilt + 0.25 * Math.sin(ctx.time * 0.4 + bead.wobble * 1.7)
      // Depth cue for flat footage: beads in front of the ring plane glow a little more, beads behind less.
      const depth = vB.copy(bead.pos).sub(this.frame.center).dot(this.frame.normal) / RING.depth
      bead.mat.emissiveIntensity = 0.42 + 0.2 * depth
      bead.haloMat.opacity = 0.3 + 0.14 * depth
      bead.halo.position.copy(bead.pos)
      bead.halo.scale.setScalar(appear * (1 + 0.12 * depth))
      bead.halo.lookAt(ctx.head)
      // Label: outward from the ring centre, in the ring plane.
      vA.copy(bead.pos).sub(this.frame.center)
      vA.addScaledVector(this.frame.normal, -vA.dot(this.frame.normal))
      if (vA.lengthSq() < 1e-6) vA.copy(this.frame.up)
      vA.normalize()
      // Clear of the collar whatever the label's width: wide labels ("(1,1)") go further out at the sides.
      const reach = b.collarOuter + 0.007 + Math.abs(vA.dot(this.frame.right)) * bead.label.width * 0.5 + Math.abs(vA.dot(this.frame.up)) * bead.label.height * 0.5
      bead.label.anchor.position.copy(bead.pos).addScaledVector(vA, reach)
      // ... and a little toward the viewer, so the rail never cuts a label of a bead behind the ring plane.
      vB.copy(vHead).sub(bead.label.anchor.position).normalize()
      bead.label.anchor.position.addScaledVector(vB, 0.03)
      bead.label.setOpacity(appear)
    }

    // Trails of the moving step (two sets, so the previous step can fade while the next one starts).
    for (let ti = 0; ti < 2; ti++) {
      const set = b.trails[ti]!
      if (!set.live) continue
      let op = TRAIL.motion
      if (st && set.step === stepIdx) {
        for (let i = 0; i < set.mats.length; i++) set.mats[i]!.uniforms.head!.value = ep
        if (p >= 1 && set.arrived < 0) set.arrived = ctx.time
      }
      if (set.arrived >= 0) op = TRAIL.motion * Math.exp(-(ctx.time - set.arrived) / TIME.trailFade)
      if (op < 0.01) {
        set.live = false
        for (let i = 0; i < set.meshes.length; i++) set.meshes[i]!.visible = false
        continue
      }
      for (let i = 0; i < set.mats.length; i++) set.mats[i]!.uniforms.opacity!.value = op * set.gains[i]!
    }

    // Preview of the selected operation at rest (cycle_trails).
    const opIndex = d.operation !== null ? d.elements.indexOf(d.operation) : -1
    const wantPreview = !this.anim && d.show.trails && d.show.beads && opIndex > 0
    if (wantPreview && (opIndex !== this.previewOp || moment !== this.previewMoment)) this.configurePreview(opIndex, moment)
    this.previewOpacity += ((wantPreview ? 1 : 0) - this.previewOpacity) * Math.min(1, ctx.dt * (wantPreview ? 3 : 10))
    const pv = b.preview
    const showPv = this.previewOpacity > 0.01 && this.previewOp > 0
    const pulse = 0.14 + ((ctx.time * 0.42) % 1) * 0.72
    for (let s = 0; s < n; s++) {
      const on = showPv && pv.meshes[s]!.userData.on === true
      pv.meshes[s]!.visible = on
      pv.arrows[s]!.visible = on
      if (on) {
        pv.mats[s]!.uniforms.opacity!.value = TRAIL.preview * this.previewOpacity
        pv.mats[s]!.uniforms.pulse!.value = pulse
        pv.arrowMats[s]!.opacity = 0.75 * this.previewOpacity
      }
    }

    // Slot collars: glow when their own bead is in them.
    const pulseT = (ctx.time - this.homePulseStart) / TIME.homePulse
    const pulseK = pulseT >= 0 && pulseT < 1 ? 1 - pulseT : 0
    const moving = !!st && p < 1
    const restSlots = d.timeline[moment]!.slots
    const numTarget = moving ? 0 : 1
    this.numbersOpacity += (numTarget - this.numbersOpacity) * Math.min(1, ctx.dt * 8)
    // Settle exactly, so TextSlot.setOpacity sees an unchanged value (and does no work) at rest.
    if (Math.abs(numTarget - this.numbersOpacity) < 0.01) this.numbersOpacity = numTarget
    for (let s = 0; s < n; s++) {
      const rec = b.slots[s]!
      rec.number.setOpacity(this.numbersOpacity < 0.02 ? 0 : this.numbersOpacity * appear)
      // A collar glows when its own bead rests in it; while beads travel every collar is an open socket.
      const target = moving ? 0.04 : restSlots[s] === s ? 1 : 0
      rec.glow += (target - rec.glow) * Math.min(1, ctx.dt * 6)
      rec.mat.color.copy(rec.base).multiplyScalar(0.22 + 0.78 * rec.glow + 0.6 * pulseK)
      rec.collar.scale.setScalar(appear * (1 + 0.18 * pulseK))
    }
    this.pulse.visible = pulseK > 0
    if (pulseK > 0) {
      this.pulse.scale.setScalar(1 + 0.22 * (1 - pulseK))
      this.pulseMat.opacity = 0.55 * pulseK
    }

    // Cards: lift the selected one, flash the one being applied, hover.
    for (let ci = 0; ci < b.cards.length; ci++) {
      const c = b.cards[ci]!
      const sel = c.element === d.operation ? 1 : 0
      c.lift += (sel - c.lift) * Math.min(1, ctx.dt * 9)
      const active = st && p < 1 && st.element === c.element ? 1 : 0
      c.flash += (active - c.flash) * Math.min(1, ctx.dt * 7)
      c.lifted.position.set(0, 0.004 * c.lift, 0.014 * c.lift)
      // Long cycle notation (C6, C8) shrinks to the card instead of spilling over its neighbours.
      const fit = b.cardW - 0.01
      c.cycles.anchor.scale.setScalar(c.cycles.width > fit ? fit / c.cycles.width : 1)
      c.label.anchor.scale.setScalar(c.label.width > fit ? fit / c.label.width : 1)
      c.lifted.scale.setScalar(1 + 0.035 * c.lift)
      const hov = this.hover === c.pickId
      c.slabMat.color.setHex(hov ? CARD_HOVER : c.lift > 0.5 ? CARD_SELECTED : CARD)
      c.slabMat.emissive.setHex(CARD_ACTIVE).multiplyScalar(c.flash)
    }
    for (let pi = 0; pi < this.plates.length; pi++) {
      const pl = this.plates[pi]!
      const hov = this.hover === pl.pickId
      pl.slabMat.color.setHex(hov && pl.enabled ? CARD_HOVER : pl.id === 'apply' && pl.enabled ? PLATE_APPLY : PLATE)
    }

    // Text: freshness frames for every slot; floating text faces this frame's head.
    for (let i = 0; i < this.allTexts.length; i++) this.allTexts[i]!.frame(ctx.time)
    for (let i = 0; i < b.texts.length; i++) b.texts[i]!.frame(ctx.time)
    for (let i = 0; i < this.billboards.length; i++) {
      const t = this.billboards[i]!
      if (t.anchor.visible) t.anchor.lookAt(ctx.head)
    }
    for (let i = 0; i < n; i++) {
      const l = b.beads[i]!.label.anchor
      if (l.visible) l.lookAt(ctx.head)
      const sn = b.slots[i]!.number.anchor
      if (sn.visible) sn.lookAt(ctx.head)
    }
  }

  setPlayback(cmd: PlaybackCommand): PlaybackState {
    const d = this.desc
    const startReplay = (paused: boolean) => {
      if (!d || !d.history.length || !d.show.beads) return
      this.hideTrails()
      const count = d.history.length
      this.anim = { first: 0, count, time: 0, duration: count * this.motion + (count - 1) * this.hold, playing: !paused, mode: 'replay', configured: -1 }
    }
    if (cmd === 'replay') startReplay(false)
    else if (cmd === 'play') {
      if (this.anim) this.anim.playing = true
      else startReplay(false)
    } else if (cmd === 'pause') {
      if (this.anim) this.anim.playing = false
    } else if (cmd === 'toggle') {
      if (this.anim) this.anim.playing = !this.anim.playing
      else startReplay(false)
    } else if (cmd === 'finish') this.finishAnim()
    else if (typeof cmd === 'object' && 'seek' in cmd) {
      if (!this.anim) startReplay(true)
      if (this.anim) {
        this.anim.time = Math.min(this.anim.duration, Math.max(0, cmd.seek))
        this.anim.configured = -1
        this.hideTrails()
      }
    }
    return this.playback()
  }

  playback(): PlaybackState {
    const a = this.anim
    const d = this.desc
    if (!a || !d) return { ...IDLE_PLAYBACK }
    const span = this.motion + this.hold
    const j = Math.min(a.count - 1, Math.floor(a.time / span))
    const idx = a.first + j
    const lab = d.history[idx]!.label.plain
    return {
      active: true,
      playing: a.playing,
      time: a.time,
      duration: a.duration,
      phase: a.mode,
      step: { index: idx + 1, count: d.history.length, label: `${lab} · step ${idx + 1} of ${d.history.length}` },
    }
  }

  pick(ray: Ray): ScenePick | null {
    if (!this.root.visible || !this.desc || !this.built) return null
    this.raycaster.ray.copy(ray)
    this.hits.length = 0
    this.raycaster.intersectObjects(this.pickables, false, this.hits)
    const h = this.hits[0]
    if (!h) return null
    return this.pickFor(h.object.userData.pickId as string, h.distance)
  }

  setHover(id: string | null): void {
    this.hover = id
  }

  status(): string {
    const d = this.desc
    if (!d) return 'Group sculpture: nothing to show'
    // While beads move, never describe the pose as home: name the committed target being shown.
    if (this.anim && this.shownMovingStep >= 0) {
      const st = d.steps[this.shownMovingStep]!
      return `${d.groupLabel.plain} · applying ${st.label.plain}: showing the move to k = ${d.timeline[st.index + 1]!.accumulatedLabel.plain}`
    }
    const m = this.shownMoment >= 0 && this.shownMoment < d.timeline.length ? this.shownMoment : d.history.length
    return d.timeline[m]!.status
  }

  report(): Record<string, unknown> {
    const d = this.desc
    const b = this.built
    const r3 = (v: Vector3) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]
    let meshes = 0
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++
    })
    return {
      layout: this.layout,
      experimentId: d?.experimentId ?? null,
      group: d?.groupLabel.plain ?? null,
      order: d?.order ?? 0,
      show: d?.show ?? null,
      operation: d?.operation ?? null,
      history: d?.history.map((h) => h.element) ?? [],
      displayedMoment: this.shownMoment,
      atHome: d ? d.timeline[Math.max(0, Math.min(d.timeline.length - 1, this.shownMoment))]!.atHome : null,
      playback: this.playback(),
      beads: b && d ? b.beads.map((bead, i) => ({ element: d.elements[i], shape: BEAD_SHAPES[i % BEAD_SHAPES.length], color: `#${BEAD_COLORS[i % BEAD_COLORS.length]!.toString(16).padStart(6, '0')}`, position: r3(bead.pos) })) : [],
      cards: d?.cards.map((c) => ({ element: c.element, label: c.label.plain, order: c.order, cycles: c.cycleText, selected: c.selected, generates: c.generates })) ?? [],
      status: this.status(),
      presentation: { ...this.presentation, pickables: this.pickables.length },
      meshes,
      tubes: b ? b.paths.flat().filter((p) => p.tube).length : 0,
      texts: [...this.allTexts, ...(b?.texts ?? [])].map((t) => t.report()).map((t) => ({ id: t.id, state: t.state, visible: t.visible, plain: t.plain })),
    }
  }

  dispose(): void {
    this.disposeBuilt()
    for (const t of this.allTexts) t.dispose()
    this.allTexts.length = 0
    this.statics.geos.forEach((g) => g.dispose())
    this.statics.mats.forEach((m) => m.dispose())
    this.halo.dispose()
    this.root.removeFromParent()
  }

  // ---------------------------------------------------------------- picks

  private pickFor(id: string, distance: number): ScenePick {
    const d = this.desc!
    const exp = d.experimentId
    const full = d.historyFull
    if (id.startsWith('card:')) {
      const g = id.slice(5)
      const card = d.cards.find((c) => c.element === g)!
      // A card only selects: pressing the selected card again applies nothing (Apply is the one execution path).
      if (g === d.operation) return { id, distance, actions: [], hint: `${card.label.plain} is selected: press Apply to apply it` }
      const extra = d.show.orders ? ` · order ${card.order} · ${card.cycleText}` : ''
      return { id, distance, actions: [{ kind: 'select_item', experimentId: exp, item: g }], hint: `Select ${card.label.plain}${extra}` }
    }
    if (id === 'plate:apply') {
      if (d.operation === null) return { id, distance, actions: [], hint: 'Choose a card first' }
      if (full) return { id, distance, actions: [], hint: `History full (${d.history.length} steps): reset first` }
      const lab = d.cards.find((c) => c.element === d.operation)!.label.plain
      return { id, distance, actions: [{ kind: 'apply_element', experimentId: exp, element: d.operation }], hint: `Apply ${lab}` }
    }
    if (id === 'plate:reset') {
      if (!d.history.length) return { id, distance, actions: [], hint: 'Already home: nothing to reset' }
      return { id, distance, actions: [{ kind: 'reset_group', experimentId: exp }], hint: 'Reset: every bead home' }
    }
    if (!d.history.length) return { id, distance, actions: [], hint: 'Nothing to replay yet' }
    return { id, distance, actions: [], presentation: 'replay', hint: `Replay ${d.history.length === 1 ? 'the step' : `${d.history.length} steps`} from home` }
  }

  // ---------------------------------------------------------------- animation helpers

  private finishAnim(): void {
    const a = this.anim
    if (!a) return
    this.anim = null
    const last = a.first + a.count - 1
    const b = this.built
    if (!b) return
    for (const set of b.trails) {
      if (set.live && set.step === last) {
        for (const m of set.mats) m.uniforms.head!.value = 1
        if (set.arrived < 0) set.arrived = this.now
      }
    }
  }

  private hideTrails(): void {
    const b = this.built
    if (!b) return
    for (const set of b.trails) {
      set.live = false
      set.arrived = -1
      set.step = -1
      for (const m of set.meshes) m.visible = false
    }
  }

  private configureTrails(stepIdx: number): void {
    const d = this.desc!
    const b = this.built!
    const a = this.anim!
    a.configured = stepIdx
    const st = d.steps[stepIdx]!
    this.stepElement = d.elements.indexOf(st.element)
    const set = b.trails[stepIdx % 2]!
    set.step = stepIdx
    set.arrived = -1
    set.live = d.show.trails
    for (let i = 0; i < b.n; i++) {
      const mv = st.moves[i]!
      const mesh = set.meshes[i]!
      const path = b.paths[this.stepElement]![mv.from]!
      if (!d.show.trails || mv.from === mv.to || !path.tube) {
        mesh.visible = false
        continue
      }
      mesh.geometry = path.tube
      const spec = path.curve.spec
      set.gains[i] = 1 + 0.4 * (spec.kind === 'swap' ? spec.depth / RING.depth : spec.kind === 'flow' ? spec.lift / RING.lift : 0)
      const u = set.mats[i]!.uniforms
      ;(u.color!.value as Color).copy(b.beads[i]!.color)
      u.head!.value = 0
      u.opacity!.value = TRAIL.motion
      mesh.visible = true
    }
  }

  private configurePreview(opIndex: number, moment: number): void {
    const d = this.desc!
    const b = this.built!
    this.previewOp = opIndex
    this.previewMoment = moment
    const slots = d.timeline[moment]!.slots
    for (let s = 0; s < b.n; s++) {
      const path = b.paths[opIndex]![s]!
      const mesh = b.preview.meshes[s]!
      const on = !!path.tube
      mesh.userData.on = on
      if (!on) continue
      mesh.geometry = path.tube!
      let bead = 0
      for (let i = 0; i < b.n; i++) if (slots[i] === s) bead = i
      ;(b.preview.mats[s]!.uniforms.color!.value as Color).copy(b.beads[bead]!.color)
      b.preview.arrowMats[s]!.color.copy(b.beads[bead]!.color)
      const arrow = b.preview.arrows[s]!
      arrow.position.copy(path.arrowPos)
      arrow.quaternion.copy(path.arrowQuat)
    }
  }

  /** Readouts for the displayed moment (changes only at step boundaries). */
  private showMoment(m: number, mark = true): void {
    const d = this.desc!
    const prev = this.shownMoment
    this.shownMoment = m
    if (!mark && prev === m && this.shownMovingStep < 0) {
      const t0 = d.timeline[m]!
      this.info.home.set(plainText(t0.homeLine, EM.home, t0.atHome && m > 0 ? HOME : palette.textDim))
      return
    }
    const t = d.timeline[m]!
    this.info.history.set(plainText(t.historyText ? t.historyText : 'nothing applied yet', EM.line, t.historyText ? palette.text : palette.textDim))
    this.info.k.set(texText(`k = ${t.accumulatedLabel.tex}`, `k = ${t.accumulatedLabel.plain}`, EM.k))
    const homeAgain = t.atHome && m > 0
    this.info.home.set(plainText(t.homeLine, EM.home, homeAgain ? HOME : palette.textDim))
    if (homeAgain && prev >= 0 && prev !== m) this.homePulseStart = this.now
  }

  // ---------------------------------------------------------------- building

  private applyStatic(desc: SculptureDesc): void {
    const b = this.built!
    const n = b.n
    const orders = desc.show.orders
    this.info.title.set(texText(desc.groupLabel.tex, desc.groupLabel.plain, EM.title))
    this.info.sub.set(plainText(`${n} elements · bead x sits in slot k·x`, EM.sub, palette.textDim))
    this.info.orders.set(orders ? plainText(desc.orders.summary, EM.line, palette.text) : null)
    const [ca, cb] = desc.orders.contrastLines
    this.info.contrastA.set(orders ? plainText(ca, EM.line, desc.orders.cyclic ? ACCENT : palette.text) : null)
    this.info.contrastB.set(orders ? plainText(cb, EM.small, palette.textDim) : null)
    this.info.explainA.set(orders ? plainText('same number of elements,', EM.small, palette.textDim) : null)
    this.info.explainB.set(orders ? plainText('different operation structure', EM.small, palette.textDim) : null)

    for (const bead of b.beads) {
      bead.mesh.visible = desc.show.beads
      bead.halo.visible = desc.show.beads
      bead.label.setWanted(desc.show.beads)
    }
    this.ring.visible = desc.show.beads
    for (const s of b.slots) {
      s.collar.visible = desc.show.beads
      s.number.setWanted(desc.show.beads)
    }

    for (const c of b.cards) {
      const card = desc.cards.find((x) => x.element === c.element)!
      c.rim.visible = card.selected
      c.stripe.visible = orders && card.generates && n > 1
      c.label.set(texText(card.label.tex, card.label.plain, EM.cardLabel * (n > 6 ? 0.8 : 1), card.selected ? 0xffffff : palette.text))
      c.label.anchor.position.y = orders ? 0.026 : 0.004
      c.cycles.set(orders ? texText(card.cycleTex, card.cycleText, EM.cardCycle * (n > 6 ? 0.75 : 1), palette.textDim) : null)
      c.order.set(orders ? plainText(`order ${card.order}`, EM.cardOrder, card.generates && n > 1 ? ACCENT : palette.textDim) : null)
      c.pipMat.color.setHex(card.generates && n > 1 ? ACCENT : 0xc9d1e0)
      c.pips.forEach((pip, k) => (pip.visible = orders && k < card.order))
    }

    const apply = this.plates.find((p) => p.id === 'apply')!
    const opCard = desc.operation !== null ? desc.cards.find((c) => c.element === desc.operation)! : null
    apply.enabled = !!opCard && !desc.historyFull
    if (apply.rimMat) apply.rimMat.opacity = apply.enabled ? 0.6 : 0.12
    apply.label.set(plainText(desc.historyFull ? 'History full' : opCard ? `Apply ${opCard.label.plain}` : 'Apply', EM.plate, apply.enabled ? 0xffffff : palette.textDim))
    const reset = this.plates.find((p) => p.id === 'reset')!
    reset.enabled = desc.history.length > 0
    reset.label.set(plainText('Reset', EM.plate, reset.enabled ? palette.text : palette.textDim))
    const replay = this.plates.find((p) => p.id === 'replay')!
    replay.enabled = desc.history.length > 0
    replay.label.set(plainText('Replay', EM.plate, replay.enabled ? palette.text : palette.textDim))
  }

  private cardWidth(n: number): number {
    return n <= 4 ? 0.092 : n <= 6 ? 0.074 : 0.06
  }

  /** x of the row's left edge and the plates' x positions for n cards. */
  private rowLayout(n: number): { x0: number; w: number; applyX: number; smallX: number } {
    const w = this.cardWidth(n)
    const total = n * w + (n - 1) * CARDS.gap + CARDS.gap * 1.8 + CARDS.applyW + CARDS.gap + CARDS.smallW
    const x0 = -total / 2
    const applyX = x0 + n * w + (n - 1) * CARDS.gap + CARDS.gap * 1.8 + CARDS.applyW / 2
    return { x0, w, applyX, smallX: applyX + CARDS.applyW / 2 + CARDS.gap + CARDS.smallW / 2 }
  }

  private makePlate(id: PlateRec['id']): PlateRec {
    const base = new Group()
    base.rotation.x = CARDS.tilt
    const w = id === 'apply' ? CARDS.applyW : CARDS.smallW
    const h = id === 'apply' ? CARDS.h : (CARDS.h - CARDS.gap * 0.6) / 2
    const slabMat = this.smat(new MeshStandardMaterial({ color: PLATE, metalness: 0.15, roughness: 0.6 })) as MeshStandardMaterial
    base.add(new Mesh(this.sgeo(slabGeometry(w, h, 0.006)), slabMat))
    let rimMat: MeshBasicMaterial | null = null
    if (id === 'apply') {
      rimMat = this.smat(new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55 }))
      const rim = new Mesh(this.sgeo(outlineGeometry(w, h, Math.min(w, h) * 0.12, 0.0018)), rimMat)
      rim.position.z = 0.0005
      base.add(rim)
    }
    const label = this.text(`sc:plate:${id}`, base, false)
    label.anchor.position.z = FACE_Z
    const hit = new Mesh(this.sgeo(new PlaneGeometry(w + 0.012, h + 0.012)), this.smat(new MeshBasicMaterial()))
    hit.visible = false
    hit.userData.pickId = `plate:${id}`
    base.add(hit)
    this.root.add(base)
    return { id, pickId: `plate:${id}`, rimMat, base, slabMat, label, hit, enabled: false }
  }

  private rebuild(desc: SculptureDesc, key: string): void {
    this.disposeBuilt()
    this.anim = null
    const n = desc.order
    const f = this.frame
    const holder = new Group()
    holder.name = 'sculpture:group'
    const geos: BufferGeometry[] = []
    const mats: Material[] = []
    const texts: TextSlot[] = []
    const geo = <G extends BufferGeometry>(g: G) => (geos.push(g), g)
    const mat = <M extends Material>(m: M) => (mats.push(m), m)
    const text = (id: string, parent: Object3D) => {
      const s = new TextSlot(id)
      parent.add(s.anchor)
      texts.push(s)
      return s
    }

    // Beads with identity colour, silhouette, halo and label.
    const beadR = n > 6 ? RING.bead * 0.82 : RING.bead
    const haloGeo = geo(new PlaneGeometry(beadR * 4.4, beadR * 4.4))
    const beads: BeadRec[] = desc.beads.map((bd, i) => {
      const color = new Color(BEAD_COLORS[i % BEAD_COLORS.length]!)
      const bmat = mat(new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.42, metalness: 0.08, roughness: 0.32, flatShading: i % BEAD_SHAPES.length !== 0 && i % BEAD_SHAPES.length !== 3 && i % BEAD_SHAPES.length !== 5 && i % BEAD_SHAPES.length !== 7 }))
      const mesh = new Mesh(geo(beadGeometry(i, beadR)), bmat)
      mesh.name = `bead:${bd.element}`
      const haloMat = mat(new MeshBasicMaterial({ map: this.halo, color, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending }))
      const halo = new Mesh(haloGeo, haloMat)
      halo.renderOrder = 2
      const label = text(`sc:bead:${bd.element}`, holder)
      const lc = new Color(color).lerp(new Color(0xffffff), 0.35)
      label.set(texText(bd.label.tex, bd.label.plain, EM.beadLabel * (n > 6 ? 0.8 : 1), lc.getHex()))
      holder.add(mesh, halo)
      return { mesh, mat: bmat, halo, haloMat, label, color, pos: new Vector3(), wobble: i * 1.37 }
    })

    // Slot collars and engraved slot numbers.
    const collarGeo = geo(new RingGeometry(beadR * 1.42, beadR * 1.62, 48))
    const slots: SlotRec[] = desc.slots.map((sl) => {
      const base = new Color(BEAD_COLORS[sl.index % BEAD_COLORS.length]!)
      const m = mat(new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.95, depthWrite: false }))
      const collar = new Mesh(collarGeo, m)
      const th = (2 * Math.PI * sl.index) / n
      collar.position.set(Math.sin(th) * RING.radius, Math.cos(th) * RING.radius, -0.001)
      this.ring.add(collar)
      const number = text(`sc:slot:${sl.index}`, holder)
      number.set(plainText(String(sl.index), EM.slotNo, 0x8d97ab))
      vA.set(0, 0, 0)
      slotPosition(f, sl.index, n, vB)
      vA.copy(vB).sub(f.center).normalize()
      number.anchor.position.copy(vB).addScaledVector(vA, -0.047)
      return { collar, mat: m, base, glow: 1, number }
    })

    // Paths for every element and source slot (n <= 8: at most 64 tubes), from the derived cycles.
    const paths: PathRec[][] = desc.cards.map((card) => {
      const specs = pathSpecs(card.cycles, n)
      return specs.map((spec) => {
        const curve = new PathCurve(f, spec, n)
        const tube = spec.kind === 'stay' ? null : geo(new TubeGeometry(curve, TRAIL.segments, TRAIL.radius, 7, false))
        const arrowPos = new Vector3()
        const arrowQuat = new Quaternion()
        if (tube) {
          curve.getPointAt(0.8, arrowPos)
          const tan = curve.getTangentAt(0.8, new Vector3())
          arrowQuat.setFromUnitVectors(UP, tan.normalize())
        }
        return { curve, tube, arrowPos, arrowQuat }
      })
    })

    const trailSet = (): TrailSet => {
      const ms = beads.map(() => mat(trailMaterial()))
      const meshes = ms.map((m) => {
        const mesh = new Mesh(haloGeo, m)
        mesh.visible = false
        mesh.renderOrder = 3
        mesh.frustumCulled = false
        holder.add(mesh)
        return mesh
      })
      return { meshes, mats: ms, gains: ms.map(() => 1), step: -1, arrived: -1, live: false }
    }
    const trails: [TrailSet, TrailSet] = [trailSet(), trailSet()]
    const arrowGeo = geo(new ConeGeometry(0.0072, 0.02, 14))
    const pmats = beads.map(() => {
      const m = mat(trailMaterial())
      m.uniforms.cutStart!.value = 0.16
      m.uniforms.cutEnd!.value = 0.84
      return m
    })
    const preview = {
      mats: pmats,
      meshes: pmats.map((m) => {
        const mesh = new Mesh(haloGeo, m)
        mesh.visible = false
        mesh.renderOrder = 3
        mesh.frustumCulled = false
        holder.add(mesh)
        return mesh
      }),
      arrowMats: beads.map(() => mat(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }))),
      arrows: [] as Mesh[],
    }
    preview.arrows = preview.arrowMats.map((m) => {
      const a = new Mesh(arrowGeo, m)
      a.visible = false
      a.renderOrder = 3
      holder.add(a)
      return a
    })

    // Operation cards.
    const row = this.rowLayout(n)
    const w = row.w
    const slab = geo(slabGeometry(w, CARDS.h, 0.005))
    const rimGeo = geo(outlineGeometry(w, CARDS.h, Math.min(w, CARDS.h) * 0.12, 0.0026))
    const stripeGeo = geo(new PlaneGeometry(w * 0.56, 0.0032))
    const pipGeo = geo(new CircleGeometry(n > 6 ? 0.0032 : 0.0039, 18))
    const hitGeo = geo(new PlaneGeometry(w + CARDS.gap * 0.9, CARDS.h + 0.014))
    const hitMat = mat(new MeshBasicMaterial())
    const rimMat = mat(new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.95 }))
    const stripeMat = mat(new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9 }))
    const cards: CardRec[] = desc.cards.map((card, i) => {
      const base = new Group()
      base.position.set(row.x0 + w / 2 + i * (w + CARDS.gap), CARDS.y, CARDS.z)
      base.rotation.x = CARDS.tilt
      const lifted = new Group()
      base.add(lifted)
      const slabMat = mat(new MeshStandardMaterial({ color: CARD, metalness: 0.12, roughness: 0.62, emissive: 0x000000 }))
      lifted.add(new Mesh(slab, slabMat))
      const rim = new Mesh(rimGeo, rimMat)
      rim.position.z = 0.0006
      lifted.add(rim)
      const stripe = new Mesh(stripeGeo, stripeMat)
      stripe.position.set(0, CARDS.h / 2 - 0.0085, 0.0008)
      lifted.add(stripe)
      const pipMat = mat(new MeshBasicMaterial({ color: 0xc9d1e0 }))
      const spacing = Math.min(0.0115, (w - 0.018) / Math.max(1, n - 1))
      const pips = Array.from({ length: n }, (_, k) => {
        const pip = new Mesh(pipGeo, pipMat)
        pip.position.set((k - (card.order - 1) / 2) * spacing, -0.0455, 0.0008)
        pip.visible = false
        lifted.add(pip)
        return pip
      })
      const label = text(`sc:card:${card.element}:label`, lifted)
      // TeX glyphs sit 1 mm behind their anchor (tex.ts): keep every face text clear of the card surface.
      label.anchor.position.set(0, 0.026, FACE_Z)
      const cyc = text(`sc:card:${card.element}:cycles`, lifted)
      cyc.anchor.position.set(0, -0.007, FACE_Z)
      const order = text(`sc:card:${card.element}:order`, lifted)
      order.anchor.position.set(0, -0.0295, FACE_Z)
      const hit = new Mesh(hitGeo, hitMat)
      hit.visible = false
      hit.userData.pickId = `card:${card.element}`
      base.add(hit)
      holder.add(base)
      return { element: card.element, pickId: `card:${card.element}`, base, lifted, slabMat, rim, stripe, pips, pipMat, label, cycles: cyc, order, hit, lift: 0, flash: 0 }
    })

    // Plates beside the cards.
    for (const p of this.plates) {
      if (p.id === 'apply') p.base.position.set(row.applyX, CARDS.y, CARDS.z)
      else p.base.position.set(row.smallX, CARDS.y + (p.id === 'replay' ? 1 : -1) * (CARDS.h / 4 + CARDS.gap * 0.15), CARDS.z)
    }

    this.root.add(holder)
    this.built = { key, n, collarOuter: beadR * 1.62, cardW: w, holder, beads, slots, cards, paths, trails, preview, geos, mats, texts }
    this.applyPresentation()
    this.appearStart = -1
    this.shownMoment = -1
    this.previewOp = -2
    this.previewOpacity = 0
  }

  private disposeBuilt(): void {
    const b = this.built
    if (!b) return
    for (const s of b.slots) s.collar.removeFromParent()
    for (const t of b.texts) t.dispose()
    b.holder.removeFromParent()
    b.geos.forEach((g) => g.dispose())
    b.mats.forEach((m) => m.dispose())
    this.built = null
    this.pickables = this.presentation.inSceneControls ? this.plates.map((p) => p.hit) : []
  }

  private sgeo<G extends BufferGeometry>(g: G): G {
    this.statics.geos.push(g)
    return g
  }

  private smat<M extends Material>(m: M): M {
    this.statics.mats.push(m)
    return m
  }

  private text(id: string, parent: Object3D, billboard: boolean): TextSlot {
    const s = new TextSlot(id)
    parent.add(s.anchor)
    this.allTexts.push(s)
    if (billboard) this.billboards.push(s)
    return s
  }
}
