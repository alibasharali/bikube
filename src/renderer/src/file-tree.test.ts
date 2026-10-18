import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderStatus } from '../../core/git-status'
import { refreshTree } from './file-tree'

// The Files tab's refresh (#55 D12, AC9) with `window.drovr.files` faked.

/** A status read that ends when the test says so. */
function controlledStatus(): { reads: (() => void)[]; status: () => Promise<FolderStatus> } {
  const reads: (() => void)[] = []
  return {
    reads,
    status: () =>
      new Promise<FolderStatus>((resolve) => {
        reads.push(() => resolve({ ok: true, changes: [] }))
      })
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let n = 0

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('refreshTree', () => {
  it('#55 AC9: a refresh asked for during a read runs once that read ends, never two at once', async () => {
    const { reads, status } = controlledStatus()
    let running = 0
    let most = 0
    const tracked = async (): Promise<FolderStatus> => {
      running++
      most = Math.max(most, running)
      try {
        return await status()
      } finally {
        running--
      }
    }
    vi.stubGlobal('window', {
      drovr: { files: { status: tracked, list: async () => ({ ok: false, reason: 'unreadable' }) } }
    })
    const folder = `/folder-${n++}`
    const first = refreshTree(folder)
    await flush()
    expect(reads).toHaveLength(1)
    // A poll and a Refresh click while the first read runs: one more read, afterwards.
    void refreshTree(folder)
    void refreshTree(folder)
    await flush()
    expect(reads).toHaveLength(1)
    reads[0]!()
    await flush()
    expect(reads).toHaveLength(2)
    reads[1]!()
    await first
    await flush()
    expect(reads).toHaveLength(2)
    expect(most).toBe(1)
  })
})
