import { describe, expect, it } from 'vitest'
import { promptJumpTarget } from './prompt-jumps'

// 3 prompts each followed by 100 lines, then the current prompt; 24 rows shown, at the bottom.
const prompts = [0, 101, 202, 303]
const bottom = 303 - 23 + 5

describe('promptJumpTarget (#45 D5, AC6)', () => {
  it('Previous takes the last prompt above the top of the viewport', () => {
    expect(promptJumpTarget('previous', prompts, bottom, bottom)).toBe(202)
    expect(promptJumpTarget('previous', prompts, 202, bottom)).toBe(101)
    expect(promptJumpTarget('previous', prompts, 101, bottom)).toBe(0)
    expect(promptJumpTarget('previous', prompts, 150, bottom)).toBe(101)
  })

  it('Previous does nothing with no prompt above the top', () => {
    expect(promptJumpTarget('previous', prompts, 0, bottom)).toBeNull()
    expect(promptJumpTarget('previous', [], bottom, bottom)).toBeNull()
  })

  it('Next takes the first prompt below the top, else the bottom', () => {
    expect(promptJumpTarget('next', prompts, 101, bottom)).toBe(202)
    expect(promptJumpTarget('next', prompts, 150, bottom)).toBe(202)
    // The current prompt is on the last screen: it can't be the top row, so the bottom.
    expect(promptJumpTarget('next', prompts, 202, bottom)).toBe(bottom)
    expect(promptJumpTarget('next', [0, 101], 101, bottom)).toBe(bottom)
    expect(promptJumpTarget('next', [], 0, bottom)).toBe(bottom)
  })

  it('takes rows in any order, two prompts on one row as one', () => {
    expect(promptJumpTarget('previous', [202, 0, 101, 101], bottom, bottom)).toBe(202)
    expect(promptJumpTarget('previous', [202, 202, 101], 202, bottom)).toBe(101)
    expect(promptJumpTarget('next', [202, 101, 101], 101, bottom)).toBe(202)
  })
})
