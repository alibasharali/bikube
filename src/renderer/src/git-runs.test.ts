import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGitResult, gitRun, runGit, subscribeGitRuns, takeGitResult } from './git-runs'

const { refreshBranch } = vi.hoisted(() => ({ refreshBranch: vi.fn() }))
vi.mock('./branches', () => ({ refreshBranch }))

/** A command that ends when `finish` is called with its result. */
function pending<T>(): { command: () => Promise<T>; finish: (result: T) => void } {
  let finish!: (result: T) => void
  const promise = new Promise<T>((resolve) => {
    finish = resolve
  })
  return { command: () => promise, finish }
}

let n = 0
let dir: string
beforeEach(() => {
  refreshBranch.mockClear()
  dir = `/repo-${n++}`
})

describe('runGit', () => {
  it("keeps a folder's command busy for every reader, and runs no second one meanwhile", async () => {
    const fetch = pending<{ ok: true; note: string }>()
    const changes = vi.fn()
    const unsubscribe = subscribeGitRuns(changes)
    const first = runGit(dir, 'Fetching…', fetch.command)
    expect(gitRun(dir)).toEqual({ busy: 'Fetching…', error: null, note: null })
    expect(gitRun('/elsewhere').busy).toBeNull()
    const second = vi.fn()
    expect(await runGit(dir, 'Pulling…', second)).toBeNull()
    expect(second).not.toHaveBeenCalled()
    fetch.finish({ ok: true, note: 'Fetched' })
    expect(await first).toEqual({ ok: true, note: 'Fetched' })
    expect(gitRun(dir)).toEqual({ busy: null, error: null, note: 'Fetched' })
    expect(refreshBranch).toHaveBeenCalledWith(dir)
    expect(changes).toHaveBeenCalled()
    unsubscribe()
  })

  it("keeps git's refusal as the folder's error until the next command", async () => {
    await runGit(dir, 'Pulling…', async () => ({ ok: false, reason: 'Not possible' }))
    expect(gitRun(dir)).toEqual({ busy: null, error: 'Not possible', note: null })
    await runGit(dir, 'Fetching…', async () => ({ ok: true, note: 'Fetched' }))
    expect(gitRun(dir)).toEqual({ busy: null, error: null, note: 'Fetched' })
    clearGitResult(dir)
    expect(gitRun(dir)).toEqual({ busy: null, error: null, note: null })
  })

  it('leaves a refused name to the caller, and a switch with no note', async () => {
    const named = { ok: false as const, reason: 'Branch already exists', name: true as const }
    expect(await runGit(dir, 'Creating…', async () => named)).toEqual(named)
    expect(gitRun(dir)).toEqual({ busy: null, error: null, note: null })
    expect(await runGit(dir, 'Switching…', async () => ({ ok: true }))).toEqual({ ok: true })
    expect(gitRun(dir)).toEqual({ busy: null, error: null, note: null })
  })

  it('shows a rejected call as the error, and is no longer busy', async () => {
    const result = await runGit(dir, 'Pushing…', () => Promise.reject(new Error('IPC failed')))
    expect(result).toEqual({ ok: false, reason: 'IPC failed' })
    expect(gitRun(dir)).toEqual({ busy: null, error: 'IPC failed', note: null })
    expect(refreshBranch).toHaveBeenCalledWith(dir)
  })
})

describe('takeGitResult', () => {
  it('gives a finished result once, then forgets it', async () => {
    expect(takeGitResult(dir)).toBeNull()
    await runGit(dir, 'Pulling…', async () => ({ ok: false, reason: 'would be overwritten' }))
    expect(takeGitResult(dir)).toEqual({ error: 'would be overwritten', note: null })
    expect(takeGitResult(dir)).toBeNull()
    expect(gitRun(dir)).toEqual({ busy: null, error: null, note: null })
    await runGit(dir, 'Fetching…', async () => ({ ok: true, note: 'Fetched' }))
    expect(takeGitResult(dir)).toEqual({ error: null, note: 'Fetched' })
    expect(takeGitResult(dir)).toBeNull()
  })

  it('gives nothing and keeps the run while a command runs', () => {
    const fetch = pending<{ ok: true; note: string }>()
    void runGit(dir, 'Fetching…', fetch.command)
    expect(takeGitResult(dir)).toBeNull()
    expect(gitRun(dir).busy).toBe('Fetching…')
    fetch.finish({ ok: true, note: 'Fetched' })
  })
})
