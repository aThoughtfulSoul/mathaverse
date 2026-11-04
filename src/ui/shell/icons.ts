// Line icons for the shell (24-unit grid, round caps), used as inline SVG on the desktop and as Path2D strokes
// on the spatial canvas panels. Plain vector paths: no icon font, no asset loading.

import type { DemoKind } from '../../demo/order'

export const ICONS = {
  grid: 'M4.5 4.5h5.5v5.5H4.5z M14 4.5h5.5v5.5H14z M4.5 14h5.5v5.5H4.5z M14 14h5.5v5.5H14z',
  chevronDown: 'M7 10l5 5 5-5',
  chevronRight: 'M10 7l5 5-5 5',
  chevronLeft: 'M14 7l-5 5 5 5',
  chat: 'M4.5 7A2.5 2.5 0 0 1 7 4.5h10A2.5 2.5 0 0 1 19.5 7v6.5A2.5 2.5 0 0 1 17 16h-6.5L6 19.5V16H7a2.5 2.5 0 0 1-2.5-2.5z M9 10.3h.01 M12 10.3h.01 M15 10.3h.01',
  play: 'M8.5 5.8v12.4l9.6-6.2z',
  pause: 'M8.5 5.5v13 M15.5 5.5v13',
  replay: 'M4.6 12a7.4 7.4 0 1 0 2.2-5.3 M4.6 4.8v4.4H9',
  undo: 'M9 14.5L4.5 10 9 5.5 M4.5 10H14a5 5 0 0 1 0 10h-3',
  more: 'M5.5 12h.01 M12 12h.01 M18.5 12h.01',
  close: 'M6.5 6.5l11 11 M17.5 6.5l-11 11',
  check: 'M5.5 12.5l4.2 4.2L18.5 7.8',
  arrowRight: 'M5 12h13.5 M13 6.5l5.5 5.5-5.5 5.5',
  info: 'M12 3.8a8.2 8.2 0 1 0 0 16.4a8.2 8.2 0 1 0 0-16.4 M12 11v5 M12 7.9h.01',
  save: 'M5 4.5h11l3 3v12H5z M8.5 4.5v4.5h7V4.5 M8.5 19.5v-5.5h7v5.5',
  reopen: 'M3.5 7.5A2 2 0 0 1 5.5 5.5h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  exportFile: 'M12 14.5V4 M7.5 8.5L12 4l4.5 4.5 M5 14v5.5h14V14',
  importFile: 'M12 4v10.5 M7.5 10L12 14.5 16.5 10 M5 14v5.5h14V14',
  reset: 'M19.4 12a7.4 7.4 0 1 1-2.2-5.3 M19.4 4.8v4.4H15',
  layers: 'M12 4.5l8 4-8 4-8-4z M4 12.5l8 4 8-4 M4 16.5l8 4 8-4',
  headset: 'M3.5 9a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3.7L12 14.2 9.2 17H5.5a2 2 0 0 1-2-2z',
  room: 'M3.5 12s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  mic: 'M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z M6 11.5a6 6 0 0 0 12 0 M12 17.5V20',
  exit: 'M10 4.5H5.5v15H10 M14.5 8l4 4-4 4 M18.5 12H9.5',
  sparkle: 'M12 4l1.8 4.6L18.5 10.5 13.8 12.3 12 17l-1.8-4.7L5.5 10.5l4.7-1.9z',
} as const

export type IconName = keyof typeof ICONS

/** Small line drawings for the experiment picker cards (identity cues, not data). */
export const EXPERIMENT_ICONS: Record<DemoKind, string> = {
  pq: 'M5 7.5l7-3 7 3-7 3z M12 10.5v5 M9.6 13.2L12 15.6l2.4-2.4 M4.5 19.5h15',
  order: 'M4 12h3.5 M7.5 12l4-5.5h8 M7.5 12l4 5.5h8 M17 4l2.5 2.5L17 9 M17 15l2.5 2.5L17 20',
  sculpture: 'M12 5.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13 M13.7 5.5a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0 M20.2 12a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0 M13.7 18.5a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0 M7.2 12a1.7 1.7 0 1 1-3.4 0a1.7 1.7 0 1 1 3.4 0',
  cube: 'M12 3.8l7.5 4.2v8L12 20.2 4.5 16V8z M12 12l7.5-4 M12 12v8.2 M12 12L4.5 8',
  quotient: 'M4.5 6.5h5 M14.5 6.5h5 M4.5 12h5 M14.5 12h5 M4.5 17.5h5 M14.5 17.5h5 M12 4v16',
  braid: 'M6 3.5c0 5 6 3.5 6 8.5s6 3.5 6 8.5 M18 3.5c0 4-3 4.5-4.6 6.3 M10.6 14.2C9 16 6 16.5 6 20.5 M12 3.5c0 3 1 4 2 5',
  proof: 'M6 18.5l2.5-9 7-3.5 3 8-12.5 4.5 M8.5 9.5l-2.3 1.2 M15.5 6l-1.6 2 M18.5 14l-2.4.6 M6.8 17.2a1.3 1.3 0 1 0-1.6 2.6a1.3 1.3 0 1 0 1.6-2.6',
}

/** Inline SVG markup for a path (stroke follows currentColor). */
export function svg(path: string, size = 20, strokeWidth = 1.8, extraClass = ''): string {
  return `<svg class="mw-icon ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`
}

export function iconSvg(name: IconName, size = 20, strokeWidth = 1.8, extraClass = ''): string {
  // The dotted glyphs (more, chat dots) need a heavier stroke to read as dots.
  return svg(ICONS[name], size, name === 'more' ? 3 : strokeWidth, extraClass)
}
