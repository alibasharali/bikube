import { describe, expect, it } from 'vitest'
import { contextLevel, contextPercent, contextWindow } from './claude-context'

describe('contextWindow', () => {
  it('is 1M for Fable, Mythos, the 5 family and Opus and Sonnet from 4.6', () => {
    for (const model of [
      'claude-fable-5-1',
      'claude-mythos-5-1',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-6',
      'claude-sonnet-5-5',
      'claude-sonnet-4-6',
      'claude-haiku-5-5',
      'claude-sonnet-4-5[1m]'
    ]) {
      expect(contextWindow(model, 1000), model).toBe(1_000_000)
    }
  })

  it('is 200K for older or unknown models and none, unless the context is already past it', () => {
    for (const model of [
      'claude-haiku-4-5',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5',
      'claude-sonnet-4-5-20250929',
      'claude-3-7-sonnet',
      'gpt-x',
      null
    ]) {
      expect(contextWindow(model, 1000), String(model)).toBe(200_000)
    }
    expect(contextWindow('claude-sonnet-4-5', 200_001)).toBe(1_000_000)
  })
})

describe('contextPercent and contextLevel', () => {
  it('rounds to a whole percent, at least 1 above 0 and at most 100', () => {
    expect(contextPercent(0, 200_000)).toBe(0)
    expect(contextPercent(10, 200_000)).toBe(1)
    expect(contextPercent(3010, 200_000)).toBe(2)
    expect(contextPercent(150_000, 200_000)).toBe(75)
    expect(contextPercent(250_000, 200_000)).toBe(100)
  })

  it('reads high from 70% and full from 90%', () => {
    expect(contextLevel(69)).toBe('ok')
    expect(contextLevel(70)).toBe('high')
    expect(contextLevel(89)).toBe('high')
    expect(contextLevel(90)).toBe('full')
  })
})
