import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dirname } from 'node:path'
import { SYNC_WRITE_DELAY_MS, SyncFolder, type SyncFolderFs } from './sync-folder'
import type { SyncStatus } from './sync-status'
import type { Workspace, WorkspaceState } from './workspace-store'

const HOME = '/home/me'
const F = '/sync'
const FILE = '/sync/drovr-board.json'
const TMP = '/sync/drovr-board.json.tmp'
const NOW = new Date(Date.UTC(2026, 9, 14, 9, 5, 0))

/** An in-memory directory that records every call that changes it, in order. */
class FakeFs implements SyncFolderFs {
  files = new Map<string, string>()
  /** The directories that exist; removing F (and its files) is `removeFolder`. */
  dirs = new Set([F])
  events: string[] = []
  failWrites = false
  readError: string | null = null
  private open = new Map<number, string>()
  private nextFd = 3
  readFileSync(path: string): string {
    if (this.readError) throw Object.assign(new Error(this.readError), { code: this.readError })
    const text = this.files.get(path)
    if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return text
  }
  statSync(path: string): { isDirectory(): boolean } {
    if (this.dirs.has(path)) return { isDirectory: () => true }
    if (this.files.has(path)) return { isDirectory: () => false }
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  }
  removeFolder(): void {
    this.dirs.delete(F)
    for (const path of [...this.files.keys()]) if (dirname(path) === F) this.files.delete(path)
  }
  openSync(path: string): number {
    if (this.failWrites || !this.dirs.has(dirname(path)))
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const fd = this.nextFd++
    this.open.set(fd, path)
    this.files.set(path, '')
    this.events.push(`open ${path}`)
    return fd
  }
  writeFileSync(fd: number, data: string): void {
    const path = this.open.get(fd)!
    this.events.push(`write ${path}`)
    this.files.set(path, data)
  }
  fsyncSync(fd: number): void {
    this.events.push(`fsync ${this.open.get(fd)}`)
  }
  closeSync(fd: number): void {
    this.events.push(`close ${this.open.get(fd)}`)
    this.open.delete(fd)
  }
  renameSync(from: string, to: string): void {
    const text = this.files.get(from)
    if (text === undefined) throw new Error(`ENOENT: ${from}`)
    this.events.push(`rename ${from} -> ${to}`)
    this.files.delete(from)
    this.files.set(to, text)
  }
}

function workspace(id: string, name: string, over: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name,
    directory: `${HOME}/${name}`,
    columns: [{ id: `${id}-backlog`, name: 'Backlog' }],
    cards: [],
    nextCardNumber: 1,
    defaultStartup: { kind: 'shell' },
    ...over
  }
}

const state = (...workspaces: Workspace[]): WorkspaceState => ({
  workspaces,
  activeId: workspaces[0]?.id ?? null
})

let fs: FakeFs
let statuses: SyncStatus[]
const log = vi.fn()
const open = (): SyncFolder =>
  new SyncFolder({ fs, home: HOME, now: () => NOW, log, onStatus: (s) => statuses.push(s) })

const written = (): { version: number; savedAt: string; board: { workspaces: Workspace[] } } =>
  JSON.parse(fs.files.get(FILE)!)
const writes = (): number => fs.events.filter((e) => e === `rename ${TMP} -> ${FILE}`).length

beforeEach(() => {
  fs = new FakeFs()
  statuses = []
  log.mockReset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('turning sync on with an empty folder (#13 D9, AC1)', () => {
  it("writes this machine's board atomically and reports synced", () => {
    const sync = open()
    expect(sync.status()).toEqual({ kind: 'off' })
    const api = workspace('api', 'api')
    expect(sync.setFolder(F, state(api))).toBeNull()
    expect(fs.events).toEqual([
      `open ${TMP}`,
      `write ${TMP}`,
      `fsync ${TMP}`,
      `close ${TMP}`,
      `rename ${TMP} -> ${FILE}`
    ])
    expect(written()).toEqual({
      version: 1,
      savedAt: NOW.toISOString(),
      board: { workspaces: [{ ...api, directory: '~/api' }] }
    })
    const synced = { kind: 'synced', folder: F, at: NOW.toISOString() }
    expect(sync.status()).toEqual(synced)
    expect(statuses).toEqual([synced])
  })
})

describe('writing board changes (#13 D4)', () => {
  it('writes a changed board within the delay, once for a burst of saves, as the last one', () => {
    const sync = open()
    const api = workspace('api', 'api')
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'api1' }))
    sync.noteBoard(state({ ...api, name: 'api2' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS - 1)
    expect(writes()).toBe(1)
    vi.advanceTimersByTime(1)
    expect(writes()).toBe(2)
    expect(written().board.workspaces[0].name).toBe('api2')
  })

  it('does not write a board equal to the last one, whatever the active workspace', () => {
    const sync = open()
    const api = workspace('api', 'api')
    const web = workspace('web', 'web')
    sync.setFolder(F, state(api, web))
    sync.noteBoard({ workspaces: [api, web], activeId: 'web' })
    sync.noteBoard({ workspaces: [api, { ...web }], activeId: 'api' })
    vi.advanceTimersByTime(1000)
    expect(writes()).toBe(1)
  })

  it('does not write a change undone before the timer fires', () => {
    const sync = open()
    const api = workspace('api', 'api')
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'other' }))
    sync.noteBoard(state(api))
    vi.advanceTimersByTime(1000)
    expect(writes()).toBe(1)
  })

  it('flush writes a pending board at once', () => {
    const sync = open()
    const api = workspace('api', 'api')
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'api1' }))
    sync.flush()
    expect(written().board.workspaces[0].name).toBe('api1')
    vi.advanceTimersByTime(1000)
    expect(writes()).toBe(2)
  })

  it('writes nothing while sync is off', () => {
    const sync = open()
    sync.noteBoard(state(workspace('api', 'api')))
    vi.advanceTimersByTime(1000)
    sync.flush()
    expect(fs.events).toEqual([])
  })

  it('reports the folder unavailable when a write fails', () => {
    const sync = open()
    fs.failWrites = true
    sync.setFolder(F, state(workspace('api', 'api')))
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
    expect(log).toHaveBeenCalled()
  })
})

describe('turning sync on with a board in the folder (#13 D9, AC3)', () => {
  const api = workspace('api', 'api')
  const web = workspace('web', 'web')
  const fileWithApi = (): void => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW })
    other.setFolder(F, state({ ...api, directory: '/home/other/api' }))
    fs.events = []
  }

  it("returns the file's workspaces then this machine's, and writes that board", () => {
    fileWithApi()
    const sync = open()
    const joined = sync.setFolder(F, { workspaces: [web], activeId: 'web' })
    expect(joined).toEqual([api, web])
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'web'])
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
  })

  it('then writes nothing more when the renderer saves the joined board', () => {
    fileWithApi()
    const sync = open()
    sync.setFolder(F, { workspaces: [web], activeId: 'web' })
    sync.noteBoard({ workspaces: [api, web], activeId: 'web' })
    vi.advanceTimersByTime(1000)
    expect(writes()).toBe(1)
  })

  it('writes nothing when the file already holds the joined board', () => {
    fileWithApi()
    const sync = open()
    expect(sync.setFolder(F, state(api))).toEqual([api])
    expect(fs.events).toEqual([])
    expect(sync.status().kind).toBe('synced')
  })

  it('setting the same folder again changes nothing', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.events = []
    expect(sync.setFolder(F, state(api, web))).toBeNull()
    expect(fs.events).toEqual([])
  })

  it('neither joins nor overwrites an unreadable file (D12)', () => {
    fs.files.set(FILE, 'not json')
    const sync = open()
    expect(sync.setFolder(F, state(web))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
    sync.noteBoard(state({ ...web, name: 'web2' }))
    vi.advanceTimersByTime(1000)
    sync.flush()
    expect(fs.files.get(FILE)).toBe('not json')
    expect(fs.events).toEqual([])
  })

  it('reports the folder unavailable when the file cannot be read', () => {
    fs.readError = 'EACCES'
    const sync = open()
    expect(sync.setFolder(F, state(web))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
  })
})

describe('turning sync off (#13 D10, AC11)', () => {
  it('reports off, drops a pending write and writes no later change', () => {
    const sync = open()
    const api = workspace('api', 'api')
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'pending' }))
    expect(sync.setFolder(null, state(api))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'off' })
    expect(statuses.at(-1)).toEqual({ kind: 'off' })
    sync.noteBoard(state({ ...api, name: 'later' }))
    vi.advanceTimersByTime(1000)
    sync.flush()
    expect(writes()).toBe(1)
    expect(written().board.workspaces[0].name).toBe('api')
  })
})

describe('at launch with sync on (#13 AC12)', () => {
  it('reports synced after reading a valid file, and writes only a changed board', () => {
    const api = workspace('api', 'api')
    open().setFolder(F, state(api))
    fs.events = []
    const sync = open()
    sync.start(F, state(api))
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
    expect(fs.events).toEqual([])
    sync.noteBoard(state(api))
    vi.advanceTimersByTime(1000)
    expect(fs.events).toEqual([])
    sync.noteBoard(state({ ...api, name: 'api2' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces[0].name).toBe('api2')
  })

  it("writes this machine's board when the folder has no file", () => {
    const sync = open()
    sync.start(F, state(workspace('api', 'api')))
    expect(writes()).toBe(1)
    expect(sync.status().kind).toBe('synced')
  })

  it('stays off with no folder', () => {
    const sync = open()
    sync.start(null, state(workspace('api', 'api')))
    expect(sync.status()).toEqual({ kind: 'off' })
    expect(fs.events).toEqual([])
  })
})

describe('reading the file at launch (#13 D11, AC8)', () => {
  it("returns the file's board to apply, compared with nothing", () => {
    const api = workspace('api', 'api')
    open().setFolder(F, state({ ...api, name: 'y' }))
    const sync = open()
    expect(sync.start(F, state({ ...api, name: 'x' }))).toEqual([{ ...api, name: 'y' }])
  })

  it('returns nothing to apply with no file or no folder', () => {
    expect(open().start(F, state(workspace('api', 'api')))).toBeNull()
    expect(open().start(null, state(workspace('api', 'api')))).toBeNull()
  })
})

describe('reading changes live (#13 D4, D7, D11, AC2, AC13)', () => {
  const api = workspace('api', 'api')
  /** Another machine, with its own home, writing `workspaces` to the shared folder. */
  const otherWrites = (...workspaces: Workspace[]): void => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW })
    other.start(F, state())
    other.noteBoard(
      state(
        ...workspaces.map((w) => ({ ...w, directory: w.directory.replace(HOME, '/home/other') }))
      )
    )
    other.flush()
  }

  it("returns another machine's board once, then nothing until it changes again", () => {
    const sync = open()
    sync.setFolder(F, state(api))
    otherWrites({ ...api, name: 'api2' })
    expect(sync.read()).toEqual([{ ...api, name: 'api2' }])
    expect(sync.read()).toBeNull()
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
  })

  it('returns nothing for the board this machine wrote itself', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'mine' }))
    sync.flush()
    expect(sync.read()).toBeNull()
  })

  it('writes nothing back when the applied board is saved, so machines never echo', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    otherWrites({ ...api, name: 'api2' })
    const before = writes()
    const read = sync.read()!
    sync.noteBoard({ workspaces: read, activeId: 'api' })
    vi.advanceTimersByTime(5000)
    expect(writes()).toBe(before)
  })

  it('writes the applied board back when it differs (a card kept running, D8)', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    otherWrites({ ...api, name: 'api2' })
    const read = sync.read()!
    sync.noteBoard(state(...read, workspace('kept', 'kept')))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api2', 'kept'])
  })

  it('drops a pending write of an older board when a newer one is read (last writer wins)', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'local' }))
    otherWrites({ ...api, name: 'remote' })
    expect(sync.read()).toEqual([{ ...api, name: 'remote' }])
    vi.advanceTimersByTime(5000)
    expect(written().board.workspaces[0].name).toBe('remote')
  })

  it('reads nothing while sync is off', () => {
    const sync = open()
    otherWrites(api)
    expect(sync.read()).toBeNull()
  })
})

describe('the folder unavailable (#13 D12, AC9)', () => {
  const api = workspace('api', 'api')
  /** Another machine, with its own home, writing `workspaces` to the shared folder. */
  const otherWrites = (...workspaces: Workspace[]): void => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW, log: () => {} })
    other.start(F, state())
    other.noteBoard(
      state(
        ...workspaces.map((w) => ({ ...w, directory: w.directory.replace(HOME, '/home/other') }))
      )
    )
    other.flush()
  }

  it('reports unavailable when a live read finds the folder removed', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    expect(sync.read()).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
  })

  it("writes this machine's board to the folder once it is back with no file, and reports synced", () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    sync.read()
    fs.dirs.add(F)
    expect(sync.read()).toBeNull()
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api'])
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
  })

  it("writes this machine's board when a live read finds the folder there but no file", () => {
    const sync = open()
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'api2' }))
    fs.files.delete(FILE)
    expect(sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('api2')
    expect(sync.status().kind).toBe('synced')
  })

  it('reports unavailable when the folder is now a file', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    fs.files.set(F, 'a file')
    sync.read()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
  })

  it("writes this machine's change made meanwhile over the file it finds when the folder is back", () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    sync.read()
    sync.noteBoard(state({ ...api, name: 'offline' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    expect(sync.status().kind).toBe('unavailable')
    fs.dirs.add(F)
    otherWrites({ ...api, name: 'remote' })
    expect(sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('offline')
    expect(sync.status().kind).toBe('synced')
  })

  it('applies the file it finds when the folder is back and nothing changed here meanwhile', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    sync.read()
    fs.dirs.add(F)
    otherWrites({ ...api, name: 'remote' })
    const before = writes()
    expect(sync.read()).toEqual([{ ...api, name: 'remote' }])
    expect(writes()).toBe(before)
    expect(sync.status().kind).toBe('synced')
  })

  it('at launch with the folder unavailable, applies the file once it is back (D11)', () => {
    fs.removeFolder()
    const sync = open()
    expect(sync.start(F, state(api))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
    fs.dirs.add(F)
    otherWrites({ ...api, name: 'remote' })
    const before = writes()
    expect(sync.read()).toEqual([{ ...api, name: 'remote' }])
    expect(writes()).toBe(before)
  })

  it('retries on the next change, never overwriting an unreadable file found there', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    sync.read()
    fs.dirs.add(F)
    fs.files.set(FILE, 'not json')
    sync.noteBoard(state({ ...api, name: 'offline' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    sync.flush()
    expect(fs.files.get(FILE)).toBe('not json')
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
  })

  it('retries on the next change, writing the board once the folder is back', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    fs.removeFolder()
    sync.read()
    fs.dirs.add(F)
    sync.noteBoard(state({ ...api, name: 'offline' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces[0].name).toBe('offline')
    expect(sync.status().kind).toBe('synced')
  })
})

describe('the file unreadable (#13 D3, D12, AC10)', () => {
  const api = workspace('api', 'api')

  it('reports unreadable on a live read and never writes the file, even a pending change', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'pending' }))
    fs.files.set(FILE, 'not json')
    expect(sync.read()).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
    sync.noteBoard(state({ ...api, name: 'later' }))
    vi.advanceTimersByTime(5000)
    sync.flush()
    expect(sync.read()).toBeNull()
    expect(fs.files.get(FILE)).toBe('not json')
  })

  it('applies the file once it is valid again, and writes later changes', () => {
    const sync = open()
    sync.setFolder(F, state(api))
    const good = fs.files.get(FILE)!
    fs.files.set(FILE, 'not json')
    sync.read()
    fs.files.set(FILE, good.replace('"name":"api"', '"name":"fixed"'))
    expect(sync.read()).toEqual([{ ...api, name: 'fixed' }])
    expect(sync.status().kind).toBe('synced')
    sync.noteBoard(state({ ...api, name: 'after' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces[0].name).toBe('after')
  })
})

describe('a join owed when sync is turned on against a folder not ready (#13 D9, D12)', () => {
  const api = workspace('api', 'api')
  const web = workspace('web', 'web')
  const otherWrites = (...workspaces: Workspace[]): void => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW, log: () => {} })
    other.start(F, state())
    other.noteBoard(
      state(
        ...workspaces.map((w) => ({ ...w, directory: w.directory.replace(HOME, '/home/other') }))
      )
    )
    other.flush()
  }

  it('joins on the first valid read after the file was unreadable', () => {
    fs.files.set(FILE, 'not json')
    const sync = open()
    expect(sync.setFolder(F, { workspaces: [web], activeId: 'web' })).toBeNull()
    fs.files.delete(FILE)
    otherWrites(api)
    expect(sync.read()).toEqual([api, web])
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'web'])
    expect(sync.status().kind).toBe('synced')
  })

  it("joins once the folder is back with another machine's file, never writing over it", () => {
    fs.failWrites = true
    const sync = open()
    expect(sync.setFolder(F, { workspaces: [web], activeId: 'web' })).toBeNull()
    expect(sync.status().kind).toBe('unavailable')
    fs.failWrites = false
    otherWrites(api)
    sync.noteBoard({ workspaces: [{ ...web, name: 'web2' }], activeId: 'web' })
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    sync.flush()
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api'])
    expect(sync.read()).toEqual([api, { ...web, name: 'web2' }])
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'web2'])
  })

  it('a later valid read after the join is a plain replace again', () => {
    fs.files.set(FILE, 'not json')
    const sync = open()
    sync.setFolder(F, state(web))
    fs.files.delete(FILE)
    otherWrites(api)
    sync.read()
    otherWrites(api)
    expect(sync.read()).toEqual([api])
  })
})

describe('a write that keeps failing (#13 D12)', () => {
  it('reports unavailable once, not on every retry', () => {
    const sync = open()
    const api = workspace('api', 'api')
    sync.setFolder(F, state(api))
    fs.failWrites = true
    sync.noteBoard(state({ ...api, name: 'a1' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    sync.read()
    sync.read()
    sync.noteBoard(state({ ...api, name: 'a2' }))
    vi.advanceTimersByTime(SYNC_WRITE_DELAY_MS)
    expect(statuses.filter((s) => s.kind === 'unavailable')).toHaveLength(1)
    expect(log).toHaveBeenCalledTimes(1)
  })
})
