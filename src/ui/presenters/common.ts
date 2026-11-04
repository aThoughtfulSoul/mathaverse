// Shared helpers of the six domain presenters (src/ui/model.ts Presenter; UI-REFINEMENT-SPEC sections 5, 6).
// Pure: no DOM, no clients, no scene objects. Everything here is phrasing and small structural helpers; the
// mathematics comes from the scene descriptions, the document and src/algebra.

import type { PlaybackState } from '../../rendering/adapter'
import type { ContextRun, ContextView, DetailSection, Label, PresenterInput, ScenePresentation, StatusView } from '../model'

/** A label: plain text for the DOM and spatial plain text, optional TeX for the mathematical text path. */
export const L = (plain: string, tex?: string): Label => (tex === undefined ? { plain } : { plain, tex })

const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋' }

/** Plain Unicode for a stored group label such as "C_{4}" (-> "C₄"); other TeX commands are dropped. */
export function unicodeLabel(tex: string): string {
  return tex
    .replace(/_\{([0-9+-]+)\}/g, (_, d: string) => [...d].map((c) => SUB[c] ?? c).join(''))
    .replace(/_([0-9])/g, (_, d: string) => SUB[d] ?? d)
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

/** Plain element labels with superscripts ("Rx^3" -> "Rx³", "V0^2" -> "V0²", "(Rz^2)^1" -> "(Rz²)¹"); the TeX form is unchanged. */
export const prettyPlain = (s: string): string => s.replace(/\^1(?!\d)/g, '¹').replace(/\^2/g, '²').replace(/\^3/g, '³')

/** Subtitle "Topic · variant" with the variant as mathematics. */
export function topicLabel(topic: string, variantPlain: string, variantTex: string): Label {
  return L(`${topic} · ${variantPlain}`, `\\textsf{${topic}}\\;\\cdot\\;${variantTex}`)
}

/** A run of validated workspace actions, or nothing when the list is empty. */
export const actionsRun = (actions: unknown[]): ContextRun => (actions.length ? { kind: 'actions', actions } : { kind: 'none' })

/** The shell provides the controls; formal annotations follow Show mathematics. */
export const scenePresentation = (input: PresenterInput): ScenePresentation => ({ inSceneControls: false, detailsOpen: input.detailsOpen })

export const EMPTY_CONTEXT: ContextView = { title: null, groups: [], hint: null }

/** Scene phase (spec section 6): animating / paused while a presentation runs; idle is ready or a result. */
export function phaseOf(pb: PlaybackState, hasResult: boolean): StatusView['phase'] {
  if (pb.active) return pb.playing ? 'animating' : 'paused'
  return hasResult ? 'result' : 'ready'
}

/** The status when the displayed scene is not in this build (or failed to derive): an error, kept visible. */
export function problemStatus(input: PresenterInput): StatusView | null {
  return input.sceneProblem ? { phase: 'ready', text: `Not available: ${input.sceneProblem}`, tone: 'error' } : null
}

/** "1 move" / "3 moves". */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
export const numberWord = (k: number): string => NUMBER_WORDS[k] ?? String(k)

/** A placeholder section for presenters that have nothing formal to add (never empty-looking). */
export function noteSection(title: string, text: string): DetailSection {
  return { title, provenance: 'presentation', items: [{ kind: 'text', text }] }
}

/** Matrix rows as exact text from display floats that are integers (cube rotations, signed permutations). */
export function intRows(m: readonly (readonly number[])[]): string[][] {
  return m.map((r) => r.map((v) => (Object.is(v, -0) ? '0' : String(v))))
}
