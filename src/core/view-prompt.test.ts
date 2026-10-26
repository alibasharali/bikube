import { describe, expect, it } from 'vitest'
import { showViewPrompt } from './view-prompt'

describe('showViewPrompt', () => {
  it('asks only before a view is chosen and while there is no workspace', () => {
    expect(showViewPrompt(false, 0, false)).toBe(true)
    expect(showViewPrompt(true, 0, false)).toBe(false)
    expect(showViewPrompt(false, 1, false)).toBe(false)
  })

  it('never asks when skipped', () => {
    expect(showViewPrompt(false, 0, true)).toBe(false)
  })
})
