// DEV harness for the UI shell (ui-harness.html): renders DesktopShell or SpatialShell from FIXTURE UiViews, with
// the real domain scene on the stage when that track's harness module exists (sculpture, cube, quotient,
// braid; the linear P/Q and order scenes are not mounted here), and the real assistant plug-in when
// src/ui/assistant/index.ts exists (a labelled stub otherwise). A tiny stand-in controller applies UI-only
// commands (popovers, inspector, experiment switch) to the fixture; every other command is only logged.
//
//   http://localhost:3010/ui-harness.html?fixture=sculpture                     desktop shell
//   http://localhost:3010/ui-harness.html?fixture=picker&surface=spatial         spatial shell (overview camera)
//   ...&surface=spatial&room=1          bright room stand-in behind (passthrough look; not real passthrough)
//   ...&surface=spatial&cam=wearer|toolbar|inspector|overview
//   ...&clean=1                         desktop clean-stage view (body.clean-stage; the FIXTURE badge stays)
//   window.__shell: { ready, fixture, view(), dispatched, show(name), pickAt(x, y), click(x, y), hover(x, y), hoverId(id), report() }

import '../../runtime/schedulerAudit'
import { Group, Raycaster, Vector2 } from 'three'
import { Host } from '../../runtime/host'
import type { HarnessModule } from '../../dev/harness'
import type { DomainScene } from '../../domains/scene'
import type { DemoKind } from '../../demo/order'
import type { DomPanelContent, SpatialPanelContent, SpatialPick, UiCommand, UiDispatch, UiView } from '../model'
import { createBackdrop, createRoomStandIn } from '../backdrop'
import { DesktopShell, SpatialShell } from './index'
import { FIXTURES, fixtureFor, withUi } from './fixtures'
import { createStubDomContent, createStubSpatialContent } from './stubAssistant'

type AssistantModule = {
  createAssistantDomContent(dispatch: UiDispatch): DomPanelContent
  createAssistantSpatialContent(dispatch: UiDispatch): SpatialPanelContent
}
const assistantModules = import.meta.glob<AssistantModule>('../assistant/index.ts')
const sceneModules = import.meta.glob<{ default: HarnessModule<unknown> }>('../../domains/*/harness.ts')

/** Which domain-harness fixture stands behind each shell fixture (illustrative only). */
const SCENES: Partial<Record<DemoKind, { domain: string; fixture: string }>> = {
  sculpture: { domain: 'sculpture', fixture: 'c4-selected' },
  cube: { domain: 'cube', fixture: 'rz_select0' },
  quotient: { domain: 'quotient', fixture: 'rzSelected' },
  braid: { domain: 'braid', fixture: 'relationSelected' },
}
const SCENE_OVERRIDES: Record<string, string> = { 'sculpture-math': 'c4-2', 'sculpture-playing': 'c4-1', 'more-xr': 'c4-2' }

const params = new URLSearchParams(location.search)
const fixtureName = params.get('fixture') ?? 'sculpture'
const surface = params.get('surface') === 'spatial' ? 'spatial' : 'desktop'
const badge = document.getElementById('fixture-badge')!
if (params.get('clean') === '1') document.body.classList.add('clean-stage')

async function main(): Promise<void> {
  const fx = FIXTURES[fixtureName]
  if (!fx) {
    badge.textContent = `No fixture "${fixtureName}". Available: ${Object.keys(FIXTURES).join(', ')}`
    return
  }
  let view: UiView = fx.view(surface === 'spatial' ? 'xr' : 'desktop')
  const dispatched: UiCommand[] = []
  const setBadge = (extra = '') => {
    badge.textContent = `FIXTURE · not app evidence · ${fixtureName}: ${fx.label}${surface === 'spatial' ? ' · spatial shell' : ''}${extra ? ` · ${extra}` : ''}`
  }
  setBadge()

  // The stand-in controller: UI state only.
  let rerender: () => void = () => undefined
  let showScene: (kind: DemoKind) => Promise<void> = async () => undefined
  const dispatch: UiDispatch = (cmd) => {
    dispatched.push(cmd)
    switch (cmd.kind) {
      case 'popover':
        view = withUi(view, { popover: cmd.which })
        break
      case 'inspector':
        view = withUi(view, { inspector: cmd.which === view.inspector ? null : cmd.which, popover: null })
        break
      case 'experiment':
        if (cmd.demo !== view.experiment.kind) {
          view = fixtureFor(cmd.demo, view)
          void showScene(cmd.demo)
        } else view = withUi(view, { popover: null })
        break
      default:
        setBadge(`last command (not executed): ${JSON.stringify(cmd)}`)
    }
    rerender()
  }

  const load = assistantModules['../assistant/index.ts']
  const mod = load ? await load().catch((e: unknown) => (console.warn('[ui-harness] assistant plug-in failed to load', e), null)) : null

  const app = document.getElementById('app')!
  let desktop: DesktopShell | null = null
  if (surface === 'desktop') {
    desktop = new DesktopShell({ root: document.getElementById('shell-root')!, stage: app, dispatch, assistant: mod ? mod.createAssistantDomContent(dispatch) : createStubDomContent() })
    // The coordinator makes the host follow its container; here a resize event does it.
    new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(app)
  }
  const host = new Host(app)
  const bench = new Group()
  bench.name = 'bench'
  bench.position.set(0, 1.02, -0.8)
  host.stage.add(bench)

  let spatial: SpatialShell | null = null
  if (surface === 'spatial') {
    spatial = new SpatialShell({ dispatch, assistant: mod ? mod.createAssistantSpatialContent(dispatch) : createStubSpatialContent() })
    spatial.mount(bench)
    spatial.setVisible(true)
    if (params.get('room') === '1') {
      host.setPassthroughLook(true)
      host.scene.add(createRoomStandIn())
      const back = createBackdrop()
      back.visible = true
      bench.add(back)
    }
    const cam = params.get('cam') ?? 'overview'
    const C = host.camera
    if (cam === 'wearer') {
      C.position.set(0, 1.22, 0)
      C.fov = 80
      C.lookAt(0.12, 0.98, -0.8)
    } else if (cam === 'toolbar') {
      C.position.set(0, 0.85, -0.15)
      C.fov = 42
      C.lookAt(0, 0.57, -0.65)
    } else if (cam === 'inspector') {
      C.position.set(0.3, 1.09, -0.17)
      C.fov = 56
      C.lookAt(0.745, 1.07, -0.72)
    } else {
      C.position.set(0.2, 1.16, 0.44)
      C.fov = 52
      C.lookAt(0.2, 0.99, -0.8)
    }
    C.updateProjectionMatrix()
    // Keep this headset-like framing: the host refits its desktop FOV (and a view offset) on resize.
    const fov = C.fov
    host.onFrame(() => {
      const el = host.renderer.domElement
      const aspect = el.clientWidth / Math.max(1, el.clientHeight)
      if (C.view?.enabled || C.fov !== fov || Math.abs(C.aspect - aspect) > 1e-6) {
        C.clearViewOffset()
        C.fov = fov
        C.aspect = aspect
        C.updateProjectionMatrix()
      }
    })
  }

  // The real domain scene behind the shell, when that track provides a harness module.
  let scene: DomainScene<unknown> | null = null
  showScene = async (kind: DemoKind) => {
    scene?.dispose()
    scene = null
    const m = SCENES[kind]
    const loader = m ? sceneModules[`../../domains/${m.domain}/harness.ts`] : undefined
    if (!m || !loader || params.get('scene') === '0') {
      setBadge(m ? '' : 'stage: the linear scenes are not mounted in this harness')
      return
    }
    try {
      const sm = (await loader()).default
      const s = sm.create()
      s.mount(bench)
      const name = kind === fx.kind ? SCENE_OVERRIDES[fixtureName] ?? m.fixture : m.fixture
      const make = sm.fixtures[name] ?? Object.values(sm.fixtures)[0]
      if (make) s.apply(make(), 'snap')
      s.setPresentation?.(view.presentation.scene)
      scene = s
    } catch (e) {
      console.warn('[ui-harness] scene failed', e)
      setBadge(`stage scene failed: ${String(e)}`)
    }
  }
  await showScene(view.experiment.kind)

  host.onFrame((ctx) => {
    scene?.step(ctx)
    spatial?.step(ctx)
  })

  // As in the app: the host frames the workbench in the part of the stage the shell does not cover.
  const frameStage = () => {
    if (desktop && 'setStageInsets' in host) (host as unknown as { setStageInsets(i: object): void }).setStageInsets(desktop.stageInsets())
  }
  rerender = () => {
    desktop?.render(view)
    spatial?.render(view)
    scene?.setPresentation?.(view.presentation.scene)
    frameStage()
  }
  window.addEventListener('resize', frameStage)
  rerender()

  // Spatial mouse: hover and press through the shell's pick (as a controller ray would).
  const ray = new Raycaster()
  const canvas = host.renderer.domElement
  const pickAt = (x: number, y: number): SpatialPick | null => {
    if (!spatial) return null
    const r = canvas.getBoundingClientRect()
    ray.setFromCamera(new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), host.camera)
    return spatial.pick(ray.ray)
  }
  if (spatial) {
    canvas.addEventListener('mousemove', (e) => spatial!.setHover(pickAt(e.clientX, e.clientY)?.id ?? null))
    canvas.addEventListener('click', (e) => spatial!.activate(pickAt(e.clientX, e.clientY)))
  }

  let frames = 0
  host.onFrame(() => void frames++)
  const w = window as unknown as { __shell: Record<string, unknown> }
  w.__shell = {
    get ready() {
      return frames > 20
    },
    fixture: fixtureName,
    view: () => view,
    dispatched,
    desktop,
    spatial,
    host,
    show: (name: string) => {
      const next = FIXTURES[name]
      if (!next) return false
      view = next.view(surface === 'spatial' ? 'xr' : 'desktop')
      void showScene(view.experiment.kind)
      rerender()
      return true
    },
    pickAt,
    click: (x: number, y: number) => {
      const p = pickAt(x, y)
      spatial?.activate(p)
      return p
    },
    hover: (x: number, y: number) => {
      const p = pickAt(x, y)
      spatial?.setHover(p?.id ?? null)
      return p
    },
    hoverId: (id: string | null) => spatial?.setHover(id),
    report: () => spatial?.report() ?? null,
  }
}

void main().catch((e: unknown) => {
  badge.textContent = `harness error: ${String(e)}`
  console.error(e)
})
