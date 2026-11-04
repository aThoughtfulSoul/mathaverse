// Harness-only stand-ins for the assistant plug-ins, used when src/ui/assistant/index.ts is absent. They show
// the frame's content area and say plainly that they are stubs; they never imitate assistant answers.

import type { Ray } from 'three'
import type { AssistantPanelInput, DomPanelContent, SpatialPanelContent, SpatialPick } from '../model'
import { CanvasPanel } from './panel'

export function createStubDomContent(): DomPanelContent {
  let el: HTMLElement | null = null
  return {
    mount(container) {
      el = document.createElement('div')
      el.style.cssText = 'padding:14px 16px;border:1px dashed rgba(160,178,214,0.3);border-radius:12px;color:#b0b8c8;font-size:14px;line-height:1.45'
      container.appendChild(el)
    },
    render(input: AssistantPanelInput) {
      if (el) el.textContent = `Stub content (harness): the assistant track's plug-in renders here. Panel ${input.open ? 'open' : 'closed'}; assistant ${input.assistant.kind}.`
    },
    dispose() {
      el?.remove()
      el = null
    },
  }
}

export function createStubSpatialContent(): SpatialPanelContent {
  const panel = new CanvasPanel('stub:assistant')
  let drawn = false
  return {
    width: 0.42,
    height: 0.36,
    mount(parent) {
      parent.add(panel.group)
    },
    render() {
      if (drawn) return
      drawn = true
      const p = panel.begin(0.42, 0.36)
      p.rrect(0.001, 0.001, 0.418, 0.358, 0.012, 'rgba(255,255,255,0.02)', 'rgba(160,178,214,0.3)', 0.001)
      p.text('Stub content (harness)', 0.02, 0.04, 0.017, '#b0b8c8', { weight: 600 })
      p.text('The assistant plug-in renders here.', 0.02, 0.075, 0.015, '#8a94a8')
      panel.end()
      panel.setShown(true)
    },
    step() {},
    pick(_ray: Ray): SpatialPick | null {
      return null
    },
    setHover() {},
    setVisible(v) {
      panel.group.visible = v
    },
    dispose() {
      panel.dispose()
    },
  }
}
