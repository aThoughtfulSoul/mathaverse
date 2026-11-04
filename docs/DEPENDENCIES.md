# Pinned dependencies and patch

Recorded 2026-10-27. Exact versions are in `package.json`, with the full tree in `package-lock.json`.
`npm ls three` shows a single deduped `three@0.186.1`.

| Package | Version | Role | Licence |
|---|---|---|---|
| manim-web | 0.40.1 (npm; git `2a1085e8d7b7afdb1d38639fc35f067aeb44548a`, 2026-10-24) | Mobjects, geometry, MathTex, animations | MIT |
| three | 0.186.1 (forced through `overrides`) | Renderer, WebXR, Line2, picking maths | MIT |
| @mathjax/src, @mathjax/mathjax-newcm-font | 4.1.3 (via manim-web) | TeX → SVG for MathTex | Apache-2.0 (npm metadata; check the New Computer Modern font licence before public distribution) |
| earcut, polygon-clipping, katex, opentype.js, typia, … | via manim-web | bundled by manim-web | ISC/MIT |
| iwer | 2.7.0 (dev only; dynamic import, absent from production) | Meta Immersive Web Emulation Runtime | MIT |
| vite / typescript / vitest / @types/three / @types/node | 6.4.5 / 5.8.3 / 3.2.7 / 0.186.0 / 20.19.43 | Build and test | MIT/Apache-2.0 |

Runtime and tooling:
- Node 20.19.5. npm warns that `commander@15` wants Node ≥ 22.12; it is a manim-web tooling dependency that is not shipped.
- `npm audit` was not run as part of this checkpoint.
- **Licences:** this source release includes [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), preserved runtime-package licence texts, and public/third-party-notices.txt. Dependency font assets retain their upstream terms; they are not vendored in this source repository.
- Not used: `@iwsdk/core` (see the compatibility report, F15). A plain three host replaces it.

## Patch: `patches/manim-web-0.40.1-nested-svg.mjs`

- **File changed:** `node_modules/manim-web/dist/src-B3QcbMss.js`, in the bundled
  `src/mobjects/text/svgPathParser.ts` region (minified names `Vm` = `svgToVMobjects` walker, `Hm` = path → VMobject).
- **Precondition:** package version `0.40.1` and file SHA-256
  `4cc4be25ee636dcb27b24cb891473d0f99c621510a7367a2b0545ffa4252d7df`. Otherwise it aborts.
- **Idempotent:** a marker comment records that it has been applied. `npm run patch:check` exits 1 when the patch is missing.
  The CLI compares real paths, so it also runs correctly when invoked through a symlinked path.
- **Applied by:** `postinstall`. With `npm install --ignore-scripts`, run `npm run postinstall` yourself.
  After re-patching, delete `node_modules/.vite`.
- **Behaviour change:**
  1. A nested `<svg>` (depth > 0) with `x/y/width/height` and a `viewBox` maps its children into that viewport, and clamps their points to it. MathJax uses viewport clipping to cut stretchy extenders, which are straight bars, so clamping is exact for them. For arbitrary clipped curves it is an approximation.
  2. `scale(sx, sy)` keeps separate x/y magnitudes. As in the original, the y sign follows sx, because the library treats MathJax glyph data as y-up and ignores the `scale(1,−1)` flip.
  3. The root `<svg>` is unchanged.
- **Regression check:** `__mw.checks.nestedSvg()` in the running app, against synthetic SVG.
  Patched gives extender `[−220, 720]` and a plain glyph `[0, 500]`. Unpatched gives `[0, 1000]`.
- **Upstream source equivalent:** in `walkElement`, track `scaleY` alongside `scale` and handle `tag === 'svg' && depth > 0`
  by composing `translate(x − vx·w/vw, y − vy·h/vh) · scale(w/vw, h/vh)` with a clip box. In
  `pathToVMobject`, take `(scaleX, scaleY, clip)`.

## Build-configuration workaround (not a patch)

`vite.config.ts` aliases `pptxgenjs` to `src/runtime/optionalMissing.ts`, which throws on import. The
manim-web dist contains `await import("pptxgenjs")` inside a try/catch (PPTX export). Vite's dev import
analysis fails on that unresolved bare specifier. The stub makes the import reject, so the library's own catch takes over.

## Bundle (production `npm run build`)

| Chunk | Size | gzip |
|---|---|---|
| `tex-*.js` (manim-web + three + the TeX factory, tree-shaken; chunk named by Rollup after its first importer) | 1.36 MB | 377 KB |
| `MathJaxBundle-*.js` (TeX + all NewCM font ranges) | 11.3 MB | 3.55 MB |
| app + entry | 73 KB | 26 KB |
