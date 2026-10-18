import { describe, expect, it, vi } from 'vitest'
import { isCardViewAction, registerCardViewActions, runCardViewAction } from './card-view-actions'

describe('card view actions', () => {
  it('are the card view shortcuts only, not the app’s', () => {
    for (const action of ['back', 'splitRight', 'splitDown', 'closePane', 'closeCard'] as const) {
      expect(isCardViewAction(action)).toBe(true)
    }
    expect(isCardViewAction('find')).toBe(true)
    // Toggle panel works on the board too, so the app runs it (#57 D4).
    for (const action of ['settings', 'openShell', 'palette', 'togglePanel', null]) {
      expect(isCardViewAction(action)).toBe(false)
    }
  })

  it('run in the view registered last, and nowhere once it is gone', () => {
    const first = vi.fn()
    const second = vi.fn()
    const removeFirst = registerCardViewActions(first)
    const removeSecond = registerCardViewActions(second)
    // A view unmounting after the next one mounted leaves the next one's runner in place.
    removeFirst()
    runCardViewAction('find')
    expect(second).toHaveBeenCalledWith('find')
    expect(first).not.toHaveBeenCalled()
    removeSecond()
    runCardViewAction('back')
    expect(second).toHaveBeenCalledTimes(1)
  })
})
