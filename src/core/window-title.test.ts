import { describe, expect, it } from 'vitest'
import { cardWindowTitle, windowTitle } from './window-title'

describe('windowTitle', () => {
  it('names the open card, then its workspace', () => {
    expect(windowTitle({ name: 'bikube' }, { title: 'Terminal 2' })).toBe('Terminal 2 — bikube')
  })

  it('names the workspace on its board, and the app with none', () => {
    expect(windowTitle({ name: 'bikube' }, null)).toBe('bikube')
    expect(windowTitle(undefined, null)).toBe('Bikube')
  })
})

describe('cardWindowTitle', () => {
  it("names a card window's card, then its workspace (#53 D4)", () => {
    expect(cardWindowTitle({ name: 'bikube' }, { title: 'Agent A' })).toBe('Agent A · bikube')
  })
})
