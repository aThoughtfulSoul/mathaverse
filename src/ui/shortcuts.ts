// Desktop shortcut gate (UI-REFINEMENT-SPEC section 11: typed input does not trigger scene shortcuts). A key
// pressed while typing in a field, or Space/Enter on a focused button (which activates the button itself),
// never reaches the scene shortcuts.

interface KeyTarget {
  tagName: string
  isContentEditable?: boolean
  getAttribute(name: string): string | null
}

export function shortcutBlocked(e: { code: string; key: string; target: unknown }): boolean {
  const t = e.target as KeyTarget | null
  if (!t || typeof t.tagName !== 'string' || t.tagName === 'BODY' || t.tagName === 'HTML') return false
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true
  return (e.code === 'Space' || e.key === 'Enter') && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button')
}
