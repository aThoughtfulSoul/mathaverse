// Passthrough backing panel: in a passthrough session the room replaces the dark environment, and the scenes
// were designed against dark (light text, glowing beads, thin lines). One dark, translucent, soft-edged panel
// behind the workbench keeps them readable without boxing each object. It hangs on the workbench, so a grip
// move takes it along, and it is drawn first among transparent objects so everything else draws over it.

import { Color, Mesh, PlaneGeometry, ShaderMaterial, CanvasTexture, MeshBasicMaterial, SRGBColorSpace } from 'three'
import { palette } from './palette'

/** Bench-local extent: the scene box (x +-0.5, y -0.24..0.32), the controls panel (to y -0.45) and the voice
 * and assistant lines (y 0.45) with a margin; behind everything (scenes reach z -0.25). */
export const BACKDROP = { width: 1.34, height: 1.06, centerY: 0.02, z: -0.31, radius: 0.07, feather: 0.05, opacity: 0.84 } as const

/** The controls panel's own backing (it hangs in front of and below the main panel, tilted toward the user):
 * local to the controls group, behind both button rows and the status line. */
export const CONTROLS_BACKDROP = { width: 0.6, height: 0.2, centerY: 0.0, z: -0.006, radius: 0.03, feather: 0.018, opacity: 0.86 } as const

export function createBackdrop(spec: { width: number; height: number; centerY: number; z: number; radius: number; feather: number; opacity: number } = BACKDROP): Mesh {
  const { width, height, radius, feather, opacity } = spec
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      color: { value: new Color(palette.sky) },
      opacity: { value: opacity },
      halfSize: { value: [width / 2, height / 2] },
      radius: { value: radius },
      feather: { value: feather },
    },
    vertexShader: `varying vec2 vPos; void main(){ vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // Rounded-rectangle distance with a soft edge: no hard frame in the room.
    fragmentShader: `uniform vec3 color; uniform float opacity; uniform vec2 halfSize; uniform float radius; uniform float feather; varying vec2 vPos;
      void main(){
        vec2 q = abs(vPos) - (halfSize - vec2(radius));
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        float a = opacity * (1.0 - smoothstep(-feather, 0.0, d));
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  })
  const mesh = new Mesh(new PlaneGeometry(width, height), material)
  mesh.name = 'passthrough-backdrop'
  mesh.position.set(0, spec.centerY, spec.z)
  mesh.renderOrder = -10
  mesh.visible = false
  return mesh
}

/**
 * DEV stand-in for a room (desktop only): a bright, busy wall behind the workbench, to judge readability
 * against a light background before a headset check. It is not passthrough and never claimed as such.
 */
export function createRoomStandIn(): Mesh {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 512
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 512)
  grad.addColorStop(0, '#d9d4cb')
  grad.addColorStop(1, '#a89f92')
  g.fillStyle = grad
  g.fillRect(0, 0, 1024, 512)
  // A window, a shelf and a lamp: bright and dark shapes at the depths a room has.
  g.fillStyle = '#f4f6f8'
  g.fillRect(620, 60, 300, 220)
  g.fillStyle = '#6b5a48'
  g.fillRect(80, 300, 380, 26)
  g.fillStyle = '#3d4552'
  g.fillRect(120, 220, 60, 80)
  g.fillRect(220, 250, 40, 50)
  g.fillStyle = '#c8a46a'
  g.beginPath()
  g.arc(520, 140, 46, 0, Math.PI * 2)
  g.fill()
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const mesh = new Mesh(new PlaneGeometry(7, 4.4), new MeshBasicMaterial({ map: tex }))
  mesh.name = 'dev-room-stand-in'
  mesh.position.set(0, 0.9, -2.6)
  return mesh
}
