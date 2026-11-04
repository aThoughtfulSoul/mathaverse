// In-browser regression checks for the R6 adapter (need DOMParser / WebGL, so not in vitest).
import { svgToVMobjects } from 'manim-web'

/**
 * Patch regression: a MathJax-style stretchy extender inside a nested <svg> viewport with a
 * non-uniform scale(1, 1.41), under the y-flip group MathJax emits. Expected y-range after the patch:
 * the nested viewport [-220, 720] (the path overflows it and is clipped there). Unpatched 0.40.1
 * ignores the viewport and the y-scale and returns [0, 1000].
 */
export function nestedSvgCheck() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -1000 1000 2000"><g transform="scale(1,-1)">
    <svg x="0" y="-220" width="667" height="940" viewBox="0 235 667 940"><path d="M0 0 L100 0 L100 1000 L0 1000 Z" transform="scale(1,1.41)"/></svg>
    <path d="M200 0 L300 0 L300 500 L200 500 Z"/></g></svg>`
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement as unknown as SVGElement
  const group = svgToVMobjects(el, { scale: 1, flipY: false, strokeWidth: 0, fillOpacity: 1 })
  const ranges = group.children.map((c) => {
    const ys = (c as unknown as { getPoints(): number[][] }).getPoints().map((p) => p[1]!)
    return [Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(3))
  })
  const ext = ranges[0]!
  const plain = ranges[1]!
  return {
    pass: ext[0] === -220 && ext[1] === 720 && plain[0] === 0 && plain[1] === 500,
    extender: ext,
    expectedExtender: [-220, 720],
    plainGlyph: plain,
    expectedPlainGlyph: [0, 500],
  }
}
