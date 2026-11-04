// Shell command logic (UI-REFINEMENT-SPEC sections 2, 3, 4, 8): disabled entries emit nothing, one popover at a
// time, choosing the active experiment only closes the picker, XR More has no desktop-only file operations,
// keys a control consumes never reach the page shortcuts, the desktop stacks before the stage column gets small
// and keeps the stage row first, and spatial layout helpers never cut content.

import { describe, expect, it } from 'vitest'
import type { MoreView, ToolbarItem, UiView } from '../../../src/ui/model'
import {
  contextCommand, detailActionCommand, hitAt, inspectorWidth, isStacked, moreCommand, moreSections, paginate, pickerCommands, regionPick,
  representationCommand, shellConsumesKey, stackedStageMin, DRAWER_MIN, toolbarCommand, toolbarName, wrapText, type HitRegion,
} from '../../../src/ui/shell/logic'

const item = (id: ToolbarItem['id'], enabled = true): ToolbarItem => ({ id, label: id, ariaLabel: id, enabled, active: false, reason: enabled ? undefined : 'Nothing to do yet' })
const pv = (popover: UiView['popover']) => ({ popover })

describe('toolbar commands', () => {
  it('a disabled entry emits no command, whatever it is', () => {
    for (const id of ['experiments', 'assistant', 'play', 'replay', 'undo', 'more'] as const) expect(toolbarCommand(pv(null), item(id, false))).toBeNull()
  })

  it('maps each enabled entry to its single meaning', () => {
    expect(toolbarCommand(pv(null), item('play'))).toEqual({ kind: 'playPause' })
    expect(toolbarCommand(pv(null), item('replay'))).toEqual({ kind: 'replay' })
    expect(toolbarCommand(pv(null), item('undo'))).toEqual({ kind: 'undo' })
    expect(toolbarCommand(pv(null), item('assistant'))).toEqual({ kind: 'inspector', which: 'assistant' })
  })

  it('keeps only one popover: opening one replaces the other, pressing the open one closes it', () => {
    expect(toolbarCommand(pv(null), item('experiments'))).toEqual({ kind: 'popover', which: 'experiments' })
    expect(toolbarCommand(pv('more'), item('experiments'))).toEqual({ kind: 'popover', which: 'experiments' })
    expect(toolbarCommand(pv('experiments'), item('more'))).toEqual({ kind: 'popover', which: 'more' })
    expect(toolbarCommand(pv('experiments'), item('experiments'))).toEqual({ kind: 'popover', which: null })
    expect(toolbarCommand(pv('more'), item('more'))).toEqual({ kind: 'popover', which: null })
  })

  it('names the assistant entry exactly, whatever the view says', () => {
    expect(toolbarName({ ...item('assistant'), ariaLabel: 'Ask AI' })).toBe('Ask Meta Muse AI')
  })
})

describe('experiment picker', () => {
  const v = { experiment: { kind: 'sculpture' as const, question: '', subtitle: { plain: '' } } }
  it('choosing the active experiment only closes the picker', () => {
    expect(pickerCommands(v, 'sculpture')).toEqual([{ kind: 'popover', which: null }])
  })
  it('choosing another experiment selects it and closes the picker', () => {
    expect(pickerCommands(v, 'braid')).toEqual([{ kind: 'experiment', demo: 'braid' }, { kind: 'popover', which: null }])
  })
})

describe('context, detail and More entries', () => {
  it('disabled entries emit nothing; enabled ones refer to their ID', () => {
    expect(contextCommand({ id: 'apply', enabled: false })).toBeNull()
    expect(contextCommand({ id: 'apply', enabled: true })).toEqual({ kind: 'context', id: 'apply' })
    const action = { kind: 'action' as const, id: 'check', label: { plain: 'Check' }, run: { kind: 'none' as const } }
    expect(detailActionCommand({ ...action, enabled: false })).toBeNull()
    expect(detailActionCommand({ ...action, enabled: true })).toEqual({ kind: 'context', id: 'check' })
    expect(moreCommand({ id: 'save', label: 'Save workspace', enabled: false, reason: 'x' })).toBeNull()
    expect(moreCommand({ id: 'reset:group', label: 'Reset experiment', enabled: true })).toEqual({ kind: 'more', id: 'reset:group' })
  })

  it('XR More has no file operations, session entry or representation editor; empty sections disappear', () => {
    const more: MoreView = {
      sections: [
        { id: 'workspace', title: 'Workspace', items: [{ id: 'save', label: 'Save', enabled: true }, { id: 'export', label: 'Export', enabled: true }, { id: 'import', label: 'Import', enabled: true }] },
        { id: 'representation', title: 'Representation', items: [{ id: 'saveRepresentation', label: 'Save representation…', enabled: false }] },
        { id: 'session', title: 'Session', items: [{ id: 'enterVR', label: 'Enter VR', enabled: true }, { id: 'exitSession', label: 'Exit VR', enabled: true }] },
      ],
      representation: null,
      notice: null,
    }
    const xr = moreSections(more, 'xr')
    expect(xr.map((s) => s.id)).toEqual(['workspace', 'session'])
    expect(xr.flatMap((s) => s.items.map((i) => i.id))).toEqual(['save', 'exitSession'])
    expect(moreSections(more, 'desktop').flatMap((s) => s.items).length).toBe(6)
  })

  it('a representation needs at least one operation', () => {
    expect(representationCommand([{ kind: 'a', on: false }])).toBeNull()
    expect(representationCommand([{ kind: 'a', on: true }, { kind: 'b', on: false }, { kind: 'c', on: true }])).toEqual({ kind: 'saveRepresentation', operations: ['a', 'c'] })
  })
})

describe('keyboard', () => {
  const t = (tagName: string, extra: { type?: string; role?: string; isContentEditable?: boolean } = {}) => ({ tagName, ...extra })
  it('typing in a field never reaches page shortcuts', () => {
    for (const k of [' ', 'r', 'z', 't', 'Enter', 'Escape']) {
      expect(shellConsumesKey(k, t('INPUT', { type: 'text' }))).toBe(true)
      expect(shellConsumesKey(k, t('TEXTAREA'))).toBe(true)
      expect(shellConsumesKey(k, t('DIV', { isContentEditable: true }))).toBe(true)
    }
  })
  it('a focused button keeps Space and Enter, but letter shortcuts pass', () => {
    expect(shellConsumesKey(' ', t('BUTTON'))).toBe(true)
    expect(shellConsumesKey('Enter', t('BUTTON'))).toBe(true)
    expect(shellConsumesKey(' ', t('INPUT', { type: 'checkbox' }))).toBe(true)
    expect(shellConsumesKey('r', t('BUTTON'))).toBe(false)
    expect(shellConsumesKey(' ', t('DIV'))).toBe(false)
    expect(shellConsumesKey(' ', null)).toBe(false)
  })
})

describe('desktop layout', () => {
  it('the side inspector follows its CSS clamp at any window width', () => {
    expect([1000, 1500, 2000].map(inspectorWidth)).toEqual([340, 390, 420])
  })

  it('stacks below 900 px, and when an open inspector would leave the stage column under 640 px', () => {
    expect(isStacked(820, false)).toBe(true)
    expect(isStacked(1180, false)).toBe(false)
    // 960 - 340 = 620 px beside the inspector: stacked; 1000 - 340 = 660: the inspector stays a side column, so the
    // assistant panel keeps its whole height.
    expect(isStacked(960, true)).toBe(true)
    expect(isStacked(1000, true)).toBe(false)
    expect(isStacked(1180, true)).toBe(false)
    expect(isStacked(1600, true)).toBe(false)
  })

  it('stacked: the stage keeps up to 40 % of the height, an open drawer its working minimum; the toolbar never falls off', () => {
    // 820 x 1100 with 570 px of question, actions and toolbar: the open drawer keeps 240 px, the stage 290 px.
    expect(stackedStageMin(1100, 570, true)).toBe(290)
    expect(stackedStageMin(1100, 570, false)).toBe(440)
    // 820 x 800 with a tall context card (487 px): the stage is at its floor, the drawer gets the rest and scrolls.
    expect(stackedStageMin(800, 487, true)).toBe(150)
    expect(stackedStageMin(800, 487, false)).toBe(313)
    // Whenever the stage is above its 150 px floor, the stage, the other rows and the open drawer's minimum fit.
    for (const [H, chrome] of [[700, 300], [800, 300], [900, 300], [1100, 570]] as const) {
      const min = stackedStageMin(H, chrome, true)
      expect(min > 150 ? min + chrome + Math.min(DRAWER_MIN, 0.45 * H) <= H + 0.5 : true).toBe(true)
      expect(min).toBeLessThanOrEqual(Math.round(0.4 * H))
    }
    expect(stackedStageMin(700, 600, true)).toBe(150)
  })
})

describe('spatial layout helpers', () => {
  const measure = (s: string) => s.length
  it('wraps without cutting a word longer than the line', () => {
    expect(wrapText('Ask Meta Muse AI', 8, measure)).toEqual(['Ask Meta', 'Muse AI'])
    expect(wrapText('supercalifragilistic word', 5, measure)).toEqual(['supercalifragilistic', 'word'])
  })
  it('pages blocks without splitting one, keeping a section heading with its first item', () => {
    const pages = paginate([{ height: 3 }, { height: 1, keepWithNext: true }, { height: 3 }, { height: 9 }], 5)
    expect(pages).toEqual([[0], [1, 2], [3]])
    expect(pages.flat()).toEqual([0, 1, 2, 3])
  })
  it('a disabled region is hover-only and says why', () => {
    const r: HitRegion = { id: 'shell:tb:play', x: 0, y: 0, w: 1, h: 1, r: 0, enabled: false, command: { kind: 'playPause' }, hint: 'Nothing to play yet' }
    expect(regionPick(r, 0.8)).toEqual({ id: 'shell:tb:play', distance: 0.8, command: null, hint: 'Nothing to play yet' })
    expect(regionPick({ ...r, enabled: true, hint: undefined }, 0.8).command).toEqual({ kind: 'playPause' })
    expect(hitAt([r], 2, 2)).toBeNull()
    expect(hitAt([r], 0.5, 0.5)).toBe(r)
  })
})
