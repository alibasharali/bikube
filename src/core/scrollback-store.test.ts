import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_KEPT_CHARS } from './kept-output'
import { ScrollbackStore, type ScrollbackFs } from './scrollback-store'

let root: string
let dir: string
let calls: string[]
let store: ScrollbackStore

/** Node's fs, recording the writing calls in order. */
const recordingFs = (): ScrollbackFs => ({
  mkdirSync: (path, options) => {
    calls.push(`mkdir ${path}`)
    return fs.mkdirSync(path, options)
  },
  chmodSync: fs.chmodSync,
  openSync: (path, flags, mode) => {
    calls.push(`open ${path}`)
    return fs.openSync(path, flags, mode)
  },
  writeFileSync: (fd, data, encoding) => {
    calls.push('write')
    fs.writeFileSync(fd, data, encoding)
  },
  fsyncSync: (fd) => {
    calls.push('fsync')
    fs.fsyncSync(fd)
  },
  closeSync: fs.closeSync,
  renameSync: (from, to) => {
    calls.push(`rename ${from} ${to}`)
    fs.renameSync(from, to)
  },
  readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
  statSync: (path) => fs.statSync(path),
  rmSync: (path, options) => fs.rmSync(path, options),
  readdirSync: (path) => fs.readdirSync(path)
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-scrollback-'))
  dir = join(root, 'scrollback')
  calls = []
  store = new ScrollbackStore({ dir, fs: recordingFs(), log: () => {} })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const hash = (id: string): string => createHash('sha256').update(id).digest('hex')

describe('ScrollbackStore (#46 D4)', () => {
  it("saves to the sha256 of the card id, and reads it back with the save's time", () => {
    expect(store.save('card-1', 'hello\r\n')).toBe(true)
    expect(readdirSync(dir)).toEqual([hash('card-1')])
    const read = store.read('card-1')
    expect(read?.data).toBe('hello\r\n')
    expect(read?.savedAt).toBe(statSync(join(dir, hash('card-1'))).mtimeMs)
  })

  it('makes the folder 0700 and each file 0600 (AC10)', () => {
    store.save('card-1', 'x')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, hash('card-1'))).mode & 0o777).toBe(0o600)
  })

  it('writes a temporary file, flushed, then renames it over the save', () => {
    store.save('card-1', 'first')
    store.save('card-1', 'second')
    const file = join(dir, hash('card-1'))
    const tmp = `${file}.tmp`
    expect(calls.slice(-4)).toEqual([`open ${tmp}`, 'write', 'fsync', `rename ${tmp} ${file}`])
    expect(store.read('card-1')?.data).toBe('second')
    expect(readdirSync(dir)).toEqual([hash('card-1')])
  })

  it('refuses a save longer than 1,000,000 characters, keeping the previous one (AC8)', () => {
    store.save('card-1', 'old')
    expect(store.save('card-1', 'x'.repeat(MAX_KEPT_CHARS + 1))).toBe(false)
    expect(store.read('card-1')?.data).toBe('old')
    expect(store.save('card-1', 'x'.repeat(MAX_KEPT_CHARS))).toBe(true)
  })

  it('refuses a card id or data that is not a string, and an empty or overlong id', () => {
    expect(store.save('', 'x')).toBe(false)
    expect(store.save('c'.repeat(101), 'x')).toBe(false)
    expect(store.save(42, 'x')).toBe(false)
    expect(store.save('card-1', 42)).toBe(false)
    expect(store.read(42)).toBeNull()
    expect(calls).toEqual([])
  })

  it('reads null for a card with no save', () => {
    expect(store.read('none')).toBeNull()
  })

  it('reads null for a file too long to be a save', () => {
    fs.mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, hash('card-1')), 'x'.repeat(MAX_KEPT_CHARS + 1))
    expect(store.read('card-1')).toBeNull()
  })

  it('deletes a save, and a missing one quietly (D7)', () => {
    store.save('card-1', 'x')
    store.save('card-2', 'y')
    store.delete('card-1')
    store.delete('card-3')
    expect(readdirSync(dir)).toEqual([hash('card-2')])
    expect(store.read('card-1')).toBeNull()
  })

  it('tightens a folder that already existed with a wider mode', () => {
    fs.mkdirSync(dir, { mode: 0o755 })
    fs.chmodSync(dir, 0o755)
    store.save('card-1', 'x')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('at launch removes every save of a card not kept, and stray temporary files (D7, AC6)', () => {
    store.save('card-1', 'x')
    store.save('card-2', 'y')
    writeFileSync(join(dir, `${hash('card-1')}.tmp`), 'half')
    writeFileSync(join(dir, `${hash('gone')}.tmp`), 'half')
    store.prune(['card-1', 'card-3'])
    expect(readdirSync(dir)).toEqual([hash('card-1')])
    expect(store.read('card-1')?.data).toBe('x')
  })

  it('prunes nothing when the folder does not exist yet', () => {
    store.prune([])
    expect(fs.existsSync(dir)).toBe(false)
  })
})

describe('ScrollbackStore with Keep output off (#46 D8)', () => {
  it('saves nothing and reads nothing while the switch is off, and saves again once on', () => {
    let on = true
    const gated = new ScrollbackStore({ dir, fs: recordingFs(), log: () => {}, keeps: () => on })
    gated.save('card-1', 'before')
    on = false
    expect(gated.save('card-2', 'while off')).toBe(false)
    expect(gated.read('card-1')).toBeNull()
    expect(readdirSync(dir)).toEqual([hash('card-1')])
    on = true
    expect(gated.save('card-2', 'after')).toBe(true)
    expect(gated.read('card-2')?.data).toBe('after')
  })

  it('clears every save and temporary file when the switch turns off', () => {
    store.save('card-1', 'x')
    store.save('card-2', 'y')
    writeFileSync(join(dir, `${hash('card-1')}.tmp`), 'half')
    store.clear()
    expect(readdirSync(dir)).toEqual([])
  })
})
