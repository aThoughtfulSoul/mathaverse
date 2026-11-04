// Typed input never triggers scene shortcuts (UI-REFINEMENT-SPEC section 11).

import { describe, expect, it } from 'vitest'
import { shortcutBlocked } from '../../src/ui/shortcuts'

const el = (tagName: string, extra: { isContentEditable?: boolean; role?: string } = {}) => ({
  tagName,
  isContentEditable: extra.isContentEditable ?? false,
  getAttribute: (n: string) => (n === 'role' ? extra.role ?? null : null),
})
const key = (k: string, target: unknown) => ({ key: k, code: k === ' ' ? 'Space' : `Key${k.toUpperCase()}`, target })

describe('shortcut gate', () => {
  it('blocks every shortcut while typing in a field', () => {
    for (const t of [el('INPUT'), el('TEXTAREA'), el('SELECT'), el('DIV', { isContentEditable: true })]) {
      for (const k of [' ', 'r', 'z', 'm', 't', 'h']) expect(shortcutBlocked(key(k, t))).toBe(true)
    }
  })
  it('lets a focused button handle Space and Enter itself, but passes letter shortcuts', () => {
    expect(shortcutBlocked(key(' ', el('BUTTON')))).toBe(true)
    expect(shortcutBlocked({ key: 'Enter', code: 'Enter', target: el('DIV', { role: 'button' }) })).toBe(true)
    expect(shortcutBlocked(key('r', el('BUTTON')))).toBe(false)
  })
  it('passes shortcuts on the page itself', () => {
    expect(shortcutBlocked(key(' ', el('BODY')))).toBe(false)
    expect(shortcutBlocked(key('z', el('CANVAS')))).toBe(false)
    expect(shortcutBlocked(key('z', null))).toBe(false)
  })
})
