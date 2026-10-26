import { describe, expect, it } from 'vitest'
import { branchProblem, suggestBranch, titleSlug, worktreeFolder } from './worktree-names'

describe('titleSlug', () => {
  it.each([
    ['Fix the login bug (urgent!)', 'fix-the-login-bug-urgent'],
    ['  Terminal 3  ', 'terminal-3'],
    ['Crème brûlée — v2', 'creme-brulee-v2'],
    ['🚀🚀', 'card'],
    ['', 'card']
  ])('%j → %j', (title, slug) => {
    expect(titleSlug(title)).toBe(slug)
  })

  it('cuts a long title at a dash, to at most 40 characters', () => {
    const slug = titleSlug('Refactor the settings dialog into sections with a list on the left')
    expect(slug).toBe('refactor-the-settings-dialog-into')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(titleSlug('a'.repeat(60))).toHaveLength(40)
  })
})

describe('suggestBranch', () => {
  it('prefixes bikube/ and counts on when the name is taken', () => {
    expect(suggestBranch('Fix login', new Set())).toBe('bikube/fix-login')
    expect(suggestBranch('Fix login', new Set(['bikube/fix-login', 'bikube/fix-login-2']))).toBe(
      'bikube/fix-login-3'
    )
  })
})

describe('branchProblem', () => {
  it.each(['bikube/fix-login', 'feature/a.b_c', 'v2'])('accepts %j', (name) => {
    expect(branchProblem(name)).toBeNull()
  })

  it.each([
    ['', 'Enter a branch name'],
    ['has space', 'Not a valid branch name'],
    ['a..b', 'Not a valid branch name'],
    ['-x', 'Not a valid branch name'],
    ['x/', 'Not a valid branch name'],
    ['x.lock', 'Not a valid branch name'],
    ['a/.hidden', 'Not a valid branch name'],
    ['a~1', 'Not a valid branch name'],
    ['@', 'Not a valid branch name']
  ])('refuses %j', (name, problem) => {
    expect(branchProblem(name)).toBe(problem)
  })
})

describe('worktreeFolder', () => {
  it("is the branch's last part", () => {
    expect(worktreeFolder('bikube/fix-login')).toBe('fix-login')
    expect(worktreeFolder('feature/a b')).toBe('a-b')
  })
})
