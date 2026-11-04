// XR presence of Ask Meta Muse AI: the math glyph orb as ONE InstancedMesh of camera-facing quads (one draw
// call). Instance 0 is a soft dark backing (legible over passthrough, like the panels' plates), instance 1 the
// core glow, the other 120 the glyphs, sampled from a glyph atlas CanvasTexture. Every per-glyph term of the
// mock-up's projection (rotation, swirl, voice ripple, thinking wave, depth brightness) runs in the vertex
// shader from a few uniforms, so a frame only eases OrbMotion and writes numbers (no allocations).
//
// Blending is premultiplied (ONE, ONE_MINUS_SRC_ALPHA): the backing darkens (and covers passthrough), the glow
// and the glyphs add light with zero alpha, so their order does not matter and nothing needs sorting. Colours are
// the mock-up's sRGB values, linearised before three's output conversion. The material keeps its own depth
// settings (userData.ownDepth: depth-tested, never depth-writing) and draws after the panels and their content
// (XR_ORB_RENDER_ORDER): a nearer panel (an open popover) still hides it through its own depth. Sizes are bench
// metres at scale 1: the sphere is XR_ORB.radius (4.5 cm, 9 cm across in the idle look).
//
// Where it sits: ONE place, given by the shell (setPose: a position in its parent and a uniform scale of the whole
// orb; the spatial shell puts it centred below the stage, in the room the hidden context panel leaves, at 2.78 x:
// SPATIAL_LAYOUT.orb, 25 cm across idle). It never moves between places: the phases change only its look (idle, the
// listening ripple, transcribing, thinking, the applied bloom, error). The shader sizes every quad from the model-view
// matrix, so the root's scale grows the drawing and the (local) bounds alike: at the shell's scale the glyph sphere is
// XR_ORB.radius x 2 x scale across in the idle look (up to 1.2 x its look's radius with the listening ripple at full
// voice), BLOOM_START_RADIUS (1.4) times that at the bloom's start, and the soft core glow's quad reaches
// XR_ORB_EXTENT x scale from the centre (the glow fades to nothing at its edge). Shown again after being hidden (the
// shell steps it only while visible), it snaps to the current phase's look on its first step (or at once when
// setVisible is given the phase), never easing from a phase that ended while it was hidden.

import {
  AddEquation, Box3, CanvasTexture, CustomBlending, Group, InstancedBufferAttribute, InstancedMesh, LinearFilter,
  LinearMipmapLinearFilter, NoColorSpace, OneFactor, OneMinusSrcAlphaFactor, PlaneGeometry, ShaderMaterial, Sphere,
  Vector3,
} from 'three'
import { ORB_GLYPHS, ORB_GLYPH_FONT, glyphLayout } from './glyphs'
import { BLOOM_START_RADIUS, ORB_TILT, OrbMotion } from './motion'
import type { OrbPhase } from './state'

export const XR_ORB = {
  /** Sphere radius at rest (metres). */
  radius: 0.045,
  /** Glyph quad size (metres) before the depth scaling. */
  glyph: 0.0085,
  /** Soft dark backing radius (metres). */
  backing: 0.062,
} as const

/**
 * Largest distance of anything drawn from the orb's centre (metres, at scale 1): the core glow at the bloom's
 * start (7.9 cm). The pose's scale multiplies it (the geometry bounds are local, under the root's scale).
 */
export const XR_ORB_EXTENT = Math.max(XR_ORB.backing, XR_ORB.radius * BLOOM_START_RADIUS * 1.25)

/** The orb's place in its parent: the root's position (metres) and uniform scale (1: the XR_ORB size). */
export interface XrOrbPose {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly scale: number
}

/**
 * @deprecated The XR orb no longer glides: it has one place (setPose). Always 0; kept only because the orb
 * index (src/ui/orb/index.ts) still re-exports it.
 */
export const XR_ORB_GLIDE_S = 0

/**
 * Transparent draw order: after the shell panels (-5), the assistant content (backing 4, words 5) and text slots
 * (up to 7); before the controller rays and cursors (20).
 */
export const XR_ORB_RENDER_ORDER = 8

/** Names (the stage-content measurer and verification look for these). */
export const ORB_ROOT_NAME = 'shell:orb'
export const ORB_MESH_NAME = 'shell:orb:glyphs'

const COLS = 8
const CELL = 64
const KIND_GLYPH = 0
const KIND_BACKING = 1
const KIND_CORE = 2

type Canvas = HTMLCanvasElement
let canvasFactory: () => Canvas = () => document.createElement('canvas')
/** Test seam: node has no canvas. */
export function setOrbCanvasFactory(f: () => Canvas): void {
  canvasFactory = f
}

/** The glyph atlas: white glyphs on transparent cells (8 columns of 64 px; only alpha is sampled). */
function drawAtlas(): Canvas {
  const canvas = canvasFactory()
  canvas.width = COLS * CELL
  canvas.height = COLS * CELL
  const c = canvas.getContext('2d')
  if (c) {
    c.clearRect(0, 0, canvas.width, canvas.height)
    c.fillStyle = '#ffffff'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.font = `${Math.round(CELL * 0.64)}px ${ORB_GLYPH_FONT}`
    ORB_GLYPHS.forEach((g, i) => c.fillText(g, ((i % COLS) + 0.5) * CELL, (Math.floor(i / COLS) + 0.5) * CELL))
  }
  return canvas
}

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAngle;
uniform float uRadius;
uniform float uScale;
uniform float uLevel;
uniform float uRipple;
uniform float uSwirl;
uniform float uWave;
uniform float uBright;
uniform float uCore;
uniform float uGlyph;
uniform float uBacking;
uniform vec3 uTint;
attribute vec3 aBase;
attribute vec4 aInfo;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 corner = position.xy;
  vLocal = corner * 2.0;
  vKind = aInfo.w;
  vUv = vec2(0.0);
  vec4 c0 = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float unit = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 centre = c0.xyz;
  float size;
  if (aInfo.w < 0.5) {
    float ripple = 1.0 + uLevel * 0.2 * uRipple * (0.5 + 0.5 * sin(aInfo.y + uTime * 9.0));
    float a = uAngle + uSwirl * aInfo.z * 2.4 * sin(uTime * 2.0);
    float ca = cos(a);
    float sa = sin(a);
    float x = aBase.x * ca + aBase.z * sa;
    float z = -aBase.x * sa + aBase.z * ca;
    float y2 = aBase.y * cos(${ORB_TILT.toFixed(4)}) - z * sin(${ORB_TILT.toFixed(4)});
    float z2 = aBase.y * sin(${ORB_TILT.toFixed(4)}) + z * cos(${ORB_TILT.toFixed(4)});
    // The mock-up draws screen-down as +y2; here +y is up.
    vec3 off = (modelViewMatrix * vec4(vec3(x, -y2, z2) * (uScale * uRadius * ripple), 0.0)).xyz;
    centre += off;
    float depth = clamp(dot(normalize(off), normalize(-c0.xyz)) * 0.5 + 0.5, 0.0, 1.0);
    float wave = uWave * (0.5 + 0.5 * sin(aInfo.z * 6.0 - uTime * 6.0));
    vAlpha = min(1.0, (0.18 + 0.82 * depth) * (uBright + wave * 0.35));
    vColor = min(vec3(1.0), uTint + (70.0 * depth + 80.0 * wave) / 255.0);
    size = uGlyph * (0.75 + 0.35 * depth);
    float row = floor((aInfo.x + 0.5) / ${COLS.toFixed(1)});
    float col = aInfo.x - row * ${COLS.toFixed(1)};
    vUv = vec2((col + corner.x + 0.5) / ${COLS.toFixed(1)}, 1.0 - (row + 0.5 - corner.y) / ${COLS.toFixed(1)});
  } else if (aInfo.w < 1.5) {
    size = uBacking * 2.0;
    vColor = vec3(13.0, 17.0, 27.0) / 255.0;
    vAlpha = 0.8;
  } else {
    size = uScale * uRadius * 2.5;
    vColor = uTint;
    vAlpha = min(1.0, uCore + uLevel * 0.45);
  }
  gl_Position = projectionMatrix * vec4(centre + vec3(corner * size * unit, 0.0), 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
void main() {
  float r = length(vLocal);
  float a;
  float cover = 0.0;
  if (vKind < 0.5) {
    a = texture2D(uAtlas, vUv).a * vAlpha;
  } else if (vKind < 1.5) {
    a = vAlpha * (1.0 - smoothstep(0.45, 1.0, r));
    cover = a;
  } else {
    float g = r < 0.55 ? mix(1.0, 0.25, r / 0.55) : mix(0.25, 0.0, clamp((r - 0.55) / 0.45, 0.0, 1.0));
    a = vAlpha * g;
  }
  if (a < 0.003) discard;
  gl_FragColor = vec4(sRGBTransferEOTF(vec4(vColor * a, 1.0)).rgb, cover);
  #include <colorspace_fragment>
}
`

export class XrOrb {
  readonly root = new Group()
  readonly mesh: InstancedMesh
  readonly count: number
  private readonly geometry: PlaneGeometry
  private readonly material: ShaderMaterial
  private readonly texture: CanvasTexture
  private readonly motion = new OrbMotion()
  private readonly tint: Vector3
  private disposed = false
  /** Nothing shown yet, or shown again after being hidden: the next step snaps to its phase (OrbMotion.snap). */
  private snapPending = true

  constructor() {
    this.root.name = ORB_ROOT_NAME
    const pts = glyphLayout()
    const n = pts.length + 2
    this.count = n
    const base = new Float32Array(n * 3)
    const info = new Float32Array(n * 4)
    info[3] = KIND_BACKING
    info[7] = KIND_CORE
    pts.forEach((p, i) => {
      const k = i + 2
      base[k * 3] = p.x
      base[k * 3 + 1] = p.y
      base[k * 3 + 2] = p.z
      info[k * 4] = p.glyph
      info[k * 4 + 1] = p.phase
      info[k * 4 + 2] = p.lat
      info[k * 4 + 3] = KIND_GLYPH
    })
    this.geometry = new PlaneGeometry(1, 1)
    this.geometry.setAttribute('aBase', new InstancedBufferAttribute(base, 3))
    this.geometry.setAttribute('aInfo', new InstancedBufferAttribute(info, 4))
    // The true extent (the shader places every quad): for culling and any bounds measurement. Local: the pose's
    // scale on the root grows these bounds exactly as it grows the drawing (the shader's `unit` includes it).
    const ext = XR_ORB_EXTENT
    this.geometry.boundingBox = new Box3(new Vector3(-ext, -ext, -ext), new Vector3(ext, ext, ext))
    this.geometry.boundingSphere = new Sphere(new Vector3(), ext * Math.sqrt(3))

    this.texture = new CanvasTexture(drawAtlas())
    this.texture.colorSpace = NoColorSpace
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.magFilter = LinearFilter
    this.tint = new Vector3()
    const m = this.motion
    this.material = new ShaderMaterial({
      name: 'orb',
      uniforms: {
        uTime: { value: m.time }, uAngle: { value: m.angle }, uRadius: { value: m.radius }, uScale: { value: XR_ORB.radius },
        uLevel: { value: m.level }, uRipple: { value: m.ripple }, uSwirl: { value: m.swirl }, uWave: { value: m.wave },
        uBright: { value: m.bright }, uCore: { value: m.core }, uGlyph: { value: XR_ORB.glyph }, uBacking: { value: XR_ORB.backing },
        uTint: { value: this.tint }, uAtlas: { value: this.texture },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    })
    // The adapter's per-frame depth policy leaves it alone (src/rendering/manimAdapter.ts applyDepthPolicy).
    this.material.userData.ownDepth = true
    this.mesh = new InstancedMesh(this.geometry, this.material, n)
    this.mesh.name = ORB_MESH_NAME
    this.mesh.renderOrder = XR_ORB_RENDER_ORDER
    // Every quad is placed by the shader around the origin; its bounds are set above.
    this.mesh.frustumCulled = false
    this.root.add(this.mesh)
    this.writeUniforms()
  }

  get phase(): OrbPhase {
    return this.motion.phase
  }

  /** Its one place (its parent's coordinates): the root takes the pose at once and keeps it. */
  setPose(p: XrOrbPose): void {
    this.root.position.set(p.x, p.y, p.z)
    this.root.scale.setScalar(p.scale)
  }

  /**
   * Advance the animation (call from the frame loop while visible). `bloom` is OrbSource.bloom's identity (the
   * overshoot then starts only when it changes); the first step after the orb is shown snaps to `phase`.
   */
  step(dt: number, phase: OrbPhase, level: number, reduced = false, bloom?: string | null): void {
    if (this.disposed) return
    if (this.snapPending) {
      this.snapPending = false
      this.motion.snap(phase, bloom)
    }
    this.motion.step(dt, phase, level, reduced, bloom)
    this.writeUniforms()
  }

  /** Show or hide. From hidden to shown the look snaps to the current phase (at once when `phase` is given,
   * otherwise on the next step). */
  setVisible(v: boolean, phase?: OrbPhase, bloom?: string | null): void {
    if (v && !this.root.visible) this.snapPending = true
    this.root.visible = v
    if (!v || this.disposed) return
    if (this.snapPending && phase !== undefined) {
      this.snapPending = false
      this.motion.snap(phase, bloom)
      this.writeUniforms()
    }
  }

  get visible(): boolean {
    return this.root.visible
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
    this.mesh.dispose()
    this.root.removeFromParent()
  }

  private writeUniforms(): void {
    const m = this.motion
    const u = this.material.uniforms
    u.uTime!.value = m.time
    u.uAngle!.value = m.angle
    u.uRadius!.value = m.radius
    u.uLevel!.value = m.level
    u.uRipple!.value = m.ripple
    u.uSwirl!.value = m.swirl
    u.uWave!.value = m.wave
    u.uBright!.value = m.bright
    u.uCore!.value = m.core
    this.tint.set(m.tint[0] / 255, m.tint[1] / 255, m.tint[2] / 255)
  }
}
