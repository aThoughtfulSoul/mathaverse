// Targeted patch for manim-web 0.40.1 (RUNTIME-ADAPTER R6 "small library limitation").
//
// Issue: svgToVMobjects (src/mobjects/text/svgPathParser.ts walkElement) ignores the x / y / viewBox of a
// NESTED <svg> and reads only the first argument of scale(sx, sy). MathJax 4 draws the extender of a
// stretchy delimiter (the brackets of a 3-row bmatrix/pmatrix) inside a nested <svg> with
// `transform="scale(1,1.41)"`, so the extender lands at the wrong height and the bracket shows a gap.
//
// The library treats MathJax glyph data as y-up and deliberately ignores the y-flip of scale(1,-1);
// the patch keeps that convention (the sign of a y-scale follows its x-scale) and honours only the
// magnitude of a non-uniform y-scale.
//
// Fix: carry separate x/y scales through the walk, map a nested <svg>'s viewBox into its x/y/width/height
// viewport, and clamp that subtree's points to the viewport (MathJax relies on viewport clipping to cut the
// extender; it is a straight bar, so clamping its control points is exact for it, an approximation for
// arbitrary clipped curves). The root <svg> is unchanged (its viewBox is handled by the caller).
//
// Applied to the pinned dist chunk only after verifying its SHA-256, idempotently. Any other version or
// content aborts loudly. Source-level equivalent for upstream: docs/DEPENDENCIES.md ("Upstream source equivalent").

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'node_modules/manim-web/package.json')
const FILE = join(ROOT, 'node_modules/manim-web/dist/src-B3QcbMss.js')
const ORIGINAL_SHA = '4cc4be25ee636dcb27b24cb891473d0f99c621510a7367a2b0545ffa4252d7df'
const MARKER = '/* math-workspace patch: nested-svg viewport + scale(sx,sy) */'

const OLD = `	let l = a;
	function u(e, t, a, d) {
		let f = e.tagName.toLowerCase();
		if (f === "defs" || e.getAttribute("data-mml-node") === "merror") return;
		let p = t, m = a, h = d, g = e.getAttribute("transform");
		if (g) {
			let e = /(translate|scale)\\s*\\(([^)]*)\\)/g, t;
			for (; (t = e.exec(g)) !== null;) {
				let e = t[1], n = t[2].split(/[\\s,]+/).filter(Boolean).map(Number);
				e === "translate" ? (p += h * (n[0] || 0), m += h * (n[1] || 0)) : e === "scale" && (h *= n[0] || 1);
			}
		}
		if (f === "path") {
			let t = e.getAttribute("d");
			if (t) {
				let e = Hm(t, p, m, h, l, o, n, r, i);
				e && s.add(e);
			}
		} else if (f === "use") {
			let t = (e.getAttribute("xlink:href") || e.getAttribute("href") || "").replace(/^#/, ""), a = c.get(t), u = parseFloat(e.getAttribute("x") || "0"), d = parseFloat(e.getAttribute("y") || "0");
			if (a) {
				let e = Hm(a, p + h * u, m + h * d, h, l, o, n, r, i);
				e && s.add(e);
			}
		} else if (f === "rect") {
			let t = parseFloat(e.getAttribute("x") || "0"), a = parseFloat(e.getAttribute("y") || "0"), c = parseFloat(e.getAttribute("width") || "0"), u = parseFloat(e.getAttribute("height") || "0");
			if (c > 0 && u > 0) {
				let e = Hm(\`M\${t},\${a} L\${t + c},\${a} L\${t + c},\${a + u} L\${t},\${a + u} Z\`, p, m, h, l, o, n, r, i);
				e && s.add(e);
			}
		}
		for (let t of e.children) u(t, p, m, h);
	}
	return u(e, 0, 0, 1), s;
}
function Hm(e, t, n, r, i, a, o, s, c) {
	let l = Lm(e);
	if (l.length === 0) return null;
	let u = [], d = [];
	for (let e of l) {
		let o = u.length;
		for (let [o, s] of e) {
			let e = (t + r * o) * i, c = a ? -(n + r * s) * i : (n + r * s) * i;`

const NEW = `	let l = a;
	${MARKER}
	function u(e, t, a, d, hy = d, cl = null, depth = 0) {
		let f = e.tagName.toLowerCase();
		if (f === "defs" || e.getAttribute("data-mml-node") === "merror") return;
		let p = t, m = a, h = d, g = e.getAttribute("transform");
		if (f === "svg" && depth > 0) {
			let vb = (e.getAttribute("viewBox") || "").split(/[\\s,]+/).filter(Boolean).map(Number), X = parseFloat(e.getAttribute("x") || "0"), Y = parseFloat(e.getAttribute("y") || "0"), W = parseFloat(e.getAttribute("width") || ""), H = parseFloat(e.getAttribute("height") || "");
			if (vb.length === 4 && vb[2] > 0 && vb[3] > 0 && W > 0 && H > 0) {
				let kx = W / vb[2], ky = H / vb[3], c0 = [p + h * X, p + h * (X + W), m + hy * Y, m + hy * (Y + H)];
				cl = cl ? [Math.max(cl[0], Math.min(c0[0], c0[1])), Math.min(cl[1], Math.max(c0[0], c0[1])), Math.max(cl[2], Math.min(c0[2], c0[3])), Math.min(cl[3], Math.max(c0[2], c0[3]))] : [Math.min(c0[0], c0[1]), Math.max(c0[0], c0[1]), Math.min(c0[2], c0[3]), Math.max(c0[2], c0[3])];
				p += h * (X - vb[0] * kx), m += hy * (Y - vb[1] * ky), h *= kx, hy *= ky;
			}
		}
		if (g) {
			let e = /(translate|scale)\\s*\\(([^)]*)\\)/g, t;
			for (; (t = e.exec(g)) !== null;) {
				let e = t[1], n = t[2].split(/[\\s,]+/).filter(Boolean).map(Number);
				e === "translate" ? (p += h * (n[0] || 0), m += hy * (n[1] || 0)) : e === "scale" && (hy *= n.length > 1 ? Math.abs(n[1]) * Math.sign(n[0] || 1) : n[0] || 1, h *= n[0] || 1);
			}
		}
		if (f === "path") {
			let t = e.getAttribute("d");
			if (t) {
				let e = Hm(t, p, m, h, l, o, n, r, i, hy, cl);
				e && s.add(e);
			}
		} else if (f === "use") {
			let t = (e.getAttribute("xlink:href") || e.getAttribute("href") || "").replace(/^#/, ""), a = c.get(t), u = parseFloat(e.getAttribute("x") || "0"), d = parseFloat(e.getAttribute("y") || "0");
			if (a) {
				let e = Hm(a, p + h * u, m + hy * d, h, l, o, n, r, i, hy, cl);
				e && s.add(e);
			}
		} else if (f === "rect") {
			let t = parseFloat(e.getAttribute("x") || "0"), a = parseFloat(e.getAttribute("y") || "0"), c = parseFloat(e.getAttribute("width") || "0"), u = parseFloat(e.getAttribute("height") || "0");
			if (c > 0 && u > 0) {
				let e = Hm(\`M\${t},\${a} L\${t + c},\${a} L\${t + c},\${a + u} L\${t},\${a + u} Z\`, p, m, h, l, o, n, r, i, hy, cl);
				e && s.add(e);
			}
		}
		for (let t of e.children) u(t, p, m, h, hy, cl, depth + 1);
	}
	return u(e, 0, 0, 1), s;
}
function Hm(e, t, n, r, i, a, o, s, c, ry = r, cl = null) {
	let l = Lm(e);
	if (l.length === 0) return null;
	let u = [], d = [];
	for (let e of l) {
		let o = u.length;
		for (let [o, s] of e) {
			let X = t + r * o, Y = n + ry * s;
			cl && (X = Math.min(Math.max(X, cl[0]), cl[1]), Y = Math.min(Math.max(Y, cl[2]), cl[3]));
			let e = X * i, c = a ? -Y * i : Y * i;`

const sha = (s) => createHash('sha256').update(s).digest('hex')

export function applyPatch({ check = false } = {}) {
  if (!existsSync(FILE)) throw new Error(`manim-web dist chunk not found: ${FILE}`)
  const version = JSON.parse(readFileSync(PKG, 'utf8')).version
  if (version !== '0.40.1') throw new Error(`patch targets manim-web 0.40.1, found ${version}`)
  const src = readFileSync(FILE, 'utf8')
  if (src.includes(MARKER)) return 'already-applied'
  if (check) return 'not-applied'
  if (sha(src) !== ORIGINAL_SHA) throw new Error('manim-web dist chunk content differs from the pinned original; refusing to patch')
  const count = src.split(OLD).length - 1
  if (count !== 1) throw new Error(`patch anchor found ${count} times (expected 1)`)
  writeFileSync(FILE, src.replace(OLD, NEW))
  return 'applied'
}

// Compare real paths: through a symlinked path (e.g. /tmp on macOS) argv[1] and import.meta.url differ.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = applyPatch({ check: process.argv.includes('--check') })
  console.log(`manim-web nested-svg patch: ${result}`)
  if (result === 'not-applied') process.exit(1)
}
