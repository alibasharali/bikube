import { describe, expect, it } from 'vitest'
import { syncStatusText } from './sync-status'

describe('the sync status line (#13 D13)', () => {
  it('shows Synced with the local 24-hour time of the last read or write', () => {
    const at = new Date(2026, 9, 14, 7, 5, 59)
    expect(syncStatusText({ kind: 'synced', folder: '/f', at: at.toISOString() })).toBe(
      'Synced 07:05'
    )
    const evening = new Date(2026, 9, 14, 21, 40)
    expect(syncStatusText({ kind: 'synced', folder: '/f', at: evening.toISOString() })).toBe(
      'Synced 21:40'
    )
  })

  it('names the failures, and shows nothing when sync is off', () => {
    expect(syncStatusText({ kind: 'unavailable', folder: '/f' })).toBe('Sync folder unavailable')
    expect(syncStatusText({ kind: 'unreadable', folder: '/f' })).toBe('Sync file unreadable')
    expect(syncStatusText({ kind: 'off' })).toBeNull()
  })
})
