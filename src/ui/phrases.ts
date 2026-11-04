// The closed set of scene phrases that change during interaction (captions, status line, button labels).
// Each phrase is one prebuilt glyph token, so drags and playback changes never typeset with MathJax
// (review C1). Variable parts (sample names, counts, axis letters) are separate tokens.

export const PHRASE = {
  drag: '\\textsf{Drag}',
  alongFiber: '\\textsf{along its fiber: the input changes,}',
  stays: '\\textsf{stays}',
  freely: '\\textsf{freely:}',
  changesUnless: '\\textsf{changes unless you move only along}',
  freelyOnly: '\\textsf{freely}',
  previewSliding: '\\textsf{Preview: sliding}',
  previewAlong: '\\textsf{along its fiber. Release commits;}',
  previewMoving: '\\textsf{Preview: moving}',
  previewMovingEnd: '\\textsf{. Release commits;}',
  bCancels: '\\textsf{B cancels}',
  escCancels: '\\textsf{Esc cancels}',
  lostDrag: '\\textsf{Controller tracking lost: the preview is frozen. Releasing now cancels.}',
  lostBench: '\\textsf{Controller tracking lost: the workbench holds still.}',
  bench: '\\textsf{Moving the workbench: presentation only; the mathematics is unchanged}',
  select: '\\textsf{Select a point}',
  previewCommit: '\\textsf{preview: release to commit}',
  previewColon: '\\textsf{preview:}',
  share: '\\textsf{samples share this exact output}',
  noOther: '\\textsf{no other sample shares this output}',
  // Operation-order comparison (step lines, verdict, step indicator, status line).
  first: '\\textsf{first}',
  then: '\\textsf{then}',
  fixed: '\\textsf{(fixed)}',
  noMaps: '\\textsf{(no maps: the identity)}',
  routesDiffer: '\\textsf{the routes differ}',
  sameMap: '\\textsf{both routes give the same map}',
  agreeHereBut: '\\textsf{the same here, but}',
  step: '\\textsf{Step}',
  of: '\\textsf{of}',
  left: '\\textsf{left}',
  right: '\\textsf{right}',
  inputStep: '\\textsf{Input: both routes start from the same samples}',
  identityRoute: '\\textsf{identity}',
  leftVs: '\\textsf{(left) vs}',
  rightColon: '\\textsf{(right):}',
  compareHint: '\\textsf{select a point, or drag the selected one}',
} as const

export const BUTTON_LABELS = ['Play', 'Pause', 'Replay', 'Mode: fiber', 'Mode: free', 'Undo', 'Cancel'] as const

export function buttonTex(label: string): string {
  return `\\textsf{${label}}`
}

/** Plain-text form of a phrase or name token. */
export function plainOf(tex: string): string {
  return tex.replace(/\\textsf\{([^}]*)\}/g, '$1').replace(/_\{(.*?)\}/g, '$1').replace(/\\/g, '')
}

/** Counts a caption can need (every exact output group size among 27 samples). */
export const COUNTS = Array.from({ length: 26 }, (_, i) => String(i + 2))

export function phraseTokenSet(): string[] {
  return [...Object.values(PHRASE), ...BUTTON_LABELS.map(buttonTex), ...COUNTS]
}
