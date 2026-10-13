import { describe, expect, it } from 'vitest'
import { PageGenerations } from './page-generations'

describe('PageGenerations', () => {
  const a = { name: 'a' }
  const b = { name: 'b' }

  it('reports only the first contact with each owner as new', () => {
    const pages = new PageGenerations<object>()
    expect(pages.track(a)).toBe(true)
    expect(pages.track(a)).toBe(false)
    expect(pages.track(b)).toBe(true)
  })

  it('a snapshot stays current until the owner loads a new page', () => {
    const pages = new PageGenerations<object>()
    pages.track(a)
    pages.track(b)
    const samePage = pages.snapshot(a)
    expect(samePage()).toBe(true)
    pages.bump(b)
    expect(samePage()).toBe(true)
    pages.bump(a)
    expect(samePage()).toBe(false)
    expect(pages.snapshot(a)()).toBe(true)
  })

  it('a released owner leaves its snapshots stale', () => {
    const pages = new PageGenerations<object>()
    pages.track(a)
    const samePage = pages.snapshot(a)
    pages.release(a)
    expect(samePage()).toBe(false)
    expect(pages.track(a)).toBe(true)
    expect(samePage()).toBe(false)
  })
})
