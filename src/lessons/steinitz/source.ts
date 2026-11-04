// Published-source provenance of the proof lesson (PROOF-EXPLORER-SPEC section 7, MATH sections 1 and 7).
// This is trusted prepared metadata, not evidence of a local Lean run: the learner must be able to tell apart
// "this source contains the formalized lemma", "these values were computed exactly" and "Lean checked this
// finite example". No upstream code is copied into the product; short statements below paraphrase the pinned
// declarations, which stay under the upstream Apache License 2.0 (copy and hashes in workspace-spec/references/
// steinitz/, manifest.json). The Comparator challenge file ends in `sorry` by design and is never shown as the proof.
//
// Pure data module: imported by the browser and by the Node server (the assistant's curated lesson context).

const REPO = 'https://github.com/openai/math'
export const SOURCE_COMMIT = '4eaee87548250b2682affda7d05d947c05554bae'
const AT = `${REPO}/blob/${SOURCE_COMMIT}`

export interface SourceDeclaration {
  /** Fully qualified Lean name. */
  name: string
  /** Its role in one plain sentence. */
  role: string
  /** Pinned link to the declaration's line at the source commit. */
  url: string
}

export const LESSON_SOURCE = {
  title: 'The Euclidean Steinitz–Bergström theorem',
  author: 'OpenAI',
  date: 'September 24, 2026',
  repository: REPO,
  commit: SOURCE_COMMIT,
  retrieved: '2026-10-31',
  license: 'Apache License 2.0 (upstream repository)',
  paperUrl: `${REPO}/tree/${SOURCE_COMMIT}/preprints/The-Euclidean-Steinitz-Bergstrom-theorem-September-24-2026`,
  /** Page 3, §1.1 "From signs to an ordering" gives the argument this lesson illustrates. */
  paperSection: 'Paper p. 3, §1.1 “From signs to an ordering”',
  file: 'lean/OAI/Analysis/Steinitz/Transference.lean',
  /** The lemma the lesson explains. */
  declaration: {
    name: 'OAI.EuclideanSteinitzBergstrom.signedOrder_prefix_bound',
    role: 'If the walk returns to its start, every source prefix is within B and every signed prefix within D, then every prefix of the positive-forward, negative-reverse order is within (B + D)/2.',
    url: `${AT}/lean/OAI/Analysis/Steinitz/Transference.lean#L95`,
  } satisfies SourceDeclaration,
  supporting: [
    { name: 'OAI.EuclideanSteinitzBergstrom.signedOrder', role: 'The output order: positive-labelled entries in order, then negative-labelled entries reversed.', url: `${AT}/lean/OAI/Analysis/Steinitz/Transference.lean#L48` },
    { name: 'OAI.EuclideanSteinitzBergstrom.signedOrder_perm', role: 'That order is a permutation of the original list: every occurrence once.', url: `${AT}/lean/OAI/Analysis/Steinitz/Transference.lean#L51` },
    { name: 'OAI.EuclideanSteinitzBergstrom.signedOrder_prefix', role: 'Every new prefix is a positive-filtered source prefix, or minus a negative-filtered one (using the zero total).', url: `${AT}/lean/OAI/Analysis/Steinitz/Transference.lean#L56` },
    { name: 'OAI.EuclideanSteinitzBergstrom.signed_parts', role: 'Twice the positive part is U + S; twice the negative part is U − S.', url: `${AT}/lean/OAI/Analysis/Steinitz/Transference.lean#L84` },
    { name: 'OAI.EuclideanSteinitzBergstrom.signing_implies_ordering', role: 'The transfer: a signing bound gives an ordering bound, via an order with minimal peak.', url: `${AT}/lean/OAI/Analysis/Steinitz/Transference.lean#L133` },
    { name: 'OAI.EuclideanSteinitzBergstrom.main', role: 'The research result, which uses the transfer theorem.', url: `${AT}/lean/OAI/Analysis/Steinitz/Main.lean#L111` },
  ] as SourceDeclaration[],
  /** The lemma's own hypotheses, then the surrounding theorem's extra condition (reported separately). */
  assumptions: {
    lemma: ['The source walk returns to its start (total zero).', 'Every source prefix has length at most B.', 'Every signed prefix has length at most D.'],
    theoremOnly: ['Every vector has length at most 1 (a condition of the Steinitz–Bergström theorem, not of this lemma; it holds in the prepared examples).'],
  },
  /** Honest origin: the argument predates this release. */
  origin: 'The paper presents this transfer argument as Chobanyan’s transference principle in its positive-forward, negative-reverse form, citing earlier work. It is a step used in the released proof, not a new AI-invented lemma.',
  /** The compact coverage map (storyboard): what this lesson does and does not explain. */
  coverage: [
    { step: 'Signing bound', status: 'outside this lesson' },
    { step: 'Reordering step', status: 'interactive' },
    { step: 'Ordering result', status: 'shown as the final logic' },
  ],
  coverageLine: 'Signing bound: outside this lesson → Reordering step: interactive → Ordering result',
  /** The final logic of the transfer (optional card): minimal peak B*, signing bound D = C√d, B* ≤ (B* + D)/2. */
  minimality: 'Among the finitely many orders choose one whose actual peak B* is smallest. Signing that order gives D = C√d; this lemma then gives another order with peak at most (B* + D)/2. Minimality forces B* ≤ (B* + D)/2, so B* ≤ D. The lesson’s integer bound B is not this minimal B*, and the app never searches for an optimal order.',
  /** What the lesson does not provide. */
  notCovered: ['the constant C or any proof of the signing theorem', 'an online signing algorithm', 'a globally optimal ordering', 'a local build of the upstream research project'],
} as const

/** The three evidence levels the learner must be able to tell apart (MATH section 8). */
export const EVIDENCE_LEVELS = {
  published: 'Published source: the pinned declaration and its assumptions. Provenance, not a local Lean run.',
  computed: 'Computed exactly: the current finite data, prefix identities and squared-norm comparisons, by the app’s rational arithmetic.',
  checked: 'Lean checked · this finite example: only after the backend compiled and audited the generated statement for exactly the current vectors and signs.',
} as const
