import { describe, expect, it } from 'vitest'
import { cardWindowTitle, windowTitle } from './window-title'

describe('windowTitle', () => {
  it('names the open card, then its workspace', () => {
    expect(windowTitle({ name: 'drovr' }, { title: 'Terminal 2' })).toBe('Terminal 2 — drovr')
  })

  it('names the workspace on its board, and the app with none', () => {
    expect(windowTitle({ name: 'drovr' }, null)).toBe('drovr')
    expect(windowTitle(undefined, null)).toBe('Drovr')
  })
})

describe('cardWindowTitle', () => {
  it("names a card window's card, then its workspace (#53 D4)", () => {
    expect(cardWindowTitle({ name: 'drovr' }, { title: 'Agent A' })).toBe('Agent A · drovr')
  })
})
