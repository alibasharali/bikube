import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateFileFs } from './state-file'
import { SYNC_WRITE_DELAY_MS, SyncFolder } from './sync-folder'
import type { SyncStatus } from './sync-status'
import type { Workspace, WorkspaceState } from './workspace-store'

const HOME = '/home/me'
const F = '/sync'
const FILE = '/sync/drovr-board.json'
const TMP = '/sync/drovr-board.json.tmp'
const NOW = new Date(Date.UTC(2026, 9, 14, 9, 5, 0))

/** An in-memory directory that records every call that changes it, in order. */
class FakeFs implements StateFileFs {
  files = new Map<string, string>()
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
  openSync(path: string): number {
    if (this.failWrites) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
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
