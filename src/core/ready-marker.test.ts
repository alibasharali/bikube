import { describe, expect, it } from 'vitest'
import { READY_MARKER } from './ssh-command'
import { readyWatcher } from './ready-marker'

describe('readyWatcher (#12 D6)', () => {
  it('is ready on the chunk that completes the marker', () => {
    const seen = readyWatcher()
    expect(seen('Password: ')).toBe(false)
    expect(seen(`\r\nwelcome${READY_MARKER}$ `)).toBe(true)
  })

  it('finds a marker split across chunks, one character at a time too', () => {
    const seen = readyWatcher()
    expect(seen('motd\x1b]6973;bikube')).toBe(false)
    expect(seen('-rea')).toBe(false)
    expect(seen('dy\x07prompt$ ')).toBe(true)

    const bytes = readyWatcher()
    const results = [...`x${READY_MARKER}y`].map((c) => bytes(c))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(results.indexOf(true)).toBe(READY_MARKER.length)
  })

  it('is never ready when the marker never comes', () => {
    const seen = readyWatcher()
    for (const chunk of ['Password:', '\x1b]6973;bikube-rea', 'x\x07', 'Permission denied']) {
      expect(seen(chunk)).toBe(false)
    }
  })

  it('is ready only once, however often the marker appears', () => {
    const seen = readyWatcher()
    expect(seen(READY_MARKER + READY_MARKER)).toBe(true)
    expect(seen(READY_MARKER)).toBe(false)
    expect(seen('\x1b]6973;bikube-')).toBe(false)
    expect(seen('ready\x07')).toBe(false)
  })
})
