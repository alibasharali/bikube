import { describe, expect, it } from 'vitest'
import { SessionOwners } from './session-owners'

describe('SessionOwners', () => {
  const a = { name: 'a' }
  const b = { name: 'b' }

  it('reports only the first session of each owner as new', () => {
    const owners = new SessionOwners<object>()
    expect(owners.add(a, '1')).toBe(true)
    expect(owners.add(a, '2')).toBe(false)
    expect(owners.add(b, '3')).toBe(true)
    expect(owners.ownerOf('2')).toBe(a)
    expect(owners.ownerOf('3')).toBe(b)
  })

  it('lists an owner’s live sessions and drops exited ones', () => {
    const owners = new SessionOwners<object>()
    owners.add(a, '1')
    owners.add(a, '2')
    owners.add(b, '3')
    owners.remove('1')
    expect(owners.sessionsOf(a)).toEqual(['2'])
    expect(owners.ownerOf('1')).toBeUndefined()
    // The owner stays known, so a later session is not reported as new.
    owners.remove('2')
    expect(owners.add(a, '4')).toBe(false)
  })

  it('release returns the owner’s sessions and forgets it', () => {
    const owners = new SessionOwners<object>()
    owners.add(a, '1')
    owners.add(a, '2')
    owners.add(b, '3')
    expect(owners.release(a)).toEqual(['1', '2'])
    expect(owners.ownerOf('1')).toBeUndefined()
    expect(owners.sessionsOf(a)).toEqual([])
    expect(owners.ownerOf('3')).toBe(b)
    expect(owners.add(a, '5')).toBe(true)
  })

  it('ignores unknown ids and owners', () => {
    const owners = new SessionOwners<object>()
    owners.remove('nope')
    expect(owners.release(a)).toEqual([])
    expect(owners.sessionsOf(b)).toEqual([])
  })
})
