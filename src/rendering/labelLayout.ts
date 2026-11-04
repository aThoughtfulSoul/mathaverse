// Floating-label layout: selected relationship first (PQ-ARCHITECTURE-DECISIONS "Label policy").
//
// Presentation only: a decision moves where a label is drawn, or fades it; it never moves a point, a plane or
// a value, and never touches the document. Inputs are projected bounds in one shared screen frame at the
// viewing pose (tangent-plane units seen from the head). One decision serves both eyes: each label carries its
// horizontal stereo parallax, and two labels at different depths must also clear their relative parallax, so
// what is clear for the centre eye is clear in the left and right eye too. Labels are placed
// in priority order; each tries a small fixed set of stable offsets (its own resting offset, then eight
// directions next to the point, then the same eight further out with a short leader). A must-show label (the
// selected relationship) always gets a place, the least-overlapping one if nothing is clear; any other label
// that still overlaps is hidden. Hysteresis: a label keeps its previous place while that place stays clear
// allowing a small overlap, and a hidden label returns only when a place is clear with a margin, so tiny head
// movements neither flicker labels nor switch their sides. Work is bounded: O(labels x 17 x placed rects).

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface LayoutItem {
  id: string
  /** The labelled point in the shared screen frame. */
  x: number
  y: number
  /** Half extents of the label (same units). */
  hw: number
  hh: number
  /** Radius of the labelled point's dot (same units). */
  r: number
  /** Higher is placed first. */
  priority: number
  /** Never hidden (the selected output relationship, the selected sample's name). */
  mustShow: boolean
  /** Preferred screen direction; the eight directions are tried closest to it first. */
  prefer: [number, number]
  /** The label's own resting offset (label centre minus point), tried before the standard set. */
  legacy?: [number, number]
  /** Obstacles with this owner (the label's own point) do not block it. */
  owner?: string
  /** Half the horizontal shift between the two eyes' views of this label (IPD / 2 / depth). */
  par?: number
}

export interface Obstacle extends Rect {
  owner?: string
  par?: number
}

export interface Placement {
  /** Stable candidate name ('legacy', 'n:ne', 'f:w', ...). */
  key: string
  /** Label centre minus point, screen units. */
  dx: number
  dy: number
  shown: boolean
  /** A far place: draw a short leader to the point. */
  leader: boolean
}

export interface LayoutOptions {
  /** Clearance between a point's dot and its label. */
  gap: number
  /** Extra distance of the far ring (with a leader). */
  farGap: number
  /** Hysteresis margin: a new place must clear others by this; the previous place may overlap by this. */
  margin: number
}

const DIRS: [string, number, number][] = [['e', 1, 0], ['ne', 1, 1], ['n', 0, 1], ['nw', -1, 1], ['w', -1, 0], ['sw', -1, -1], ['s', 0, -1], ['se', 1, -1]]

interface Candidate {
  key: string
  dx: number
  dy: number
  leader: boolean
}

export function candidatesFor(it: LayoutItem, o: LayoutOptions): Candidate[] {
  const out: Candidate[] = []
  if (it.legacy) out.push({ key: 'legacy', dx: it.legacy[0], dy: it.legacy[1], leader: false })
  const [px, py] = it.prefer
  const pl = Math.hypot(px, py) || 1
  const score = ([, sx, sy]: [string, number, number]) => (sx * px + sy * py) / (pl * Math.hypot(sx, sy))
  // Sort is stable: equal scores keep the fixed direction order.
  const order = [...DIRS].sort((a, b) => score(b) - score(a))
  for (const far of [false, true]) {
    for (const [name, sx, sy] of order) {
      const g = far ? o.gap + o.farGap : o.gap
      const rr = sx && sy ? it.r * 0.71 : it.r
      out.push({ key: `${far ? 'f' : 'n'}:${name}`, dx: sx * (rr + g + it.hw), dy: sy * (rr + g + it.hh), leader: far })
    }
  }
  return out
}

/** Rectangles overlap; with `slack` > 0 they must also clear each other horizontally by that much (stereo). */
export function intersects(a: Rect, b: Rect, slack = 0): boolean {
  return a.x0 - slack < b.x1 && b.x0 - slack < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

function overlapArea(a: Rect, b: Rect, slack = 0): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + slack
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/** The label rectangle of `it` at candidate offset (dx, dy), grown by `grow` on every side. */
export function labelRect(it: LayoutItem, dx: number, dy: number, grow = 0): Rect {
  const cx = it.x + dx
  const cy = it.y + dy
  return { x0: cx - it.hw - grow, x1: cx + it.hw + grow, y0: cy - it.hh - grow, y1: cy + it.hh + grow }
}

export function layoutLabels(items: LayoutItem[], obstacles: Obstacle[], prev: Map<string, Placement> | null, o: LayoutOptions): Map<string, Placement> {
  const placed: Obstacle[] = [...obstacles]
  const out = new Map<string, Placement>()
  const sorted = [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const it of sorted) {
    const cands = candidatesFor(it, o)
    const par = it.par ?? 0
    const slack = (p: Obstacle) => Math.abs(par - (p.par ?? par))
    const blocking = (r: Rect) => placed.filter((p) => !(it.owner && p.owner === it.owner) && intersects(r, p, slack(p)))
    const clear = (c: Candidate, grow: number) => blocking(labelRect(it, c.dx, c.dy, grow)).length === 0
    const before = prev?.get(it.id)
    let choice: Candidate | null = null
    if (before?.shown) {
      const c = cands.find((x) => x.key === before.key)
      if (c && clear(c, -o.margin)) choice = c
    }
    if (!choice) choice = cands.find((c) => clear(c, o.margin)) ?? null
    if (!choice && it.mustShow) {
      // Nothing is clear: the least-overlapping place (ties keep the preference order).
      let best = Infinity
      for (const c of cands) {
        const r = labelRect(it, c.dx, c.dy)
        const area = blocking(r).reduce((s, p) => s + overlapArea(r, p, slack(p)), 0)
        if (area < best - 1e-12) {
          best = area
          choice = c
        }
      }
    }
    if (!choice) {
      // Hidden: fades where it was (or at its first place), keeping its point and selection target.
      const at = before ?? cands[0]!
      out.set(it.id, { key: before?.key ?? cands[0]!.key, dx: at.dx, dy: at.dy, shown: false, leader: false })
      continue
    }
    placed.push({ ...labelRect(it, choice.dx, choice.dy), owner: it.id, par })
    out.set(it.id, { key: choice.key, dx: choice.dx, dy: choice.dy, shown: true, leader: choice.leader })
  }
  return out
}
