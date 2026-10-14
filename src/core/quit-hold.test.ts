import { describe, expect, it } from 'vitest'
import { killAtQuit, quitHold } from './quit-hold'

describe('quitHold (#18 D2, #26 D5)', () => {
  it('lets the first quit through with no live shells and sync idle', () => {
    expect(quitHold({ holds: 0, liveShells: false, syncBusy: false })).toEqual({ hold: false })
  })

  it('holds the first quit for live shells, waiting for them and sync', () => {
    expect(quitHold({ holds: 0, liveShells: true, syncBusy: false })).toEqual({
      hold: true,
      shells: true
    })
  })

  it('holds the first quit while sync is busy, with no live shells', () => {
    expect(quitHold({ holds: 0, liveShells: false, syncBusy: true })).toEqual({
      hold: true,
      shells: false
    })
  })

  it('holds a later quit once more only while sync is busy, never for shells', () => {
    expect(quitHold({ holds: 1, liveShells: true, syncBusy: false })).toEqual({ hold: false })
    expect(quitHold({ holds: 1, liveShells: true, syncBusy: true })).toEqual({
      hold: true,
      shells: false
    })
  })

  it('lets a third quit through whatever is still busy', () => {
    expect(quitHold({ holds: 2, liveShells: true, syncBusy: true })).toEqual({ hold: false })
  })
})

describe('killAtQuit (#26 D5)', () => {
  it('kills the process at quit only while the sync folder is still busy', () => {
    expect(killAtQuit({ syncBusy: true, platform: 'linux' })).toBe(true)
    expect(killAtQuit({ syncBusy: true, platform: 'darwin' })).toBe(true)
    expect(killAtQuit({ syncBusy: false, platform: 'linux' })).toBe(false)
  })

  it('never sends a signal on Windows, where node-pty and process.kill take none (#18)', () => {
    expect(killAtQuit({ syncBusy: true, platform: 'win32' })).toBe(false)
  })
})
