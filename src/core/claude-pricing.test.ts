import { describe, expect, it } from 'vitest'
import { entryCost, priceFor } from './claude-pricing'

// The built-in price table and an entry's cost (#50 D4).

describe('priceFor', () => {
  it.each([
    ['claude-opus-4-5-20251101', 5, 25],
    ['claude-opus-4-6', 5, 25],
    ['claude-opus-4-9', 5, 25],
    ['claude-opus-5', 5, 25],
    ['claude-opus-5-5', 5, 25],
    ['claude-opus-12', 5, 25],
    ['claude-opus-4-1', 15, 75],
    ['claude-opus-4-20250514', 15, 75],
    ['claude-3-opus-20240229', 15, 75],
    ['claude-sonnet-4-5', 3, 15],
    ['claude-sonnet-4-20250514', 3, 15],
    ['claude-3-7-sonnet-20250219', 3, 15],
    ['claude-3-5-sonnet-20241022', 3, 15],
    ['claude-haiku-4-5-20251001', 1, 5],
    ['claude-haiku-5', 1, 5],
    ['claude-3-5-haiku-20241022', 0.8, 4]
  ])('prices %s at %d in, %d out per million', (model, input, output) => {
    expect(priceFor(model)).toEqual({ input, output })
  })

  it.each(['gpt-x', '<synthetic>', 'claude-haiku-4', 'claude-3-haiku-20240307', 'claude-opus', ''])(
    'knows no price for %j',
    (model) => {
      expect(priceFor(model)).toBeNull()
    }
  )
})

describe('entryCost', () => {
  it('prices cache writes at 1.25x input and cache reads at 0.1x input', () => {
    const cost = entryCost('claude-sonnet-4-5', {
      input: 1000,
      output: 500,
      cacheWrite: 2000,
      cacheRead: 0
    })
    expect(cost).toBeCloseTo(0.003 + 0.0075 + 0.0075, 10)
    expect(
      entryCost('claude-sonnet-4-5', { input: 10, output: 200, cacheWrite: 0, cacheRead: 3000 })
    ).toBeCloseTo(0.00003 + 0.003 + 0.0009, 10)
  })

  it('is null for a model with no price or none at all', () => {
    const counts = { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 }
    expect(entryCost('gpt-x', counts)).toBeNull()
    expect(entryCost(null, counts)).toBeNull()
  })
})
