// SYNTHETIC fixtures for the proof lesson (PROOF-EXPLORER-SPEC section 6, "Muse's role and supported
// conversation"). They are prepared, clearly labelled examples, NOT Muse output: the route sends them with
// source "synthetic" and model "synthetic:<name>" through the same parseProposal + planTransaction validation
// as live output. Actions come from the server templates in walk.ts (the same lists the live prompt offers);
// every explanation is composed from the exact derivation of the PLANNED document (src/algebra/walk.ts on the
// walk after the proposed actions), never from a table of numbers here, and fits 700 characters by dropping
// whole trailing sentences. Wording rules: the proof and the lemma belong to the source; the prepared signs
// are application data; bounds are bounds, never measured distances; "this point" is the persisted selection.
// Notation follows the lesson: W₃, U₅, S₅ with subscript digits, and arrows by the names the scene labels them
// with (a₁ … −c₂ on the hero's arrows, else their IDs). The regexes tolerate spoken transcripts: "W3" /
// "W 3" / "w three", "c1" / "minus a two", missing punctuation, "the arrows" / "these arrows", a leading
// "okay," / "can you".

import type { ActionJson, Proposal } from '../../src/workspace/actions'
import { type Doc, type VectorWalkExperiment, walkInputOf } from '../../src/workspace/document'
import { planTransaction } from '../../src/workspace/reducer'
import { type WalkFacts, type WalkItem, type PrefixWitness, vtext } from '../../src/algebra/walk'
import { format, mul } from '../../src/model/rational'
import { arrowNames, caseOf } from '../../src/lessons/steinitz/cases'
import { LESSON_SOURCE } from '../../src/lessons/steinitz/source'
import { WHY_LEAD } from '../../src/lessons/steinitz/copy'
import { comparisonText, decimalText, lengthText } from '../../src/workspace/context'
import type { Prepared } from './order'
import {
  allPositiveTemplate, checkTemplate, counterexampleTemplate, displayedWalk, explainFailureTemplate, flipSignTemplate, lessonTarget, openLessonTemplate,
  otherHalfTemplate, preparedSignsTemplate, restoreClosedTemplate, selectedWalkItem, simplerExampleTemplate, sourceWalkTemplate, stageTemplate,
  walkFactsOf, whyRepresentativeTemplate, whyThisPointTemplate,
} from './walk'
import { prepared } from './order'

interface WalkFixture {
  name: string
  example: string
  matches: RegExp
  build(doc: Doc, prompt?: string): Proposal
}

type Part = string | null | false | undefined

const LIMIT = 700

/** Whole parts up to the explanation limit: a part that does not fit ends the explanation (never cut). */
function fit(parts: Part[], limit = LIMIT): string {
  let out = ''
  for (const p of parts) {
    if (typeof p !== 'string' || !p) continue
    const next = out ? `${out} ${p}` : p
    if (next.length > limit) break
    out = next
  }
  return out
}

const answer = (title: string, parts: Part[]): Proposal => ({ proposalVersion: 1, title, explanation: fit(parts), actions: [] })
const OPEN_IT = '"Show me a step from an AI-produced proof" opens it.'
const notShown = (title: string) => answer(title, ['Not available: the proof lesson is not displayed, so this names nothing here.', OPEN_IT])

interface Planned {
  doc: Doc
  e: VectorWalkExperiment
  f: WalkFacts
  item: WalkItem | null
  /** Arrow display names of the planned walk (as its scene labels them). */
  names: Map<string, string>
}

/** The displayed walk of the document after `actions` (exact derivation of the planned inputs), or null. */
function planned(doc: Doc, actions: ActionJson[]): Planned | null {
  try {
    const p = planTransaction(doc, actions).doc
    const e = displayedWalk(p)
    return e ? { doc: p, e, f: walkFactsOf(e), item: selectedWalkItem(p, e), names: arrowNames(walkInputOf(e)) } : null
  } catch {
    return null
  }
}

/** A proposal from a template: its actions with an explanation from the planned walk, or an honest reply. */
function fromTemplate(doc: Doc, t: Prepared, title: string, explain: (p: Planned) => Part[], otherwise?: (reason: string) => Proposal): Proposal {
  if ('unavailable' in t) return otherwise ? otherwise(t.unavailable) : answer(title, [`Not applied: ${t.unavailable}.`])
  const p = planned(doc, t.actions)
  if (!p) return answer(title, ['Not applied: the prepared lesson actions do not apply to this workspace as it is.'])
  return { proposalVersion: 1, title, explanation: fit(explain(p)), actions: t.actions }
}

// ------------------------------------------------------------------ exact sentences

const SUB = '₀₁₂₃₄₅₆₇₈₉'
/** Subscript digits, as the lesson writes them: W₃, U₅, |W₁₀|². */
const sub = (n: number) => String(n).split('').map((c) => SUB[Number(c)]).join('')
/** An arrow's display name (a₁ … −c₂ on the hero's arrows), or its ID when it has none. */
const arrowName = (names: Map<string, string>, id: string) => names.get(id) ?? id

const r = (f: WalkFacts) => decimalText(f.R)
const R2 = (f: WalkFacts) => format(mul(f.R, f.R))
const signsText = (f: WalkFacts) => f.signs.map((s) => (s === 1 ? '+' : '−')).join(' ')
const len = (sq: WalkFacts['sourcePeak2']) => {
  const t = lengthText(sq)
  return t.startsWith('≈') ? t : `exactly ${t}`
}

function boundsSentence(f: WalkFacts): string {
  return f.zeroSum
    ? `Source bound ${f.B} and signed bound ${f.D} give new bound (${f.B} + ${f.D})/2 = ${r(f)} for every point of the new walk; ${comparisonText(f)}. These are bounds, not measured distances.`
    : `Source bound ${f.B} and signed bound ${f.D} would give (${f.B} + ${f.D})/2 = ${r(f)}, but the walk does not return home, so the lemma does not apply.`
}

function peaksSentence(f: WalkFacts): string {
  return `Actual largest squared distances from the start, computed exactly: ${format(f.sourcePeak2)} on the source walk (${len(f.sourcePeak2)}), ${format(f.reorderedPeak2)} on the new walk (${len(f.reorderedPeak2)}).`
}

/** "3 arrows", "1 arrow", "0 source steps". */
const steps = (n: number, what = 'arrow') => `${n} ${what}${n === 1 ? '' : 's'}`

/** Why W_k is (or is not) inside the bound, from its witness: one plain-language sentence (the lesson's own
 *  WHY_LEAD, as the mathematics panel shows it), then the identity and the squared-norm chain. */
function whySentences(f: WalkFacts, w: PrefixWitness, names: Map<string, string>): string[] {
  const { k, j } = w
  const [Wk, Uj, Sj] = [`W${sub(k)}`, `U${sub(j)}`, `S${sub(j)}`]
  const W = vtext(f.W[k]!)
  const counted = w.counted.map((i) => arrowName(names, f.ids[i]!)).join(' ') || 'none'
  if (k === 0) return [`W₀ is the start ${W}: inside every bound.`]
  const exact = `Exactly, |${Wk}|² = ${format(w.wNorm2)} ${w.withinBound ? '≤' : '>'} ${R2(f)}.`
  const lead = (f.zeroSum ? WHY_LEAD.inside : w.branch === 'positive' ? WHY_LEAD.positiveOpen : WHY_LEAD.negativeOpen).replace('this point', Wk)
  if (w.branch === 'positive') {
    // On an open walk the lemma warning comes before the arithmetic, so fit() never drops it.
    return [
      lead,
      f.zeroSum ? null : 'This identity and its bound need no zero total; the walk does not return home, though, so the lemma as a whole does not apply.',
      `${Wk} = ${W} is where the new walk is after ${steps(k)}. ${k === 1 ? 'Its first arrow is' : `Its first ${k} arrows are`} exactly the + ${k === 1 ? 'arrow' : 'arrows'} among the first ${steps(j, 'source step')} (${counted}), so ${Wk} = (${Uj} + ${Sj})/2 with ${Uj} = ${vtext(f.U[j]!)} and ${Sj} = ${vtext(f.S[j]!)}.`,
      `Since |${Uj}|² = ${format(f.uNorm2[j]!)} ≤ ${f.B * f.B} and |${Sj}|² = ${format(f.sNorm2[j]!)} ≤ ${f.D * f.D}, the triangle inequality gives |${Wk}| ≤ (|${Uj}| + |${Sj}|)/2 ≤ (${f.B} + ${f.D})/2 = ${r(f)}.`,
      exact,
    ].filter((x): x is string => !!x)
  }
  if (!f.zeroSum) {
    return [
      lead,
      `${Wk} = ${W} ${w.withinBound ? 'happens to lie inside' : 'is not inside'} the proposed bound ${r(f)}: here ${Wk} = T + (${Sj} − ${Uj})/2, and the total T = ${vtext(f.total)} is not zero, so it cannot be dropped ((${Sj} − ${Uj})/2 = ${vtext(w.halfSum)}).`,
      `|${Wk}|² = ${format(w.wNorm2)} ${w.withinBound ? '≤' : '>'} ${R2(f)}${w.withinBound ? '' : `: ${lengthText(w.wNorm2)} exceeds ${r(f)}`}. The lemma needs the walk to return home.`,
    ]
  }
  return [
    lead,
    `${Wk} = ${W} is where the new walk is after ${steps(k)}, in its − part. The − arrows not used yet are exactly the − arrows among the first ${steps(j, 'source step')} (${counted}); the walk returns home, so ${Wk} = (${Sj} − ${Uj})/2 with ${Sj} = ${vtext(f.S[j]!)} and ${Uj} = ${vtext(f.U[j]!)}.`,
    `Since |${Sj}|² = ${format(f.sNorm2[j]!)} ≤ ${f.D * f.D} and |${Uj}|² = ${format(f.uNorm2[j]!)} ≤ ${f.B * f.B}, the triangle inequality gives |${Wk}| ≤ (|${Sj}| + |${Uj}|)/2 ≤ (${f.D} + ${f.B})/2 = ${r(f)}.`,
    exact,
  ]
}

/** The failure of the proposed bound on an open walk (the first k outside it), as whole sentences. */
function failureSentences(f: WalkFacts): string[] {
  const k = f.firstFailure
  if (k === null) return [`The proposed bound ${r(f)} happens to hold at every point here, but nothing guarantees it without the hypothesis.`]
  const w = f.witnesses[k]!
  return [
    `The proposed bound is (${f.B} + ${f.D})/2 = ${r(f)}, yet |W${sub(k)}|² = ${format(w.wNorm2)} > ${R2(f)}, so ${lengthText(w.wNorm2)} exceeds ${r(f)}.`,
    w.branch === 'negative' ? `At k = ${k}, j = ${w.j} and W${sub(k)} = T + (S${sub(w.j)} − U${sub(w.j)})/2 = ${vtext(f.W[k]!)}; dropping T would wrongly give ${vtext(w.halfSum)}.` : null,
  ].filter((x): x is string => !!x)
}

// ------------------------------------------------------------------ prompt parsing

const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const NUM = `(?:\\d{1,2}|${NUM_WORDS.join('|')})`
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS.indexOf(s))

/** A named endpoint "W3", "w 3", "w-3", "w three" in a (normalized) prompt, else null. */
export function namedEndpoint(prompt?: string): number | null {
  const m = new RegExp(`(?:^|[^a-z])w ?-?(${NUM})(?![a-z0-9])`).exec(prompt ?? '')
  return m ? toNum(m[1]!) : null
}

/** An arrow's display name as typed or spoken: "c1", "c₁" (NFKC makes it c1), "−a2", "minus a two". The hero's
 *  names use the letters a, b and c. */
const NAME_RX = `(minus |negative |− ?|- ?)?([abc]) ?-?(${NUM})`
/** An arrow in a prompt: its ID ("v4") or its display name. */
const ARROW_REF = `(?:v ?-?${NUM}|(?:minus |negative |− ?|- ?)?[abc] ?-?${NUM})`

/** A named arrow in a (normalized) prompt, else null: an ID "v4", "v 4", "arrow v4", or, given the walk's display
 *  names, a name "c1", "−a2", "minus a two". A name that is not one of the walk's arrows comes back as written
 *  ("a₃" on the hero, "c₁" on a walk whose arrows have only IDs), so the answer says the walk has no such arrow
 *  instead of flipping the selected one. */
export function namedArrow(prompt?: string, names?: Map<string, string>): string | null {
  const m = new RegExp(`(?:^|[^a-z])v ?-?(${NUM})(?![a-z0-9])`).exec(prompt ?? '')
  if (m) return `v${toNum(m[1]!)}`
  if (!names) return null
  const n = new RegExp(`(?:^|[^a-z0-9])${NAME_RX}(?![a-z0-9])`).exec(prompt ?? '')
  if (!n) return null
  // Compared as typed (NFKC turns a shown c₁ into c1), so an arrow whose scene label is an ID such as "a1" resolves too.
  const typed = `${n[1] ? '−' : ''}${n[2]}${toNum(n[3]!)}`
  for (const [id, shown] of names) if (shown.normalize('NFKC') === typed) return id
  return `${n[1] ? '−' : ''}${n[2]}${sub(toNum(n[3]!))}`
}

const PRE = "(?:(?:please|ok|okay|so|now|and|alright|right|hey muse|muse|meta muse),? )*(?:(?:can|could|would) you (?:please )?)?"
const rx = (...alts: string[]) => new RegExp(`^${PRE}(?:${alts.join('|')})(?:,? please)?$`)
const AI = '(?:ai|a\\.? ?i\\.?)'
const ARROWS = '(?:the |these |those |our |all the |all these )?(?:arrows|steps|vectors)'
const WALKISH = `(?:${ARROWS}|(?:the |this )?walk|it|they)`
const POINT = `(?:(?:this|that|the(?: selected| chosen)?) (?:point|endpoint|end point|end-point|dot|spot)(?: w ?-?${NUM})?|(?:the )?(?:point |endpoint )?w ?-?${NUM})`
const BOUNDISH = '(?:the |this |that )?(?:new |proposed )?bound'

// ------------------------------------------------------------------ fixtures

function openLesson(doc: Doc): Proposal {
  const title = 'A step from an AI-produced proof'
  const before = displayedWalk(doc)
  return fromTemplate(doc, openLessonTemplate(doc), title, (p) => [
    `This ${before ? 'shows' : 'opens'} a prepared interactive explanation of one step in the proof of “${LESSON_SOURCE.title}” (${LESSON_SOURCE.author}, ${LESSON_SOURCE.date}), from its released Lean formalization: ${LESSON_SOURCE.declaration.name} (commit ${LESSON_SOURCE.commit.slice(0, 8)}).`,
    LESSON_SOURCE.origin,
    `Here: ${p.f.n} arrows in ${p.f.dimension}D that ${p.f.zeroSum ? 'return home' : 'do not return home'}; source bound ${p.f.B}, signed bound ${p.f.D}, ${p.f.zeroSum ? 'new' : 'proposed'} bound ${r(p.f)} (bounds, not measured distances).`,
    'The lesson covers this reordering step only; the signing bound is outside it.',
  ])
}

function whyNotClose(doc: Doc): Proposal {
  return fromTemplate(doc, sourceWalkTemplate(doc), 'Returning home does not keep it close', (p) => {
    const f = p.f
    const j = f.sourcePeakAt
    return [
      f.zeroSum ? `The source walk returns home: its total is ${vtext(f.total)}.` : `This walk does not even return home: its total is ${vtext(f.total)}.`,
      `${f.zeroSum ? 'On the way' : 'Its farthest point comes'} after ${j} of ${f.n} steps: U${sub(j)} = ${vtext(f.U[j]!)}, squared distance ${format(f.sourcePeak2)} from the start (actual distance ${len(f.sourcePeak2)}).`,
      f.zeroSum ? 'Returning home constrains only the last point, not the ones before it.' : null,
      `Source bound ${f.B} is the least whole number whose square is at least every squared source distance; it is a bound, not a measured distance.`,
      `This selects U${sub(j)} on the Walk step.`,
    ]
  })
}

function signTrick(doc: Doc): Proposal {
  return fromTemplate(doc, stageTemplate(doc, 'signs'), 'The sign trick', (p) => {
    const f = p.f
    const prepared = caseOf(walkInputOf(p.e)) !== null
    return [
      `Each arrow carries a + or − label; in source order: ${signsText(f)}.`,
      'The auxiliary signed walk adds the + arrows and subtracts the − arrows: it is a separate walk of signed copies, and the original arrows do not flip.',
      `With these signs every signed point stays within signed bound ${f.D} (largest squared value ${format(f.signedPeak2)}), while the source walk needs source bound ${f.B}.`,
      prepared ? 'These prepared signs come with the lesson as application data; nothing here searched for them.' : 'These are the current signs of this walk.',
      'This shows the Signs step.',
    ]
  })
}

function rearrange(doc: Doc): Proposal {
  return fromTemplate(doc, stageTemplate(doc, 'reorder'), 'Rearrange the same arrows', (p) => {
    const f = p.f
    const pos = f.positive.map((i) => arrowName(p.names, f.ids[i]!)).join(' ')
    const neg = [...f.negative].reverse().map((i) => arrowName(p.names, f.ids[i]!)).join(' ')
    return [
      `The new order takes the + arrows in source order, then the − arrows in reverse source order: ${pos || '(no + arrows)'}, then ${neg || '(no − arrows)'}.`,
      'Every arrow is used once and keeps its direction and length; only the order changes.',
      boundsSentence(f),
      peaksSentence(f),
    ]
  })
}

function whyPoint(doc: Doc, prompt?: string): Proposal {
  const named = namedEndpoint(prompt)
  const e = displayedWalk(doc)
  if (!e) return notShown('Why this point is inside the bound')
  const f = walkFactsOf(e)
  if (named !== null) {
    if (named > f.n) return answer(`W${sub(named)}`, [`Not available: this walk has ${f.n} arrows, so its points are W₀ to W${sub(f.n)}.`])
    const sel = selectedWalkItem(doc, e)
    const already = sel?.kind === 'reordered' && sel.index === named
    const actions = [...(already ? [] : [{ kind: 'select_item', experimentId: e.id, item: `walk:reordered:${named}` }]), { kind: 'show_walk_stage', experimentId: e.id, stage: 'why' }]
    return fromTemplate(doc, prepared(doc, actions), `Why W${sub(named)} is ${f.witnesses[named]!.withinBound ? 'inside' : 'outside'} the bound`, (p) => [
      already ? null : `This selects W${sub(named)} and shows the Why step.`,
      ...whySentences(p.f, p.f.witnesses[named]!, p.names),
    ])
  }
  const it = selectedWalkItem(doc, e)
  if (it?.kind === 'reordered') {
    const w = f.witnesses[it.index]!
    return fromTemplate(doc, whyThisPointTemplate(doc), `Why W${sub(w.k)} is ${w.withinBound ? 'inside' : 'outside'} the bound`, (p) => whySentences(p.f, p.f.witnesses[w.k]!, p.names))
  }
  if (it?.kind === 'source' || it?.kind === 'signed') {
    const j = it.index
    const ks = f.witnesses.filter((x) => x.j === j).map((x) => x.k)
    const example = `W${sub(ks[0] ?? representativeK(f))}`
    const [P, sq, bound, name] = it.kind === 'source' ? [`U${sub(j)}`, f.uNorm2[j]!, f.B, 'source'] as const : [`S${sub(j)}`, f.sNorm2[j]!, f.D, 'signed'] as const
    return answer(`${P} is a ${name} point`, [
      `The selected point is the ${name} point ${P} = ${vtext((it.kind === 'source' ? f.U : f.S)[j]!)}: |${P}|² = ${format(sq)} ≤ ${bound * bound}, inside ${name} bound ${bound} because that bound is chosen to contain every ${name} point.`,
      `The lemma is about points of the new walk${ks.length ? `; ${P} is the witness for ${ks.map((k) => `W${sub(k)}`).join(' and ')}` : ''}. Select a point of the new walk (for example ${example}) and ask again, or name it: "Why is ${example} inside the bound?"`,
    ])
  }
  if (it?.kind === 'vector') {
    return answer('Which point?', [`An arrow (${arrowName(arrowNames(walkInputOf(e)), it.id)}) is selected, not a point, so "this point" is ambiguous. Which point of the new walk do you mean? Select one, or name it, for example "Why is W${sub(representativeK(f))} inside the bound?"`])
  }
  return fromTemplate(doc, whyRepresentativeTemplate(doc), 'Why this point is inside the bound', (p) => {
    const k = p.item?.kind === 'reordered' ? p.item.index : 0
    const which = caseOf(walkInputOf(p.e)) === 'hero' ? `the prepared example W${sub(k)}` : `W${sub(k)}, a representative endpoint,`
    return [`No endpoint was selected, so this selects ${which} and shows the Why step.`, ...whySentences(p.f, p.f.witnesses[k]!, p.names)]
  })
}

const representativeK = (f: WalkFacts) => (f.positive.length ? Math.ceil(f.positive.length / 2) : f.positive.length + Math.ceil(f.negative.length / 2))

function otherHalf(doc: Doc): Proposal {
  const title = 'The other half of the argument'
  const e = displayedWalk(doc)
  if (!e) return notShown(title)
  return fromTemplate(doc, otherHalfTemplate(doc), title, (p) => {
    const k = p.item?.kind === 'reordered' ? p.item.index : 0
    const w = p.f.witnesses[k]!
    return [
      `This selects W${sub(k)}, a representative endpoint of the ${w.branch === 'negative' ? '− (negative)' : '+ (positive)'} branch, and shows the Why step.`,
      ...whySentences(p.f, w, p.names),
      w.branch === 'negative' ? 'The + half uses W = (U + S)/2 instead; together the two branches cover every point of the new walk.' : 'The − half uses W = (S − U)/2 instead; together the two branches cover every point of the new walk.',
    ]
  }, (reason) => answer(title, [
    /no − arrows/.test(reason) ? 'This walk has no − arrows, so there is no − half: every point of the new walk is a + prefix, W = (U + S)/2.' : `Not applied: ${reason}.`,
    /no − arrows/.test(reason) ? `With every sign +, the signed walk equals the source walk, so the new bound ${r(walkFactsOf(e))} equals source bound ${walkFactsOf(e).B}.` : null,
  ]))
}

function flipSign(doc: Doc, prompt?: string): Proposal {
  const e = displayedWalk(doc)
  if (!e) return notShown('Flip a sign')
  const sel = selectedWalkItem(doc, e)
  const names = arrowNames(walkInputOf(e))
  const id = namedArrow(prompt, names) ?? (sel?.kind === 'vector' ? sel.id : null)
  const name = id === null ? null : arrowName(names, id)
  const sample = e.vectors[Math.min(4, e.vectors.length - 1)]
  const before = walkFactsOf(e)
  return fromTemplate(doc, flipSignTemplate(doc, id), `Flip the sign of ${name ?? 'an arrow'}`, (p) => {
    const now = p.f.signs[p.f.ids.indexOf(id!)] === 1 ? '+' : '−'
    return [
      `This changes the sign of ${name} from ${now === '+' ? '−' : '+'} to ${now}; the arrow itself does not change.`,
      `The source walk and source bound ${p.f.B} stay; the signed walk, the new order and the new bound are recomputed: signed bound ${p.f.D} (was ${before.D}), new bound ${r(p.f)} (was ${r(before)}).`,
      `Now ${comparisonText(p.f)}. A sign change can make the bound better, keep it the same or make it worse.`,
      'An earlier Lean check covered the old signs only.',
    ]
  }, (reason) => answer('Which arrow?', [/no arrow is selected/.test(reason) ? `Which arrow? No arrow is selected, so "this sign" names nothing. Select an arrow, or name it, for example "Flip the sign of ${sample ? arrowName(names, sample.id) : 'v4'}".` : `Not applied: ${reason}.`]))
}

function allPositive(doc: Doc): Proposal {
  const e = displayedWalk(doc)
  if (!e) return notShown('Make all signs positive')
  const before = walkFactsOf(e)
  return fromTemplate(doc, allPositiveTemplate(doc), 'Make all signs positive', (p) => [
    'This sets every sign to +. The signed walk then equals the source walk and the new order is the source order.',
    `Signed bound ${p.f.D}, so ${p.f.zeroSum ? 'new' : 'proposed'} bound (${p.f.B} + ${p.f.D})/2 = ${r(p.f)} (before: ${r(before)}): ${comparisonText(p.f)}.`,
    'Signs can make the bound better, keep it the same or make it worse; this run shows the actual result, not a scripted improvement.',
    'Undo restores the previous signs.',
  ])
}

function restoreSigns(doc: Doc): Proposal {
  const e = displayedWalk(doc)
  if (!e) return notShown('Restore the prepared signs')
  return fromTemplate(doc, preparedSignsTemplate(doc), 'Restore the prepared signs', (p) => [
    `This restores the prepared signs (application data supplied with the lesson): ${signsText(p.f)}.`,
    `Signed bound ${p.f.D}, new bound ${r(p.f)}; ${comparisonText(p.f)}.`,
  ])
}

function returnHome(doc: Doc): Proposal {
  const target = lessonTarget(doc).e
  const already = target !== null && caseOf(walkInputOf(target)) === 'open-two'
  return fromTemplate(doc, counterexampleTemplate(doc), 'Why the arrows must return home', (p) => {
    const f = p.f
    return [
      `This ${already ? 'shows' : 'opens'} the prepared counterexample: ${f.n} arrows ${f.vectors.map(vtext).join(' and ')} with signs ${signsText(f)}.`,
      `The total T = ${vtext(f.total)} is ${f.zeroSum ? 'zero' : 'not zero'}, so the return-to-start assumption is ${f.zeroSum ? 'met' : 'missing and the lemma does not apply'}.`,
      ...(f.zeroSum ? [] : failureSentences(f)),
      'This is a counterexample to dropping an assumption, not to the published theorem.',
      already ? null : target ? 'Undo restores the previous walk.' : 'Undo removes the lesson again.',
    ]
  })
}

function restoreClosed(doc: Doc): Proposal {
  const title = 'Restore the closed walk'
  const e = displayedWalk(doc)
  if (!e) return notShown(title)
  return fromTemplate(doc, restoreClosedTemplate(doc), title, (p) => [
    `This restores the prepared closed walk: ${p.f.n} arrows in ${p.f.dimension}D with total ${vtext(p.f.total)}.`,
    `The lemma applies again: source bound ${p.f.B}, signed bound ${p.f.D}, new bound ${r(p.f)}; computed exactly, every point of the new walk is within it (largest squared value ${format(p.f.reorderedPeak2)} ≤ ${R2(p.f)}).`,
    'Undo returns to the open walk.',
  ], (reason) => answer(title, [/already returns/.test(reason) ? `Not applied: the walk already returns to its start (total ${vtext(walkFactsOf(e).total)}); there is nothing to restore.` : `Not applied: ${reason}.`]))
}

function whyFails(doc: Doc): Proposal {
  const title = 'Why the bound fails here'
  const e = displayedWalk(doc)
  if (!e) return notShown(title)
  const f = walkFactsOf(e)
  if (f.zeroSum) return answer(title, [`The bound does not fail here: the walk returns home (total ${vtext(f.total)}), so the lemma applies, and computed exactly every |Wₖ|² ≤ ${R2(f)} (largest ${format(f.reorderedPeak2)}).`, '"Why must the arrows return home?" shows a walk where it fails.'])
  return fromTemplate(doc, explainFailureTemplate(doc), title, (p) => [
    p.f.firstFailure !== null ? `This selects W${sub(p.f.firstFailure)}, the first point outside the proposed bound.` : null,
    `The walk does not return home: total T = ${vtext(p.f.total)}.`,
    ...failureSentences(p.f),
    'The identity keeps the residual T; the lemma removes it only when T = 0. The missing hypothesis is the return to the start.',
  ], (reason) => answer(title, [`The walk does not return home (total ${vtext(f.total)}), so the lemma does not apply, but ${reason}.`]))
}

function checkExample(doc: Doc): Proposal {
  const title = 'Check this example'
  const e = displayedWalk(doc)
  if (!e) return notShown(title)
  const f = walkFactsOf(e)
  if (!f.zeroSum) {
    return answer('No check: the lemma does not apply', [
      `No Lean check is requested. The lemma needs the walk to return to its start, and this one does not (total ${vtext(f.total)}), so there is nothing to certify; a check that assumed the missing hypothesis would succeed vacuously and say nothing about this walk.`,
      ...failureSentences(f).slice(0, 1).map((s) => `Computed exactly: ${s.charAt(0).toLowerCase()}${s.slice(1)}`),
      '"Restore the closed walk" brings back an example that can be checked.',
    ])
  }
  return fromTemplate(doc, checkTemplate(doc), title, (p) => [
    `This asks the Lean checker about this finite example: from these exact ${p.f.n} vectors and signs it recomputes every source, signed and reordered point and checks total zero, B = ${p.f.B}, D = ${p.f.D}, the new order, every prefix identity and every |Wₖ|² ≤ ${R2(p.f)}.`,
    'It covers this example only, not the general lemma, the research theorem or this explanation.',
    'Nothing is Lean-checked until the checker answers.',
  ])
}

function wholeTheorem(): Proposal {
  return answer('Not the whole theorem', [
    `No. The lesson explains one reordering lemma used in the released proof, ${LESSON_SOURCE.declaration.name}: if the walk returns home, every source point is within B and every signed point within D, then the new order stays within (B + D)/2.`,
    'The hard part, the signing bound with its constant C√d, is outside this lesson.',
    'The transfer then takes an order whose actual peak B* is smallest; the lemma gives another order with peak at most (B* + D)/2, so minimality forces B* ≤ D.',
    `Coverage: ${LESSON_SOURCE.coverageLine}.`,
  ])
}

function simplerExample(doc: Doc): Proposal {
  const existed = lessonTarget(doc).e !== null
  return fromTemplate(doc, simplerExampleTemplate(doc), 'The simpler example', (p) => [
    `This shows the simpler example: ${p.f.n} steps along one line, ${p.f.vectors.map(vtext).join(', ')}, signs ${signsText(p.f)}.`,
    'It is collinear: a teaching case, not a spatial research example.',
    boundsSentence(p.f),
    `The new walk's largest squared distance is ${format(p.f.reorderedPeak2)} (${len(p.f.reorderedPeak2)}).`,
    existed ? 'Undo returns to the previous walk.' : 'Undo removes the lesson again.',
  ])
}

export const WALK_FIXTURES: WalkFixture[] = [
  {
    name: 'proof-open',
    example: 'Show me a step from an AI-produced proof',
    matches: rx(
      `(?:show|give|teach|walk|take) (?:me |us )?(?:through )?(?:a|one|the) (?:step|lemma|piece|part) (?:from|of|in) (?:an? |the )?${AI}(?:-| )?(?:produced|generated|written|made|found) proof`,
      '(?:open|show|start) (?:me )?(?:the )?(?:proof (?:lesson|explorer)|steinitz(?:[- ]bergstr(?:ö|o|oe)m)? lesson)',
      'show (?:me )?(?:a|one|the) step (?:from|of|in) (?:a|the) (?:published|released|research) proof',
    ),
    build: openLesson,
  },
  {
    name: 'proof-why-not-close',
    example: 'Why does returning home not keep it close?',
    matches: rx(
      "why (?:does|doesn't|does not|didn't|did not) (?:returning|coming|getting|going) (?:back )?home (?:not )?keep (?:it|the walk|us|you|them|the arrows) (?:close|near|nearby|small)(?: to home)?",
      'why does (?:the )?walk (?:go|get|wander|travel) (?:so )?far(?: from home| away)?',
      '(?:show|explain) (?:me )?(?:the )?(?:source walk|excursion|original walk)',
    ),
    build: whyNotClose,
  },
  {
    name: 'proof-sign-trick',
    example: 'Show the sign trick',
    matches: rx(
      "(?:show|explain|what is|what's|whats) (?:me )?(?:the )?sign(?:s|ing)? trick(?: works)?",
      'how does the sign(?:ing)? trick work',
      'show (?:me )?(?:the )?(?:signed|auxiliary|signed auxiliary) walk',
    ),
    build: signTrick,
  },
  {
    name: 'proof-rearrange',
    example: 'Rearrange the same arrows',
    matches: rx(
      `(?:rearrange|reorder|re-order|re order|shuffle) (?:the same )?${ARROWS}`,
      '(?:show|apply) (?:me )?(?:the )?(?:reordering|rearrangement|new order|reordered walk)',
    ),
    build: rearrange,
  },
  {
    name: 'proof-why-point',
    example: 'Why is this point inside the bound?',
    matches: rx(
      `why (?:is|does|must) ${POINT} (?:stay |lie |sit |fall |land )?(?:inside|within|in|under|below) ${BOUNDISH}(?: \\d+)?`,
      `explain (?:this|that|the(?: selected)?) (?:point|endpoint)`,
      `explain (?:the )?(?:point |endpoint )?w ?-?${NUM}`,
    ),
    build: whyPoint,
  },
  {
    name: 'proof-other-half',
    example: 'Show the other half of the argument',
    matches: rx(
      'show (?:me )?the other (?:half|part|side|branch|case)(?: of (?:the|this) (?:argument|proof|lemma))?',
      'show (?:me )?the (?:negative|minus|second) (?:half|part|branch|case|side)(?: of (?:the|this) (?:argument|proof|lemma))?',
      'what about the (?:other half|negative (?:half|branch|part))',
    ),
    build: otherHalf,
  },
  {
    name: 'proof-flip-sign',
    example: 'Flip this sign',
    matches: rx(
      '(?:flip|change|switch|toggle|reverse|invert) (?:this|that|the(?: selected)?|its|the chosen) sign',
      '(?:flip|change|switch|toggle) the sign of (?:this|that|the selected|the chosen) (?:arrow|vector|step)',
      "(?:flip|change|switch|toggle) (?:this|that|the selected) (?:arrow|vector|step)(?:'s)? sign",
      `(?:flip|change|switch|toggle) (?:the )?sign (?:of |on )?(?:arrow |vector )?${ARROW_REF}`,
      `flip (?:arrow |vector )?${ARROW_REF}(?:'s sign)?`,
    ),
    build: flipSign,
  },
  {
    name: 'proof-all-positive',
    example: 'Make all signs positive',
    matches: rx('(?:make|set|turn|change) (?:all|every|all the|all of the|each) (?:of the )?(?:signs?|arrows?|labels?) (?:to )?(?:positive|plus|\\+|pluses)'),
    build: allPositive,
  },
  {
    name: 'proof-restore-signs',
    example: 'Restore the prepared signs',
    matches: rx('(?:restore|reset|bring back) (?:the )?(?:prepared|original|old|previous|hero) signs'),
    build: restoreSigns,
  },
  {
    name: 'proof-return-home',
    example: 'Why must the arrows return home?',
    matches: rx(
      `why (?:must|do|does|should|did|would|need) ${WALKISH} (?:need to |have to |must )?(?:return|come back|go back|get back|end)(?: home| to (?:the |its |their )?start(?:ing point)?| where (?:they|it) started)?`,
      'why (?:is|does) (?:returning|coming back) home (?:matter|needed|necessary|required|important)',
      "what (?:if|happens if) (?:the )?(?:walk|arrows) (?:does|do)(?:n't| not) (?:return|come back)(?: home)?",
      'show (?:me )?(?:the )?(?:missing(?:-| )assumption|counterexample|counter example|counter-example|open walk)',
    ),
    build: returnHome,
  },
  {
    name: 'proof-restore',
    example: 'Restore the closed walk',
    matches: rx(
      '(?:restore|bring back|go back to|return to|reset to|back to|reopen) (?:the )?(?:closed|original|hero|prepared|previous|main|3d|first) (?:walk|example|case)',
      'restore (?:the )?(?:example|walk)',
    ),
    build: restoreClosed,
  },
  {
    name: 'proof-why-fails',
    example: 'Why does the bound fail here?',
    matches: rx(
      `why does ${BOUNDISH} (?:fail|break|not hold|stop working|not work)(?: here| now)?`,
      `why does(?:n't| not) ${BOUNDISH} (?:hold|work)(?: here| now)?`,
      `why (?:is|does) ${BOUNDISH} (?:fail(?:ing)?|broken|wrong|violated)(?: here| now)?`,
    ),
    build: whyFails,
  },
  {
    name: 'proof-check',
    example: 'Check this example',
    matches: rx(
      '(?:check|verify|lean(?:-| )check|prove|certify|confirm) (?:this|the|that|our|the current) (?:example|walk|instance|case|reordering)(?: (?:in|with) lean)?',
      'check (?:it|this) (?:in|with) lean',
      '(?:run|request) (?:a |the )?lean check(?: (?:on|of) (?:this|the) (?:example|walk))?',
    ),
    build: checkExample,
  },
  {
    name: 'proof-whole-theorem',
    example: 'Does this prove the whole theorem?',
    matches: rx(
      'does (?:this|it|that|the lesson|this lesson) prove (?:the )?(?:whole|entire|full|complete) (?:theorem|result|proof)',
      'is (?:this|that|it) the (?:whole|entire|full|complete) (?:theorem|proof)',
      'does (?:this|it) prove (?:the )?steinitz(?:[- ]bergstr(?:ö|o|oe)m)?(?: theorem)?',
    ),
    build: wholeTheorem,
  },
  {
    name: 'proof-simpler',
    example: 'Show the simpler example',
    matches: rx('show (?:me )?(?:the )?(?:simpler|simple|easier|one-dimensional|1d|collinear) (?:example|case|walk)'),
    build: simplerExample,
  },
]
