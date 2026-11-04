// Shell logic shared by the desktop (DOM) and spatial (WebXR) renderers: which UiCommand a press emits, what a
// surface shows in More, how text wraps and how long detail content is paged. Pure functions, no DOM, no
// three.js, so the behaviour is testable in node (tests/ui/shell). A renderer never mutates state: it emits
// these commands through the UiDispatch it was given, and a disabled entry emits nothing on any input route.

import type {
  ContextItem, DetailItem, MoreItem, MoreView, ToolbarId, ToolbarItem, UiCommand, UiView,
} from '../model'
import { ASSISTANT_NAME } from '../model'
import type { DemoKind } from '../../demo/order'

// ------------------------------------------------------------------ toolbar

/** Stable toolbar rows (spec section 4): Experiments and Ask Meta Muse AI stay together on the first row. */
export const TOOLBAR_ROWS: readonly (readonly ToolbarId[])[] = [['experiments', 'assistant'], ['play', 'replay', 'undo', 'more']]

/** The command a toolbar press emits; null when the item is disabled (mouse, keyboard and controller alike). */
export function toolbarCommand(view: Pick<UiView, 'popover'>, item: ToolbarItem): UiCommand | null {
  if (!item.enabled) return null
  switch (item.id) {
    case 'experiments':
      return { kind: 'popover', which: view.popover === 'experiments' ? null : 'experiments' }
    case 'more':
      return { kind: 'popover', which: view.popover === 'more' ? null : 'more' }
    case 'assistant':
      // Toggles: the controller closes the inspector when it already shows the assistant.
      return { kind: 'inspector', which: 'assistant' }
    case 'play':
      return { kind: 'playPause' }
    case 'replay':
      return { kind: 'replay' }
    case 'undo':
      return { kind: 'undo' }
  }
}

/** Accessible name of a toolbar entry: the assistant entry is exactly "Ask Meta Muse AI". */
export function toolbarName(item: ToolbarItem): string {
  if (item.id === 'assistant') return ASSISTANT_NAME
  return item.ariaLabel || item.label
}

/** Description of a toolbar entry (the Undo entry always says what it undoes). */
export function toolbarDescription(item: ToolbarItem): string | null {
  if (!item.enabled && item.reason) return item.reason
  if (item.id === 'undo' && item.label !== 'Cancel drag') return 'Undo last workspace change'
  return null
}

/** The longest label a toolbar entry can show, so its width never changes with state (stable rows). */
export function toolbarWidestLabel(item: ToolbarItem): string {
  if (item.id === 'play') return longest([item.label, 'Play', 'Pause'])
  if (item.id === 'undo') return longest([item.label, 'Undo', 'Cancel drag'])
  return item.label
}

function longest(xs: string[]): string {
  return xs.reduce((a, b) => (b.length > a.length ? b : a), '')
}

// ------------------------------------------------------------------ popovers, picker, inspector

/** The commands for choosing an experiment card. Choosing the active one just closes the picker. */
export function pickerCommands(view: Pick<UiView, 'experiment'>, kind: DemoKind): UiCommand[] {
  if (kind === view.experiment.kind) return [{ kind: 'popover', which: null }]
  return [{ kind: 'experiment', demo: kind }, { kind: 'popover', which: null }]
}

export const CLOSE_POPOVER: UiCommand = { kind: 'popover', which: null }
export const CLOSE_INSPECTOR: UiCommand = { kind: 'inspector', which: null }
export const TOGGLE_MATH: UiCommand = { kind: 'inspector', which: 'math' }

/** "Show mathematics" / "Hide mathematics" (the disclosure's label follows the open inspector). */
export function mathToggleLabel(view: Pick<UiView, 'inspector'>): string {
  return view.inspector === 'math' ? 'Hide mathematics' : 'Show mathematics'
}

/** The inspector frame's title and its close control's accessible name. */
export function inspectorFrame(which: 'assistant' | 'math'): { title: string; close: string } {
  return which === 'assistant' ? { title: ASSISTANT_NAME, close: `Close ${ASSISTANT_NAME}` } : { title: 'Mathematics', close: 'Hide mathematics' }
}

// ------------------------------------------------------------------ desktop layout

/** The side inspector's width, clamp(340px, 26vw, 420px) (styles.ts builds its CSS from these numbers). */
export const INSPECTOR_WIDTH = { min: 340, vw: 26, max: 420 } as const

export function inspectorWidth(viewportWidth: number): number {
  return Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, (viewportWidth * INSPECTOR_WIDTH.vw) / 100))
}

/**
 * The desktop shell stacks in a narrow window (under 900 px), or when an open side inspector would leave the
 * stage column under 640 px. Between those, the inspector stays a side column so the assistant panel keeps its
 * whole height; the stage is framed in what the overlays leave free.
 */
export function isStacked(width: number, inspectorOpen: boolean): boolean {
  return width < 900 || (inspectorOpen && width - inspectorWidth(width) < 640)
}

/** Stacked layout: what an open drawer keeps (title, suggestions or detail, and the question field), px. */
export const DRAWER_MIN = 240

/**
 * Stacked layout: the stage row's minimum height (px). The stage keeps 40 % of the window, less only so the
 * question, actions and toolbar (`chrome`, px) and an open drawer's working minimum (DRAWER_MIN, never past
 * 45 % of the window) still fit; never under 150 px. The drawer takes what is left (up to 30vh) and scrolls.
 */
export function stackedStageMin(height: number, chrome: number, drawerOpen: boolean): number {
  const drawer = drawerOpen ? Math.min(DRAWER_MIN, 0.45 * height) : 0
  return Math.round(Math.max(150, Math.min(0.4 * height, height - chrome - drawer)))
}

// ------------------------------------------------------------------ context, detail and More entries

export function contextCommand(item: Pick<ContextItem, 'id' | 'enabled'>): UiCommand | null {
  return item.enabled ? { kind: 'context', id: item.id } : null
}

export function detailActionCommand(item: Extract<DetailItem, { kind: 'action' }>): UiCommand | null {
  return item.enabled ? { kind: 'context', id: item.id } : null
}

export function moreCommand(item: MoreItem): UiCommand | null {
  return item.enabled ? { kind: 'more', id: item.id } : null
}

/** Save the bound recipe with the operations that are switched on (desktop representation editor). */
export function representationCommand(ops: readonly { kind: string; on: boolean }[]): UiCommand | null {
  const operations = ops.filter((o) => o.on).map((o) => o.kind)
  return operations.length ? { kind: 'saveRepresentation', operations } : null
}

/** File operations and session entry exist only on the desktop page (spec section 8; XR has no file dialog). */
const DESKTOP_ONLY = new Set<string>(['export', 'import', 'enterVR', 'enterPassthrough'])

/** More's sections for a surface. XR drops desktop-only entries (and the editor-opening representation entry);
 * empty sections disappear. */
export function moreSections(more: MoreView, surface: 'desktop' | 'xr'): MoreView['sections'] {
  return more.sections
    .map((s) => ({ ...s, items: s.items.filter((it) => (surface === 'xr' ? !DESKTOP_ONLY.has(it.id) && it.id !== 'saveRepresentation' : true)) }))
    .filter((s) => s.items.length > 0)
}

/** Choice cards with short labels ("0", "1", "σ₁") get the large numeral style. */
export function isShortChoice(label: string): boolean {
  return [...label].length <= 3
}

// ------------------------------------------------------------------ keyboard

export interface KeyTarget {
  tagName?: string
  type?: string
  isContentEditable?: boolean
  role?: string | null
}

/** Keys a focused shell element consumes itself, so they must not also reach window shortcuts:
 * every key in an editable field, and Space/Enter on a button-like control. */
export function shellConsumesKey(key: string, target: KeyTarget | null): boolean {
  if (!target) return false
  const tag = (target.tagName ?? '').toUpperCase()
  const type = (target.type ?? '').toLowerCase()
  const editable =
    target.isContentEditable === true || tag === 'TEXTAREA' || tag === 'SELECT' ||
    (tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type))
  if (editable) return true
  const buttonLike = tag === 'BUTTON' || tag === 'SUMMARY' || (tag === 'INPUT' && type !== '') || target.role === 'button' || target.role === 'checkbox' || target.role === 'switch'
  return buttonLike && (key === ' ' || key === 'Enter' || key === 'Spacebar')
}

// ------------------------------------------------------------------ text and paging (spatial canvas layout)

/** Greedy word wrap with a width function; a word longer than the line keeps its own line (never cut). */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) {
      out.push('')
      continue
    }
    let line = words[0]!
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!
      const next = `${line} ${w}`
      if (measure(next) <= maxWidth) line = next
      else {
        out.push(line)
        line = w
      }
    }
    out.push(line)
  }
  return out
}

/** Split blocks of given heights into pages no taller than maxHeight. A block that starts a section (`keepWithNext`)
 * stays with the block after it: when the two together are taller than a page, they share a page anyway (it scrolls),
 * so a heading never sits alone. A single block taller than a page gets its own page (never cut; it scrolls). */
export function paginate(blocks: readonly { height: number; keepWithNext?: boolean }[], maxHeight: number): number[][] {
  const pages: number[][] = []
  let page: number[] = []
  let used = 0
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!
    let h = b.height
    if (b.keepWithNext && i + 1 < blocks.length) h += blocks[i + 1]!.height
    if (page.length && used + h > maxHeight) {
      pages.push(page)
      page = []
      used = 0
    }
    page.push(i)
    used += b.height
    if (b.keepWithNext && i + 1 < blocks.length && used + blocks[i + 1]!.height > maxHeight) {
      page.push(++i) // the heading's first item, too tall to follow it on this page: kept with it (the page scrolls)
      used += blocks[i]!.height
    }
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}

// ------------------------------------------------------------------ hit regions (spatial panels)

export interface HitRegion {
  id: string
  /** Panel-local metres from the top-left corner, y down. */
  x: number
  y: number
  w: number
  h: number
  /** Corner radius used by the hover highlight. */
  r: number
  enabled: boolean
  /** The command a press emits (null: hover only, or disabled). */
  command: UiCommand | null
  hint?: string
}

export function hitAt(regions: readonly HitRegion[], x: number, y: number): HitRegion | null {
  // Later regions are drawn on top (badges over cards): search from the end.
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r
  }
  return null
}

/** The SpatialPick a region yields: disabled regions are hover-only and say why. */
export function regionPick(r: HitRegion, distance: number): { id: string; distance: number; command: UiCommand | null; hint?: string } {
  if (!r.enabled) return { id: r.id, distance, command: null, hint: r.hint ?? 'Not available right now' }
  return r.hint ? { id: r.id, distance, command: r.command, hint: r.hint } : { id: r.id, distance, command: r.command }
}
