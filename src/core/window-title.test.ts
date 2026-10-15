import { describe, expect, it } from 'vitest'
import { windowTitle } from './window-title'

describe('windowTitle', () => {
  it('names the open card, then its workspace', () => {
    expect(windowTitle({ name: 'drovr' }, { title: 'Terminal 2' })).toBe('Terminal 2 — drovr')
  })

  it('names the workspace on its board, and the app with none', () => {
    expect(windowTitle({ name: 'drovr' }, null)).toBe('drovr')
    expect(windowTitle(undefined, null)).toBe('Drovr')
  })
})
