import { describe, expect, it } from 'vitest'
import type { ClaudeUsage } from './claude-pricing'
import {
  formatCost,
  formatTokens,
  hasUsage,
  usageLine,
  usageTooltip,
  workspaceUsage
} from './usage-format'

// A card's usage line and tooltip (#50 D8) and a workspace's total (D9).

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
  model: 'claude-sonnet-4-5',
  cost: 0.02193
})

/** AC4's card: one claude-opus-4-5 entry of a million output tokens. */
const ac4 = usage({ output: 1_000_000, tokens: 1_000_000, model: 'claude-opus-4-5', cost: 25 })

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

describe('formatCost', () => {
  it.each([
    [0.02193, '≈$0.02'],
    [1.24, '≈$1.24'],
    [25, '≈$25.00'],
    [1204.5, '≈$1,204.50'],
    [0.01, '≈$0.01'],
    [0.0099, '<$0.01'],
    [0, '<$0.01']
  ])('reads %d as %s', (cost, text) => {
    expect(formatCost(cost)).toBe(text)
  })
})

describe('usageLine', () => {
  it('shows the cost and context', () => {
    expect(usageLine(ac1)).toBe('≈$0.02 · 3k ctx')
    expect(usageLine(ac4)).toBe('≈$25.00 · 0 ctx')
  })

  it('shows the tokens when the cost is unknown', () => {
    expect(usageLine(ac3)).toBe('2k tokens · 1k ctx')
  })
})

describe('hasUsage', () => {
  it('is true only above 0 tokens', () => {
    expect(hasUsage(ac1)).toBe(true)
    expect(hasUsage(usage({ cost: 0 }))).toBe(false)
    expect(hasUsage(undefined)).toBe(false)
  })
})

describe('usageTooltip', () => {
  it('lists the full grouped counts and the model', () => {
    expect(usageTooltip(ac1).split('\n')).toEqual([
      'Claude Code usage (estimate)',
      'Input 1,010',
      'Output 700',
      'Cache write 2,000',
      'Cache read 3,000',
      'Context 3,010',
      'Model claude-sonnet-4-5'
    ])
  })

  it('has no cost line, also when the cost is unknown', () => {
    const lines = usageTooltip(ac3).split('\n')
    expect(lines).toContain('Model gpt-x')
    expect(lines.some((l) => l.includes('$') || /cost/i.test(l))).toBe(false)
  })

  it('leaves the model line out when there is no model', () => {
    expect(usageTooltip(usage({ output: 5, tokens: 5 }))).not.toContain('Model')
  })
})

describe('workspaceUsage', () => {
  it('sums the known costs of the cards with usage', () => {
    expect(workspaceUsage([ac1, ac4, usage({}), undefined])).toEqual({
      text: '≈$25.02',
      tooltip: [
        "Claude Code usage of this workspace's cards (estimate)",
        'Cards 2',
        'Tokens 1,006,710'
      ].join('\n')
    })
  })

  it("says when some cards' cost is unknown", () => {
    const total = workspaceUsage([ac1, ac3])
    expect(total?.text).toBe('≈$0.02')
    expect(total?.tooltip.split('\n')).toEqual([
      "Claude Code usage of this workspace's cards (estimate)",
      'Cards 2',
      'Tokens 8,710',
      "Some cards' cost unknown"
    ])
  })

  it('sums tokens when no card has a cost', () => {
    expect(workspaceUsage([ac3, ac3])?.text).toBe('4k tokens')
  })

  it('is null when no card has usage', () => {
    expect(workspaceUsage([])).toBeNull()
    expect(workspaceUsage([usage({}), undefined])).toBeNull()
  })
})
