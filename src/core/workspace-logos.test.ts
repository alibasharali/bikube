import { describe, expect, it } from 'vitest'
import { WORKSPACE_LOGOS, isWorkspaceLogo } from './workspace-logos'

describe('workspace logos (#59 D1)', () => {
  it('lists 24 distinct kebab-case ids, each with a label', () => {
    expect(WORKSPACE_LOGOS).toHaveLength(24)
    const ids = WORKSPACE_LOGOS.map((l) => l.id)
    expect(new Set(ids).size).toBe(24)
    for (const { id, label } of WORKSPACE_LOGOS) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(label.trim()).not.toBe('')
    }
  })

  it('knows only its own ids', () => {
    expect(isWorkspaceLogo('rocket')).toBe(true)
    expect(isWorkspaceLogo('not-a-logo')).toBe(false)
    expect(isWorkspaceLogo(5)).toBe(false)
  })
})
