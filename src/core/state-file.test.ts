import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryWorkspaceStore, type WorkspaceState } from './workspace-store'
import { serializeSavedState } from './saved-state'
import { SAVE_INTERVAL_MS, StateFile, type StateFileFs } from './state-file'

const DIR = '/data'
const FILE = '/data/drovr-state.json'
const TMP = '/data/drovr-state.json.tmp'
const EMPTY: WorkspaceState = { workspaces: [], activeId: null }

/** An in-memory directory that records every write and rename in order. */
class FakeFs implements StateFileFs {
  files = new Map<string, string>()
  ops: string[] = []
  failWrites = false
  failRenamesOf: string | null = null
  readError: string | null = null
  readFileSync(path: string): string {
    if (this.readError && this.files.has(path)) {
      throw Object.assign(new Error(`${this.readError}: ${path}`), { code: this.readError })
    }
    const text = this.files.get(path)
    if (text === undefined) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    }
    return text
  }
  writeFileSync(path: string, data: string): void {
    if (this.failWrites) throw new Error('EIO')
    this.ops.push(`write ${path}`)
    this.files.set(path, data)
  }
  renameSync(from: string, to: string): void {
    if (from === this.failRenamesOf) throw new Error(`EBUSY: ${from}`)
    const text = this.files.get(from)
    if (text === undefined) throw new Error(`ENOENT: ${from}`)
    this.ops.push(`rename ${from} -> ${to}`)
    this.files.delete(from)
    this.files.set(to, text)
  }
}

function stateNamed(...names: string[]): WorkspaceState {
  let n = 0
  const s = new InMemoryWorkspaceStore({
    generateId: () => `id-${++n}`,
    generateSessionId: () => `00000000-0000-4000-8000-00000000000${n}`
  })
  for (const name of names) s.createWorkspace({ name, directory: `/tmp/${name}` })
  return s.getState()
}

let fs: FakeFs
const log = vi.fn()
const now = (): Date => new Date('2026-10-13T14:15:00.123Z')
const open = (): StateFile => new StateFile({ dir: DIR, fs, now, log })

beforeEach(() => {
  fs = new FakeFs()
  log.mockReset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('StateFile.load (#8 D4, AC7)', () => {
  it('gives an empty board and renames nothing when the file is missing', () => {
    expect(open().load()).toEqual(EMPTY)
    expect(fs.ops).toEqual([])
    expect([...fs.files.keys()]).toEqual([])
  })

  it('gives the saved state from a valid file', () => {
    const state = stateNamed('alpha', 'beta')
    fs.files.set(FILE, serializeSavedState(state))
    expect(open().load()).toEqual(state)
    expect(fs.ops).toEqual([])
  })

  it('renames a rejected file aside with a UTC timestamp and gives an empty board', () => {
    fs.files.set(FILE, '{"version": 2, "state": {}}')
    expect(open().load()).toEqual(EMPTY)
    expect(fs.ops).toEqual([`rename ${FILE} -> /data/drovr-state.corrupt-20261013T141500Z.json`])
    expect(fs.files.get('/data/drovr-state.corrupt-20261013T141500Z.json')).toBe(
      '{"version": 2, "state": {}}'
    )
    expect(fs.files.has(FILE)).toBe(false)
  })
})

describe('StateFile.save (#8 D2, D6, AC6)', () => {
  it('coalesces saves within 200 ms into one write of the last, via temp then rename', () => {
    const file = open()
    file.load()
    file.save(stateNamed('a'))
    vi.advanceTimersByTime(50)
    file.save(stateNamed('a', 'b'))
    vi.advanceTimersByTime(50)
    file.save(stateNamed('a', 'b', 'c'))
    vi.advanceTimersByTime(SAVE_INTERVAL_MS - 101)
    expect(fs.ops).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fs.ops).toEqual([`write ${TMP}`, `rename ${TMP} -> ${FILE}`])
    expect(fs.files.get(FILE)).toBe(serializeSavedState(stateNamed('a', 'b', 'c')))
    vi.advanceTimersByTime(1000)
    expect(fs.ops).toHaveLength(2)
  })
})

describe('StateFile.flush (#8 D6)', () => {
  it('writes the pending state at once and cancels the timed write', () => {
    const file = open()
    file.save(stateNamed('a'))
    file.flush()
    expect(fs.ops).toEqual([`write ${TMP}`, `rename ${TMP} -> ${FILE}`])
    expect(fs.files.get(FILE)).toBe(serializeSavedState(stateNamed('a')))
    vi.advanceTimersByTime(1000)
    expect(fs.ops).toHaveLength(2)
  })

  it('writes nothing when nothing is pending', () => {
    const file = open()
    file.load()
    file.flush()
    expect(fs.ops).toEqual([])
  })
})

describe('StateFile edge cases (#8 D3, D5, D6)', () => {
  it('ignores an invalid save: nothing kept, nothing written', () => {
    const file = open()
    const valid = stateNamed('a')
    file.save(valid)
    file.flush()
    expect(file.save({ workspaces: [], activeId: 'nope' })).toBe(false)
    expect(file.save('junk')).toBe(false)
    vi.advanceTimersByTime(1000)
    file.flush()
    expect(fs.ops).toHaveLength(2)
    expect(file.load()).toEqual(valid)
  })

  it('loads the latest saved state, even before it is written', () => {
    const file = open()
    const state = stateNamed('a', 'b')
    file.save(state)
    expect(file.load()).toEqual(state)
    expect(fs.ops).toEqual([])
  })

  it('sets a rejected file aside before a first save overwrites it', () => {
    fs.files.set(FILE, 'not json')
    const file = open()
    file.save(stateNamed('a'))
    file.flush()
    expect(fs.ops[0]).toBe(`rename ${FILE} -> /data/drovr-state.corrupt-20261013T141500Z.json`)
    expect(fs.files.get('/data/drovr-state.corrupt-20261013T141500Z.json')).toBe('not json')
  })

  it('keeps the state pending when a write fails, and the next flush retries', () => {
    const file = open()
    fs.failWrites = true
    file.save(stateNamed('a'))
    expect(() => vi.advanceTimersByTime(SAVE_INTERVAL_MS)).not.toThrow()
    expect(log).toHaveBeenCalled()
    fs.failWrites = false
    file.flush()
    expect(fs.files.get(FILE)).toBe(serializeSavedState(stateNamed('a')))
  })
})

describe('StateFile with an unreadable file (#8 D4)', () => {
  const ASIDE = '/data/drovr-state.corrupt-20261013T141500Z.json'

  it('moves a file it cannot read aside, then saves normally', () => {
    fs.files.set(FILE, 'secret')
    fs.readError = 'EACCES'
    const file = open()
    expect(file.load()).toEqual(EMPTY)
    expect(fs.ops).toEqual([`rename ${FILE} -> ${ASIDE}`])
    expect(fs.files.get(ASIDE)).toBe('secret')
    fs.readError = null
    file.save(stateNamed('a'))
    vi.advanceTimersByTime(SAVE_INTERVAL_MS)
    expect(fs.files.get(FILE)).toBe(serializeSavedState(stateNamed('a')))
  })

  it.each([
    ['unreadable', 'EACCES'],
    ['rejected', null]
  ])('never writes when a %s file cannot be moved aside', (_, readError) => {
    fs.files.set(FILE, 'not json')
    fs.readError = readError
    fs.failRenamesOf = FILE
    const file = open()
    expect(file.load()).toEqual(EMPTY)
    file.save(stateNamed('a'))
    vi.advanceTimersByTime(1000)
    file.save(stateNamed('a', 'b'))
    file.flush()
    expect(fs.ops).toEqual([])
    expect(fs.files.get(FILE)).toBe('not json')
    expect(fs.files.has(TMP)).toBe(false)
  })
})
