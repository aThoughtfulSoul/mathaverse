// The workspace UI shell (UI-REFINEMENT-SPEC sections 3, 4, 7, 8; docs/UI-SHELL.md): the reusable chrome around the
// mathematics on both surfaces. Both renderers read the shared UiView (src/ui/model.ts) and act only by emitting
// UiCommands; the assistant panel's content is a plug-in hosted inside the shell's inspector frame.
//
//   const desktop = new DesktopShell({ root, stage, dispatch, assistant: createAssistantDomContent(dispatch) })
//   desktop.render(view)                      // every view change
//   const spatial = new SpatialShell({ dispatch, assistant: createAssistantSpatialContent(dispatch) })
//   spatial.mount(workbench); spatial.setVisible(presenting)
//   spatial.render(view); spatial.step(ctx)    // per frame
//   const p = spatial.pick(ray)                // hover: spatial.setHover(p?.id ?? null)
//   if (p) spatial.activate(p)                 // press: shell page turn, or dispatch(p.command)

export { DesktopShell, type DesktopShellOptions } from './desktop'
export { SpatialShell, SPATIAL_LAYOUT, SPATIAL_TYPE, type SpatialShellOptions } from './spatial'
