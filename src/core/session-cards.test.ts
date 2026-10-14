import { describe, expect, it } from 'vitest'
import { SessionCards } from './session-cards'

describe('SessionCards', () => {
  it('finds the session running a card (#9 D3)', () => {
    const cards = new SessionCards()
    cards.add('s1', 'c1')
    cards.add('s2', 'c2')
    expect(cards.sessionOf('c1')).toBe('s1')
    expect(cards.sessionOf('c2')).toBe('s2')
    expect(cards.sessionOf('c3')).toBeUndefined()
  })

  it('forgets a card once its session is removed', () => {
    const cards = new SessionCards()
    cards.add('s1', 'c1')
    cards.remove('s1')
    expect(cards.sessionOf('c1')).toBeUndefined()
  })

  it("keeps a card's newer session when an older one for it ends", () => {
    const cards = new SessionCards()
    cards.add('s1', 'c1')
    cards.add('s2', 'c1')
    cards.remove('s1')
    expect(cards.sessionOf('c1')).toBe('s2')
    cards.remove('s2')
    expect(cards.sessionOf('c1')).toBeUndefined()
  })

  it('ignores an unknown session', () => {
    const cards = new SessionCards()
    cards.add('s1', 'c1')
    cards.remove('nope')
    expect(cards.sessionOf('c1')).toBe('s1')
  })

  it('keeps a card live while any of its sessions is, e.g. its main pane after an extra one closes (#11 D8)', () => {
    const cards = new SessionCards()
    cards.add('main', 'c1')
    cards.add('extra', 'c1')
    cards.remove('extra')
    expect(cards.sessionOf('c1')).toBe('main')
    cards.remove('main')
    expect(cards.sessionOf('c1')).toBeUndefined()
  })
})
