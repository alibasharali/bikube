import { describe, expect, it } from 'vitest'
import type { ClaudeUsage } from './claude-usage-types'
import { contextLabel, contextUse, formatTokens, hasUsage, usageTooltip } from './usage-format'

// A card's context bar and tooltip (#50).

const usage = (u: Partial<ClaudeUsage>): ClaudeUsage => ({
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  tokens: 0,
  context: 0,
  model: null,
  ...u
})

/** AC1's card: two claude-sonnet-4-5 entries. */
const ac1 = usage({
  input: 1010,
  output: 700,
  cacheWrite: 2000,
  cacheRead: 3000,
  tokens: 6710,
  context: 3010,
  model: 'claude-sonnet-4-5'
})

/** AC4's card: one claude-opus-4-5 entry of a million output tokens. */
const ac4 = usage({ output: 1_000_000, tokens: 1_000_000, model: 'claude-opus-4-5' })

/** AC3's card: one gpt-x entry. */
const ac3 = usage({ input: 1000, output: 1000, tokens: 2000, context: 1000, model: 'gpt-x' })

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [840, '840'],
    [999, '999'],
    [1000, '1k'],
    [3010, '3k'],
    [84_400, '84k'],
    [999_499, '999k'],
    [999_500, '1.0M'],
    [1_000_000, '1.0M'],
    [1_234_567, '1.2M'],
    [12_345_678, '12.3M']
  ])('reads %d as %s', (n, text) => {
    expect(formatTokens(n)).toBe(text)
  })
})

describe('contextUse', () => {
  it("is the context's share of the model's window, labelled as a percentage", () => {
    expect(contextUse(ac1)).toEqual({ used: 3010, window: 200_000, percent: 2, level: 'ok' })
    expect(contextLabel(contextUse(ac1))).toBe('2% context')
    expect(contextUse(ac4).percent).toBe(0)
    const opus = usage({ tokens: 1, context: 750_000, model: 'claude-opus-5-5' })
    expect(contextUse(opus)).toEqual({
      used: 750_000,
      window: 1_000_000,
      percent: 75,
      level: 'high'
    })
  })
})

describe('hasUsage', () => {
  it('is true only above 0 tokens', () => {
    expect(hasUsage(ac1)).toBe(true)
    expect(hasUsage(usage({}))).toBe(false)
    expect(hasUsage(undefined)).toBe(false)
  })
})

describe('usageTooltip', () => {
  it('gives the context of its window, then the full grouped counts and the model', () => {
    expect(usageTooltip(ac1).split('\n')).toEqual([
      'Context 3,010 of 200,000 tokens (2%)',
      'Input 1,010',
      'Output 700',
      'Cache write 2,000',
      'Cache read 3,000',
      'Model claude-sonnet-4-5'
    ])
  })

  it('has no cost line', () => {
    const lines = usageTooltip(ac3).split('\n')
    expect(lines).toContain('Model gpt-x')
    expect(lines.some((l) => l.includes('$') || /cost/i.test(l))).toBe(false)
  })

  it('leaves the model line out when there is no model', () => {
    expect(usageTooltip(usage({ output: 5, tokens: 5 }))).not.toContain('Model')
  })
})
