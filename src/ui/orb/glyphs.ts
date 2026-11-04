// The math glyph orb's symbols and layout (the approved mock-up): 120 mathematical symbols on a Fibonacci
// sphere, each with a fixed ripple phase and its latitude. Pure data, shared by the desktop canvas and the
// XR instanced mesh.

/** The mock-up's glyph set (40 symbols; glyph i is ORB_GLYPHS[(7 i) mod 40]). */
export const ORB_GLYPHS = [
  'ε', 'τ', 'λ', 'π', 'Σ', '∫', '∂', '∞', 'φ', 'θ', '∇', '√', 'μ', 'ω', 'Δ', 'ζ', 'η', 'κ', 'ρ', 'σ',
  'ψ', '∈', '∀', '∃', '≤', 'ℝ', '∮', 'α', 'β', 'γ', 'δ', 'ξ', 'χ', 'Ω', 'Π', 'ℤ', '⊗', '≈', 'ℏ', '∑',
] as const

export const ORB_GLYPH_COUNT = 120

/** The glyph font (as in the mock-up). */
export const ORB_GLYPH_FONT = `"Times New Roman", "STIX Two Math", serif`

export interface OrbGlyph {
  /** Unit-sphere position. */
  x: number
  y: number
  z: number
  /** Index into ORB_GLYPHS. */
  glyph: number
  /** Ripple phase in [0, 2π). */
  phase: number
  /** Latitude, asin(y). */
  lat: number
}

/** A fixed pseudo-random phase in [0, 2π) (the mock-up drew Math.random(); fixed here so layouts are reproducible). */
function ripplePhase(i: number): number {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  const p = (s - Math.floor(s)) * Math.PI * 2
  return p >= Math.PI * 2 ? 0 : p
}

/** n points on the unit sphere (Fibonacci / golden-angle spiral, top to bottom), each with its glyph. */
export function glyphLayout(n = ORB_GLYPH_COUNT): OrbGlyph[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: OrbGlyph[] = []
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) * 2) / n
    const r = Math.sqrt(1 - y * y)
    const th = i * golden
    out.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, glyph: (i * 7) % ORB_GLYPHS.length, phase: ripplePhase(i), lat: Math.asin(y) })
  }
  return out
}
