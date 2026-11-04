// DEV harness for one demonstration scene in isolation (FOUR-DEMOS build): harness.html?domain=<name>&fixture=<f>.
// It mounts the scene under a workbench placed as in the app, steps it from the real host frame loop and
// picks it with the mouse, so a track can render, capture and interact with its scene before integration.
// Each track provides src/domains/<name>/harness.ts with a default export of HarnessModule. Scripted use:
//   window.__harness.show('c4')            apply a fixture (animated from the previous one)
//   window.__harness.apply(desc, 'snap')   apply any description
//   window.__harness.playback('replay')    drive the scene's playback
//   window.__harness.pickAt(x, y)          pick at canvas pixel coordinates (returns the ScenePick)
//   window.__harness.report()              the scene's report
import '../runtime/schedulerAudit'
import { Group, Raycaster, Vector2 } from 'three'
import { Host } from '../runtime/host'
import type { DomainScene, ScenePick, SceneTransition } from '../domains/scene'
import type { PlaybackCommand } from '../rendering/adapter'

export interface HarnessModule<D> {
  title: string
  create(): DomainScene<D>
  /** Named descriptions built from exact inputs (the first is shown by default). */
  fixtures: Record<string, () => D>
  /** Optional: what the harness shows after a press (simulating the planner for that track). */
  onPick?(pick: ScenePick, current: D): D | null
}

const modules = import.meta.glob<{ default: HarnessModule<unknown> }>('../domains/*/harness.ts')
const params = new URLSearchParams(location.search)
const domain = params.get('domain') ?? ''
const info = document.getElementById('info')!

async function main(): Promise<void> {
  const key = `../domains/${domain}/harness.ts`
  const load = modules[key]
  if (!load) {
    info.textContent = `no harness for "${domain}". Available: ${Object.keys(modules).map((k) => k.split('/')[2]).join(', ') || 'none yet'}`
    return
  }
  const mod = (await load()).default
  const host = new Host(document.getElementById('app')!)
  const bench = new Group()
  bench.name = 'bench'
  bench.position.set(0, 1.02, -0.8)
  host.stage.add(bench)
  const scene = mod.create()
  scene.mount(bench)
  const names = Object.keys(mod.fixtures)
  let current: unknown = null
  const apply = (desc: unknown, t: SceneTransition) => {
    current = desc
    scene.apply(desc, t)
  }
  const first = params.get('fixture') ?? names[0]
  if (first && mod.fixtures[first]) apply(mod.fixtures[first]!(), 'snap')
  host.onFrame((ctx) => scene.step(ctx))

  const ray = new Raycaster()
  const canvas = host.renderer.domElement
  const pickAt = (x: number, y: number): ScenePick | null => {
    const r = canvas.getBoundingClientRect()
    ray.setFromCamera(new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), host.camera)
    return scene.pick(ray.ray)
  }
  canvas.addEventListener('mousemove', (e) => scene.setHover(pickAt(e.clientX, e.clientY)?.id ?? null))
  canvas.addEventListener('click', (e) => {
    const p = pickAt(e.clientX, e.clientY)
    w.lastPick = p
    info.textContent = `${mod.title} · ${p ? `${p.id}${p.hint ? ` (${p.hint})` : ''} -> ${JSON.stringify(p.actions)}` : 'nothing picked'}`
    if (p?.presentation) scene.setPlayback(p.presentation)
    else if (p && mod.onPick && current) {
      const next = mod.onPick(p, current)
      if (next) apply(next, 'animate')
    }
  })
  const w = {
    scene,
    host,
    fixtures: names,
    lastPick: null as ScenePick | null,
    show: (name: string, t: SceneTransition = 'animate') => apply(mod.fixtures[name]!(), t),
    apply,
    current: () => current,
    playback: (cmd: PlaybackCommand) => scene.setPlayback(cmd),
    pickAt,
    report: () => scene.report(),
    status: () => scene.status(),
  }
  ;(window as unknown as { __harness: typeof w }).__harness = w
  info.textContent = `${mod.title} · fixtures: ${names.join(', ')}`
}

void main().catch((e) => {
  info.textContent = `harness error: ${String(e)}`
  console.error(e)
})
