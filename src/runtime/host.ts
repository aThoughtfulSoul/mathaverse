// The runtime host (RUNTIME-ADAPTER R2): it owns the renderer, the scene, the desktop camera, the XR
// session and headset cameras, input and the ONE frame loop. Out of XR, renderer.setAnimationLoop runs
// on window rAF; in XR three switches the same loop onto the session's rAF. Nothing else schedules
// frames. Adapters receive a FrameContext from step() and never render.

import { profileStage } from './frameProfile'
import {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Vector3, Group, Mesh, SphereGeometry, ShaderMaterial, BackSide,
  CircleGeometry, MeshBasicMaterial, RingGeometry, HemisphereLight, DirectionalLight, SRGBColorSpace, type Object3D,
} from 'three'
import { palette } from '../ui/palette'
import { auditXRSession } from './schedulerAudit'

export interface FrameContext {
  /** Host clock, seconds (the rAF / XR frame timestamp). */
  time: number
  /** Seconds since the previous frame, clamped to 0.1. */
  dt: number
  frame: number
  presenting: boolean
  xrFrame: XRFrame | null
  /** Viewer (head) position in world space; the centre of the two eyes in XR. */
  head: Vector3
}

export type FrameHandler = (ctx: FrameContext) => void

/** A desktop content extent: tangents of the angles from the camera's axis (x right, y up). */
export interface StageContent {
  x0: number
  x1: number
  y0: number
  y1: number
}
/** Room around the measured content, and the closest the desktop framing zooms (half-height tangent). */
const STAGE_MARGIN = 1.1
const MIN_HALF_TAN = 0.12

export class Host {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  /** Everything the application adds goes under here; the environment stays separate. */
  readonly stage = new Group()
  private readonly handlers: FrameHandler[] = []
  private last = -1
  private frameCount = 0
  private readonly head = new Vector3()
  private readonly sessionListeners = new Set<(presenting: boolean) => void>()
  private workTimes: number[] = []
  private intervals: number[] = []
  private lastStamp = 0
  disposed = false

  constructor(container: HTMLElement) {
    // stencil: manim-web's semi-transparent strokes rely on it; three defaults to false (reader finding).
    this.renderer = new WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.xr.enabled = true
    this.renderer.xr.setReferenceSpaceType('local-floor')
    // No fixed foveation: Quest renders the periphery at lower resolution otherwise, and the side panels' small text sits
    // there (Meta: foveation artifacts show most in text-heavy scenes). Set for filming, 2026-11-03.
    this.renderer.xr.setFoveation(0)
    container.appendChild(this.renderer.domElement)

    this.camera = new PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.02, 60)
    this.camera.position.set(0, 1.2, 0.36)
    this.camera.lookAt(0, 0.99, -0.8)
    this.fitDesktopFov()
    // The dome covers every direction; clear to black (fast clear) instead of a background colour.
    this.renderer.setClearColor(0x000000, 1)
    this.environment = this.buildEnvironment()
    this.scene.add(this.environment, this.stage)
    this.scene.add(new HemisphereLight(0xdfe8ff, 0x1a1f2a, 1.4))
    const key = new DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, 2.4, 1.2)
    this.scene.add(key)

    window.addEventListener('resize', this.onResize)
    // The UI shell may resize the stage container (an inspector column, a narrow layout): follow it, without
    // moving the camera or the experiment.
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.onResize())
    this.resizeObserver?.observe(container)
    this.renderer.setAnimationLoop(this.loop)
  }

  onFrame(fn: FrameHandler): () => void {
    this.handlers.push(fn)
    return () => {
      const i = this.handlers.indexOf(fn)
      if (i >= 0) this.handlers.splice(i, 1)
    }
  }

  /** XR session visibility ('visible' vs 'visible-blurred' / 'hidden', e.g. the system menu is up). */
  onVisibility(fn: (visible: boolean) => void): () => void {
    this.visibilityListeners.add(fn)
    return () => this.visibilityListeners.delete(fn)
  }

  /** Test seam: deliver a visibility change exactly as the session's 'visibilitychange' would. */
  debugVisibility(visible: boolean): void {
    this.visibilityListeners.forEach((fn) => fn(visible))
  }

  private readonly visibilityListeners = new Set<(visible: boolean) => void>()

  onSession(fn: (presenting: boolean) => void): () => void {
    this.sessionListeners.add(fn)
    return () => this.sessionListeners.delete(fn)
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting
  }

  /** The dome and floor drawn around a VR session (hidden in passthrough, where the room is the backdrop). */
  private readonly environment: Object3D
  private readonly resizeObserver: ResizeObserver | null
  /** The running session's kind: 'vr' (the dark environment) or 'passthrough' (immersive-ar), else null. */
  sessionMode: 'vr' | 'passthrough' | null = null

  /** Whether this browser offers passthrough (the WebXR AR module's 'immersive-ar' sessions). */
  async passthroughSupported(): Promise<boolean> {
    return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar').catch(() => false))
  }

  /**
   * Enter an immersive session. 'passthrough' requests 'immersive-ar' (Meta: "Mixed Reality Support in Browser"):
   * the frame is cleared to transparent and the environment hidden, so the physical room shows behind the
   * content; both are restored when the session ends.
   */
  async enterXR(mode: 'vr' | 'passthrough' = 'vr'): Promise<void> {
    if (!navigator.xr) throw new Error('WebXR is not available in this browser')
    const sessionMode = mode === 'passthrough' ? 'immersive-ar' : 'immersive-vr'
    const ok = await navigator.xr.isSessionSupported(sessionMode)
    if (!ok) throw new Error(`${sessionMode} is not supported here`)
    // Must run inside a user-activation handler on Quest Browser (Enter VR click / controller press).
    const session = await navigator.xr.requestSession(sessionMode, { optionalFeatures: ['local-floor', 'bounded-floor', 'layers'] })
    auditXRSession(session as unknown as { requestAnimationFrame(cb: (t: number, f: unknown) => void): number })
    this.setPassthroughLook(mode === 'passthrough')
    this.sessionMode = mode
    try {
      await this.renderer.xr.setSession(session)
    } catch (err) {
      this.setPassthroughLook(false)
      this.sessionMode = null
      throw err
    }
    // Registered after three's own 'end' handler, so isPresenting is already false here.
    session.addEventListener('visibilitychange', () => {
      const visible = session.visibilityState === 'visible'
      this.visibilityListeners.forEach((fn) => fn(visible))
    })
    session.addEventListener('end', () => {
      this.setPassthroughLook(false)
      this.sessionMode = null
      this.onResize()
      this.sessionListeners.forEach((fn) => fn(false))
    })
    this.sessionListeners.forEach((fn) => fn(true))
  }

  /** Transparent clear and no environment (passthrough, or its desktop stand-in), or the normal opaque look. */
  setPassthroughLook(on: boolean): void {
    this.renderer.setClearColor(0x000000, on ? 0 : 1)
    this.environment.visible = !on
  }

  async exitXR(): Promise<void> {
    await this.renderer.xr.getSession()?.end()
  }

  /** Start a new perf() window (measurement scripts read windows in slices). */
  perfReset(): void {
    this.workTimes.length = 0
    this.intervals.length = 0
    this.lastStamp = 0
  }

  /** Frame work (CPU, start of callback to render submit) and rAF intervals, ms, over the last ~10 s (or since perfReset). */
  perf() {
    const p = (xs: number[], k: number) => {
      if (!xs.length) return null
      const s = [...xs].sort((a, b) => a - b)
      return +s[Math.min(s.length - 1, Math.floor(k * s.length))]!.toFixed(2)
    }
    const meanInterval = this.intervals.length ? this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length : 0
    return {
      frames: this.workTimes.length,
      workP50: p(this.workTimes, 0.5),
      workP95: p(this.workTimes, 0.95),
      workP99: p(this.workTimes, 0.99),
      intervalMean: +meanInterval.toFixed(2),
      intervalP99: p(this.intervals, 0.99),
      info: {
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        programs: this.renderer.info.programs?.length ?? 0,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      },
    }
  }

  dispose(): void {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.resizeObserver?.disconnect()
    this.renderer.dispose()
  }

  private readonly loop = (stamp: number, xrFrame?: XRFrame): void => {
    const t0 = performance.now()
    const time = stamp / 1000
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last))
    this.last = time
    if (this.lastStamp) this.pushBounded(this.intervals, stamp - this.lastStamp)
    this.lastStamp = stamp
    const presenting = this.renderer.xr.isPresenting
    // Head = the viewer pose of THIS frame (centre between the eyes). The ArrayCamera's own position
    // is the projection union, ~7 cm behind the eyes, and its matrices update inside render().
    const pose = presenting && xrFrame ? xrFrame.getViewerPose(this.renderer.xr.getReferenceSpace()!) : null
    if (pose) this.head.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z)
    else if (!presenting) this.camera.getWorldPosition(this.head)
    const ctx: FrameContext = { time, dt, frame: this.frameCount++, presenting, xrFrame: xrFrame ?? null, head: this.head }
    // A failing handler must not stop head-tracked rendering (SPEC S5): isolate, record, keep going.
    for (const h of this.handlers) {
      try {
        h(ctx)
      } catch (err) {
        this.recordError(err)
      }
    }
    const t1 = performance.now()
    this.renderer.render(this.scene, this.camera)
    const t2 = performance.now()
    profileStage('host.handlers', t1 - t0)
    profileStage('host.render', t2 - t1)
    profileStage('host.work', t2 - t0)
    this.pushBounded(this.workTimes, t2 - t0)
  }

  readonly errors: { count: number; last: string | null } = { count: 0, last: null }
  private readonly errorListeners = new Set<(msg: string) => void>()

  onError(fn: (msg: string) => void): () => void {
    this.errorListeners.add(fn)
    return () => this.errorListeners.delete(fn)
  }

  private recordError(err: unknown): void {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    this.errors.count++
    if (msg !== this.errors.last) {
      console.error('[host frame handler]', err)
      this.errorListeners.forEach((fn) => fn(msg))
    }
    this.errors.last = msg
  }

  private pushBounded(xs: number[], v: number): void {
    xs.push(v)
    if (xs.length > 900) xs.shift()
  }

  /** Desktop: CSS pixels of the canvas covered by page chrome (the question, the context bar). */
  private insets = { top: 0, right: 0, bottom: 0, left: 0 }
  /**
   * Desktop: the shown experiment's extent as tangents from the camera's axis (x right, y up), measured by the app.
   * Null: the fixed full-workbench framing (no refined UI).
   */
  private content: StageContent | null = null

  /**
   * Desktop framing around page chrome: the experiment is fitted to the canvas minus these insets and centred
   * there (a camera view offset, so picking stays exact). Ignored while presenting.
   */
  setStageInsets(i: { top: number; right: number; bottom: number; left: number }): void {
    const r = (v: number) => Math.max(0, Math.round(v))
    const next = { top: r(i.top), right: r(i.right), bottom: r(i.bottom), left: r(i.left) }
    const cur = this.insets
    if (next.top === cur.top && next.right === cur.right && next.bottom === cur.bottom && next.left === cur.left) return
    this.insets = next
    this.onResize()
  }

  /** Desktop framing: fit this content extent (null restores the fixed workbench framing). */
  setStageContent(c: StageContent | null): void {
    const cur = this.content
    if (c && cur && ['x0', 'x1', 'y0', 'y1'].every((k) => Math.abs(c[k as keyof StageContent] - cur[k as keyof StageContent]) < 1e-4)) return
    if (!c && !cur) return
    this.content = c ? { ...c } : null
    this.onResize()
  }

  private readonly onResize = (): void => {
    if (this.renderer.xr.isPresenting) return
    const el = this.renderer.domElement.parentElement!
    const W = el.clientWidth
    const H = el.clientHeight
    if (!W || !H) return
    const c = this.content
    if (!c) {
      this.camera.clearViewOffset()
      this.camera.aspect = W / H
      this.fitDesktopFov()
      this.renderer.setSize(W, H)
      return
    }
    // The free rectangle between the chrome. When the chrome leaves too little, grow it evenly into the chrome
    // (some overlap) rather than framing the whole canvas behind opaque panels.
    let { top, left } = this.insets
    let fw = W - left - this.insets.right
    let fh = H - top - this.insets.bottom
    const minW = Math.min(W, Math.max(240, W * 0.4))
    const minH = Math.min(H, Math.max(180, H * 0.3))
    if (fw < minW) {
      left = Math.max(0, Math.min(W - minW, left - (minW - fw) / 2))
      fw = minW
    }
    if (fh < minH) {
      top = Math.max(0, Math.min(H - minH, top - (minH - fh) / 2))
      fh = minH
    }
    // Fit the content's extent (with a margin) to the free rectangle and centre it there.
    const aspect = fw / fh
    const ty = ((c.y1 - c.y0) / 2) * STAGE_MARGIN
    const tx = ((c.x1 - c.x0) / 2) * STAGE_MARGIN
    const half = Math.max(ty, tx / aspect, MIN_HALF_TAN)
    const dy = ((c.y1 + c.y0) / 2 / (2 * half)) * fh
    const dx = ((c.x1 + c.x0) / 2 / (2 * half * aspect)) * fw
    this.camera.aspect = aspect
    this.camera.setViewOffset(fw, fh, -left + dx, -top - dy, W, H)
    this.camera.fov = (2 * Math.atan(half) * 180) / Math.PI
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(W, H)
  }

  /** Desktop framing without the refined UI: keep ~1.05 m of workbench width and ~0.85 m of height visible. */
  private fitDesktopFov(): void {
    const dist = 1.18
    const vNeeded = 2 * Math.atan(0.43 / dist)
    const vForWidth = 2 * Math.atan(Math.tan(Math.atan(0.64 / dist)) / this.camera.aspect)
    this.camera.fov = (Math.max(vNeeded, vForWidth) * 180) / Math.PI
    this.camera.updateProjectionMatrix()
  }

  private buildEnvironment(): Object3D {
    const env = new Group()
    env.name = 'environment'
    // A quiet gradient dome: lighter band at the horizon so the floor edge reads without a hard line.
    const dome = new Mesh(
      new SphereGeometry(30, 32, 16),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        uniforms: { top: { value: new Color(palette.sky) }, horizon: { value: new Color(palette.skyHorizon) } },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
          void main(){ float h = clamp(1.0 - abs(vDir.y) * 2.4, 0.0, 1.0); gl_FragColor = vec4(mix(top, horizon, h*h), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    )
    // Drawn after the scenery with depth test on, so covered fragments are rejected (Meta WebXR perf
    // guidance: a viewer-centred sky dome should render after foreground objects).
    dome.renderOrder = 10
    env.add(dome)
    // Floor disc with a soft falloff ring: grounds a seated user without a busy grid.
    const floor = new Mesh(new CircleGeometry(4, 64), new MeshBasicMaterial({ color: palette.floor }))
    floor.rotation.x = -Math.PI / 2
    env.add(floor)
    for (const [r, w] of [[1.2, 0.006], [2.4, 0.006]] as const) {
      const ring = new Mesh(new RingGeometry(r - w, r + w, 96), new MeshBasicMaterial({ color: palette.floorRing }))
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.001
      env.add(ring)
    }
    return env
  }
}
