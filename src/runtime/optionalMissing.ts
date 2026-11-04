// Resolution target for manim-web's optional, uninstalled dynamic imports (PPTX export via pptxgenjs).
// The library wraps that import in try/catch; rejecting here keeps the feature unavailable instead of
// breaking Vite's import analysis. This is a build-config workaround, not a library patch.
throw new Error('optional dependency is not installed in this prototype')
export {}
