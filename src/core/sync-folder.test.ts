import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dirname } from 'node:path'
import {
  SYNC_WRITE_DELAY_MS,
  SyncFolder,
  type SyncFileHandle,
  type SyncFolderFs
} from './sync-folder'
import type { SyncStatus } from './sync-status'
import type { Workspace, WorkspaceState } from './workspace-store'

const HOME = '/home/me'
const F = '/sync'
const FILE = '/sync/bikube-board.json'
const TMP = '/sync/bikube-board.json.tmp'
const NOW = new Date(Date.UTC(2026, 9, 14, 9, 5, 0))

/**
 * An in-memory directory on the async fs (#26 D1) that records every call that changes it, in
 * order. With `holdReads`, each file read waits for `releaseRead` and then reads the file as it is
 * then (a stalled folder).
 */
class FakeFs implements SyncFolderFs {
  files = new Map<string, string>()
  /** The directories that exist; removing F (and its files) is `removeFolder`. */
  dirs = new Set([F])
  events: string[] = []
  failWrites = false
  readError: string | null = null
  holdReads = false
  /** Every file read asked for. */
  reads = 0
  /** The held file reads not yet released, oldest first. */
  private held: Array<() => void> = []
  get readsInFlight(): number {
    return this.held.length
  }
  releaseRead(): void {
    this.held.shift()?.()
  }
  async readFile(path: string): Promise<string> {
    this.reads++
    if (this.holdReads) await new Promise<void>((resolve) => this.held.push(resolve))
    if (this.readError) throw Object.assign(new Error(this.readError), { code: this.readError })
    const text = this.files.get(path)
    if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return text
  }
  async stat(path: string): Promise<{ isDirectory(): boolean }> {
    if (this.dirs.has(path)) return { isDirectory: () => true }
    if (this.files.has(path)) return { isDirectory: () => false }
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
  }
  removeFolder(): void {
    this.dirs.delete(F)
    for (const path of [...this.files.keys()]) if (dirname(path) === F) this.files.delete(path)
  }
  async open(path: string): Promise<SyncFileHandle> {
    if (this.failWrites || !this.dirs.has(dirname(path)))
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    this.files.set(path, '')
    this.events.push(`open ${path}`)
    return {
      writeFile: async (data) => {
        this.events.push(`write ${path}`)
        this.files.set(path, data)
      },
      sync: async () => {
        this.events.push(`fsync ${path}`)
      },
      close: async () => {
        this.events.push(`close ${path}`)
      }
    }
  }
  async rename(from: string, to: string): Promise<void> {
    const text = this.files.get(from)
    if (text === undefined) throw new Error(`ENOENT: ${from}`)
    this.events.push(`rename ${from} -> ${to}`)
    this.files.delete(from)
    this.files.set(to, text)
  }
}

/** Lets every queued operation the fake fs can finish run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}

/** Fires the timers due within `ms`, then lets the operations they queued finish. */
async function tick(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await settle()
}

function workspace(id: string, name: string, over: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name,
    directory: `${HOME}/${name}`,
    columns: [{ id: `${id}-backlog`, name: 'Backlog' }],
    cards: [],
    nextCardNumber: 1,
    defaultStartup: { kind: 'claude' },
    shells: [],
    worktreeSetup: '',
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
  it("writes this machine's board atomically and reports synced", async () => {
    const sync = open()
    expect(sync.status()).toEqual({ kind: 'off' })
    const api = workspace('api', 'api')
    expect(await sync.setFolder(F, state(api))).toBeNull()
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
  it('writes a changed board within the delay, once for a burst of saves, as the last one', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'api1' }))
    sync.noteBoard(state({ ...api, name: 'api2' }))
    await tick(SYNC_WRITE_DELAY_MS - 1)
    expect(writes()).toBe(1)
    await tick(1)
    expect(writes()).toBe(2)
    expect(written().board.workspaces[0].name).toBe('api2')
  })

  it('does not write a board equal to the last one, whatever the active workspace', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    const web = workspace('web', 'web')
    await sync.setFolder(F, state(api, web))
    sync.noteBoard({ workspaces: [api, web], activeId: 'web' })
    sync.noteBoard({ workspaces: [api, { ...web }], activeId: 'api' })
    await tick(1000)
    expect(writes()).toBe(1)
  })

  it('does not write a change undone before the timer fires', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'other' }))
    sync.noteBoard(state(api))
    await tick(1000)
    expect(writes()).toBe(1)
  })

  it('flush writes a pending board at once', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'api1' }))
    await sync.flush()
    expect(written().board.workspaces[0].name).toBe('api1')
    await tick(1000)
    expect(writes()).toBe(2)
  })

  it('writes nothing while sync is off', async () => {
    const sync = open()
    sync.noteBoard(state(workspace('api', 'api')))
    await tick(1000)
    await sync.flush()
    expect(fs.events).toEqual([])
  })

  it('reports the folder unavailable when a write fails', async () => {
    const sync = open()
    fs.failWrites = true
    await sync.setFolder(F, state(workspace('api', 'api')))
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
    expect(log).toHaveBeenCalled()
  })
})

describe('turning sync on with a board in the folder (#13 D9, AC3)', () => {
  const api = workspace('api', 'api')
  const web = workspace('web', 'web')
  const fileWithApi = async (): Promise<void> => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW })
    await other.setFolder(F, state({ ...api, directory: '/home/other/api' }))
    fs.events = []
  }

  it("returns the file's workspaces then this machine's, and writes that board", async () => {
    await fileWithApi()
    const sync = open()
    const joined = await sync.setFolder(F, { workspaces: [web], activeId: 'web' })
    expect(joined).toEqual([api, web])
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'web'])
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
  })

  it('then writes nothing more when the renderer saves the joined board', async () => {
    await fileWithApi()
    const sync = open()
    await sync.setFolder(F, { workspaces: [web], activeId: 'web' })
    sync.noteBoard({ workspaces: [api, web], activeId: 'web' })
    await tick(1000)
    expect(writes()).toBe(1)
  })

  it('writes nothing when the file already holds the joined board', async () => {
    await fileWithApi()
    const sync = open()
    expect(await sync.setFolder(F, state(api))).toEqual([api])
    expect(fs.events).toEqual([])
    expect(sync.status().kind).toBe('synced')
  })

  it('setting the same folder again changes nothing', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.events = []
    expect(await sync.setFolder(F, state(api, web))).toBeNull()
    expect(fs.events).toEqual([])
  })

  it('neither joins nor overwrites an unreadable file (D12)', async () => {
    fs.files.set(FILE, 'not json')
    const sync = open()
    expect(await sync.setFolder(F, state(web))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
    sync.noteBoard(state({ ...web, name: 'web2' }))
    await tick(1000)
    await sync.flush()
    expect(fs.files.get(FILE)).toBe('not json')
    expect(fs.events).toEqual([])
  })

  it('reports the folder unavailable when the file cannot be read', async () => {
    fs.readError = 'EACCES'
    const sync = open()
    expect(await sync.setFolder(F, state(web))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
  })
})

describe('turning sync off (#13 D10, AC11)', () => {
  it('reports off, writes a pending change first and writes no later change', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'pending' }))
    expect(await sync.setFolder(null, state({ ...api, name: 'pending' }))).toBeNull()
    expect(writes()).toBe(2)
    expect(written().board.workspaces[0].name).toBe('pending')
    expect(sync.status()).toEqual({ kind: 'off' })
    expect(statuses.at(-1)).toEqual({ kind: 'off' })
    sync.noteBoard(state({ ...api, name: 'later' }))
    await tick(1000)
    await sync.flush()
    expect(writes()).toBe(2)
    expect(written().board.workspaces[0].name).toBe('pending')
  })

  it('switching folders writes a pending change to the old folder first', async () => {
    fs.dirs.add('/other')
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'pending' }))
    await sync.setFolder('/other', state({ ...api, name: 'pending' }))
    expect(written().board.workspaces[0].name).toBe('pending')
    expect(JSON.parse(fs.files.get('/other/bikube-board.json')!).board.workspaces[0].name).toBe(
      'pending'
    )
  })

  it('does not write a pending change over an old file that became unreadable', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'pending' }))
    fs.files.set(FILE, 'not json')
    await sync.setFolder(null, state({ ...api, name: 'pending' }))
    expect(fs.files.get(FILE)).toBe('not json')
    expect(sync.status()).toEqual({ kind: 'off' })
  })
})

describe('at launch with sync on (#13 AC12)', () => {
  it('reports synced after reading a valid file, and writes only a changed board', async () => {
    const api = workspace('api', 'api')
    await open().setFolder(F, state(api))
    fs.events = []
    const sync = open()
    await sync.start(F, state(api))
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
    expect(fs.events).toEqual([])
    sync.noteBoard(state(api))
    await tick(1000)
    expect(fs.events).toEqual([])
    sync.noteBoard(state({ ...api, name: 'api2' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces[0].name).toBe('api2')
  })

  it("writes this machine's board when the folder has no file", async () => {
    const sync = open()
    await sync.start(F, state(workspace('api', 'api')))
    expect(writes()).toBe(1)
    expect(sync.status().kind).toBe('synced')
  })

  it('stays off with no folder', async () => {
    const sync = open()
    await sync.start(null, state(workspace('api', 'api')))
    expect(sync.status()).toEqual({ kind: 'off' })
    expect(fs.events).toEqual([])
  })
})

describe('reading the file at launch (#13 D11, AC8)', () => {
  it("returns the file's board to apply, compared with nothing", async () => {
    const api = workspace('api', 'api')
    await open().setFolder(F, state({ ...api, name: 'y' }))
    const sync = open()
    expect(await sync.start(F, state({ ...api, name: 'x' }))).toEqual([{ ...api, name: 'y' }])
  })

  it('returns nothing to apply with no file or no folder', async () => {
    expect(await open().start(F, state(workspace('api', 'api')))).toBeNull()
    expect(await open().start(null, state(workspace('api', 'api')))).toBeNull()
  })
})

describe('reading changes live (#13 D4, D7, D11, AC2, AC13)', () => {
  const api = workspace('api', 'api')
  /** Another machine, with its own home, writing `workspaces` to the shared folder. */
  const otherWrites = async (...workspaces: Workspace[]): Promise<void> => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW })
    await other.start(F, state())
    other.noteBoard(
      state(
        ...workspaces.map((w) => ({ ...w, directory: w.directory.replace(HOME, '/home/other') }))
      )
    )
    await other.flush()
  }

  it("returns another machine's board once, then nothing until it changes again", async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    await otherWrites({ ...api, name: 'api2' })
    expect(await sync.read()).toEqual([{ ...api, name: 'api2' }])
    expect(await sync.read()).toBeNull()
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
  })

  it('returns nothing for the board this machine wrote itself', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'mine' }))
    await sync.flush()
    expect(await sync.read()).toBeNull()
  })

  it('writes nothing back when the applied board is saved, so machines never echo', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    await otherWrites({ ...api, name: 'api2' })
    const before = writes()
    const read = (await sync.read())!
    sync.noteBoard({ workspaces: read, activeId: 'api' })
    await tick(5000)
    expect(writes()).toBe(before)
  })

  it('writes the applied board back when it differs (a card kept running, D8)', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    await otherWrites({ ...api, name: 'api2' })
    const read = (await sync.read())!
    sync.noteBoard(state(...read, workspace('kept', 'kept')))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api2', 'kept'])
  })

  it('drops a pending write of an older board when a newer one is read (last writer wins)', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'local' }))
    await otherWrites({ ...api, name: 'remote' })
    expect(await sync.read()).toEqual([{ ...api, name: 'remote' }])
    await tick(5000)
    expect(written().board.workspaces[0].name).toBe('remote')
  })

  it('reads nothing while sync is off', async () => {
    const sync = open()
    await otherWrites(api)
    expect(await sync.read()).toBeNull()
  })
})

describe('the folder unavailable (#13 D12, AC9)', () => {
  const api = workspace('api', 'api')
  /** Another machine, with its own home, writing `workspaces` to the shared folder. */
  const otherWrites = async (...workspaces: Workspace[]): Promise<void> => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW, log: () => {} })
    await other.start(F, state())
    other.noteBoard(
      state(
        ...workspaces.map((w) => ({ ...w, directory: w.directory.replace(HOME, '/home/other') }))
      )
    )
    await other.flush()
  }

  it('reports unavailable when a live read finds the folder removed', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    expect(await sync.read()).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
  })

  it("writes this machine's board to the folder once it is back with no file, and reports synced", async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    await sync.read()
    fs.dirs.add(F)
    expect(await sync.read()).toBeNull()
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api'])
    expect(sync.status()).toEqual({ kind: 'synced', folder: F, at: NOW.toISOString() })
  })

  it("writes this machine's board when a live read finds the folder there but no file", async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'api2' }))
    fs.files.delete(FILE)
    expect(await sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('api2')
    expect(sync.status().kind).toBe('synced')
  })

  it('reports unavailable when the folder is now a file', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    fs.files.set(F, 'a file')
    await sync.read()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
  })

  it("writes this machine's change made meanwhile over the file it finds when the folder is back", async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    await sync.read()
    sync.noteBoard(state({ ...api, name: 'offline' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(sync.status().kind).toBe('unavailable')
    fs.dirs.add(F)
    await otherWrites({ ...api, name: 'remote' })
    expect(await sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('offline')
    expect(sync.status().kind).toBe('synced')
  })

  it('applies the file it finds when the folder is back and nothing changed here meanwhile', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    await sync.read()
    fs.dirs.add(F)
    await otherWrites({ ...api, name: 'remote' })
    const before = writes()
    expect(await sync.read()).toEqual([{ ...api, name: 'remote' }])
    expect(writes()).toBe(before)
    expect(sync.status().kind).toBe('synced')
  })

  it('at launch with the folder unavailable, applies the file once it is back (D11)', async () => {
    fs.removeFolder()
    const sync = open()
    expect(await sync.start(F, state(api))).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
    fs.dirs.add(F)
    await otherWrites({ ...api, name: 'remote' })
    const before = writes()
    expect(await sync.read()).toEqual([{ ...api, name: 'remote' }])
    expect(writes()).toBe(before)
  })

  it('retries on the next change, never overwriting an unreadable file found there', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    await sync.read()
    fs.dirs.add(F)
    fs.files.set(FILE, 'not json')
    sync.noteBoard(state({ ...api, name: 'offline' }))
    await tick(SYNC_WRITE_DELAY_MS)
    await sync.flush()
    expect(fs.files.get(FILE)).toBe('not json')
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
  })

  it('retries on the next change, writing the board once the folder is back', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.removeFolder()
    await sync.read()
    fs.dirs.add(F)
    sync.noteBoard(state({ ...api, name: 'offline' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces[0].name).toBe('offline')
    expect(sync.status().kind).toBe('synced')
  })
})

describe('the file unreadable (#13 D3, D12, AC10)', () => {
  const api = workspace('api', 'api')

  it('reports unreadable on a live read and never writes the file, even a pending change', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'pending' }))
    fs.files.set(FILE, 'not json')
    expect(await sync.read()).toBeNull()
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
    sync.noteBoard(state({ ...api, name: 'later' }))
    await tick(5000)
    await sync.flush()
    expect(await sync.read()).toBeNull()
    expect(fs.files.get(FILE)).toBe('not json')
  })

  it('applies the file once it is valid again, and writes later changes', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    const good = fs.files.get(FILE)!
    fs.files.set(FILE, 'not json')
    await sync.read()
    fs.files.set(FILE, good.replace('"name":"api"', '"name":"fixed"'))
    expect(await sync.read()).toEqual([{ ...api, name: 'fixed' }])
    expect(sync.status().kind).toBe('synced')
    sync.noteBoard(state({ ...api, name: 'after' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(written().board.workspaces[0].name).toBe('after')
  })

  it("writes this machine's change made meanwhile once the same file is back", async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    const good = fs.files.get(FILE)!
    fs.files.set(FILE, 'not json')
    await sync.read()
    sync.noteBoard(state({ ...api, name: 'renamed' }))
    await tick(5000)
    expect(fs.files.get(FILE)).toBe('not json')
    fs.files.set(FILE, good)
    expect(await sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('renamed')
    expect(sync.status().kind).toBe('synced')
  })

  it("writes this machine's change made meanwhile over a different file once it is valid", async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    const good = fs.files.get(FILE)!
    fs.files.set(FILE, 'not json')
    await sync.read()
    sync.noteBoard(state({ ...api, name: 'renamed' }))
    fs.files.set(FILE, good.replace('"name":"api"', '"name":"fixed"'))
    expect(await sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('renamed')
  })

  it('at launch with the file unreadable, applies the file once it is valid (D11)', async () => {
    const sync = open()
    const good = JSON.stringify({
      version: 1,
      savedAt: NOW.toISOString(),
      board: { workspaces: [{ ...api, name: 'remote', directory: '~/api' }] }
    })
    fs.files.set(FILE, 'not json')
    expect(await sync.start(F, state(api))).toBeNull()
    fs.files.set(FILE, good)
    expect(await sync.read()).toEqual([{ ...api, name: 'remote' }])
    expect(fs.files.get(FILE)).toBe(good)
  })

  it('re-reads the file before a pending write, never writing over one that became unreadable', async () => {
    for (const bad of [
      'not json',
      '{"version":2,"savedAt":"2026-10-14T09:05:00.000Z","board":{}}'
    ]) {
      fs = new FakeFs()
      const sync = open()
      await sync.setFolder(F, state(api))
      sync.noteBoard(state({ ...api, name: 'pending' }))
      fs.files.set(FILE, bad)
      await tick(SYNC_WRITE_DELAY_MS)
      expect(fs.files.get(FILE)).toBe(bad)
      expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
    }
  })
})

describe('a pending write finding a newer file (#13 D7, D12)', () => {
  const api = workspace('api', 'api')

  it('applies the newer file instead of writing over it', async () => {
    const boards: Workspace[][] = []
    const sync = new SyncFolder({
      fs,
      home: HOME,
      now: () => NOW,
      log,
      onStatus: (s) => statuses.push(s),
      onBoard: (b) => boards.push(b)
    })
    await sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'local' }))
    const newer = fs.files.get(FILE)!.replace('"name":"api"', '"name":"remote"')
    fs.files.set(FILE, newer)
    await tick(SYNC_WRITE_DELAY_MS)
    expect(fs.files.get(FILE)).toBe(newer)
    expect(boards).toEqual([[{ ...api, name: 'remote' }]])
    expect(sync.status().kind).toBe('synced')
  })
})

describe('a join owed when sync is turned on against a folder not ready (#13 D9, D12)', () => {
  const api = workspace('api', 'api')
  const web = workspace('web', 'web')
  const otherWrites = async (...workspaces: Workspace[]): Promise<void> => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW, log: () => {} })
    await other.start(F, state())
    other.noteBoard(
      state(
        ...workspaces.map((w) => ({ ...w, directory: w.directory.replace(HOME, '/home/other') }))
      )
    )
    await other.flush()
  }

  it('joins on the first valid read after the file was unreadable', async () => {
    fs.files.set(FILE, 'not json')
    const sync = open()
    expect(await sync.setFolder(F, { workspaces: [web], activeId: 'web' })).toBeNull()
    fs.files.delete(FILE)
    await otherWrites(api)
    expect(await sync.read()).toEqual([api, web])
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'web'])
    expect(sync.status().kind).toBe('synced')
  })

  it("joins once the folder is back with another machine's file, never writing over it", async () => {
    fs.failWrites = true
    const sync = open()
    expect(await sync.setFolder(F, { workspaces: [web], activeId: 'web' })).toBeNull()
    expect(sync.status().kind).toBe('unavailable')
    fs.failWrites = false
    await otherWrites(api)
    sync.noteBoard({ workspaces: [{ ...web, name: 'web2' }], activeId: 'web' })
    await tick(SYNC_WRITE_DELAY_MS)
    await sync.flush()
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api'])
    expect(await sync.read()).toEqual([api, { ...web, name: 'web2' }])
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'web2'])
  })

  it('a later valid read after the join is a plain replace again', async () => {
    fs.files.set(FILE, 'not json')
    const sync = open()
    await sync.setFolder(F, state(web))
    fs.files.delete(FILE)
    await otherWrites(api)
    await sync.read()
    await otherWrites(api)
    expect(await sync.read()).toEqual([api])
  })
})

describe('a write that keeps failing (#13 D12)', () => {
  it('reports unavailable once, not on every retry', async () => {
    const sync = open()
    const api = workspace('api', 'api')
    await sync.setFolder(F, state(api))
    fs.failWrites = true
    sync.noteBoard(state({ ...api, name: 'a1' }))
    await tick(SYNC_WRITE_DELAY_MS)
    await sync.read()
    await sync.read()
    sync.noteBoard(state({ ...api, name: 'a2' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(statuses.filter((s) => s.kind === 'unavailable')).toHaveLength(1)
    expect(log).toHaveBeenCalledTimes(1)
  })
})

describe('switching folders while unavailable (#13 D12, D13)', () => {
  it('reports the new folder unavailable when its write fails', async () => {
    const sync = open()
    fs.removeFolder()
    await sync.setFolder(F, state(workspace('api', 'api')))
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
    fs.dirs.add('/sync2')
    fs.failWrites = true
    await sync.setFolder('/sync2', state(workspace('api', 'api')))
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: '/sync2' })
    expect(statuses.at(-1)).toEqual({ kind: 'unavailable', folder: '/sync2' })
  })
})

describe('one operation at a time (#26 D2, AC2)', () => {
  const api = workspace('api', 'api')

  it('writes nothing until a running read has finished, then drops the change for a newer board', async () => {
    const boards: Workspace[][] = []
    const sync = new SyncFolder({
      fs,
      home: HOME,
      now: () => NOW,
      log,
      onStatus: (s) => statuses.push(s),
      onBoard: (b) => boards.push(b)
    })
    await sync.setFolder(F, state(api))
    const newer = fs.files.get(FILE)!.replace('"name":"api"', '"name":"remote"')
    fs.events = []
    fs.holdReads = true
    const read = sync.read()
    await settle()
    expect(fs.readsInFlight).toBe(1)
    sync.noteBoard(state({ ...api, name: 'local' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(fs.events).toEqual([])
    fs.files.set(FILE, newer)
    fs.holdReads = false
    fs.releaseRead()
    expect(await read).toEqual([{ ...api, name: 'remote' }])
    await settle()
    expect(fs.events).toEqual([])
    expect(fs.files.get(FILE)).toBe(newer)
    expect(boards).toEqual([])
    expect(sync.busy()).toBe(false)
  })

  it('writes the change once the running read found nothing newer', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.events = []
    fs.holdReads = true
    const read = sync.read()
    await settle()
    sync.noteBoard(state({ ...api, name: 'local' }))
    await tick(SYNC_WRITE_DELAY_MS)
    expect(fs.events).toEqual([])
    fs.holdReads = false
    fs.releaseRead()
    expect(await read).toBeNull()
    await settle()
    expect(writes()).toBe(1)
    expect(written().board.workspaces[0].name).toBe('local')
  })
})

describe('never overwriting with the async fs (#26 AC3)', () => {
  it("does not write a pending change when the file becomes unreadable during the write's re-read", async () => {
    const api = workspace('api', 'api')
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.events = []
    sync.noteBoard(state({ ...api, name: 'pending' }))
    fs.holdReads = true
    await tick(SYNC_WRITE_DELAY_MS)
    expect(fs.readsInFlight).toBe(1)
    fs.files.set(FILE, 'not json')
    fs.releaseRead()
    await settle()
    expect(fs.files.get(FILE)).toBe('not json')
    expect(fs.events).toEqual([])
    expect(sync.status()).toEqual({ kind: 'unreadable', folder: F })
  })
})

describe('reads coalescing (#26 D3, AC4)', () => {
  it('runs one read at a time with at most one waiting, whose board goes to its own caller only', async () => {
    const api = workspace('api', 'api')
    const sync = open()
    await sync.setFolder(F, state(api))
    fs.holdReads = true
    const reads = fs.reads
    const first = sync.read()
    await settle()
    expect(fs.readsInFlight).toBe(1)
    const more = Array.from({ length: 10 }, () => sync.read())
    await settle()
    expect(fs.readsInFlight).toBe(1)
    expect(fs.reads).toBe(reads + 1)
    fs.releaseRead()
    await settle()
    expect(fs.readsInFlight).toBe(1)
    expect(fs.reads).toBe(reads + 2)
    // Another machine writes a newer board, which the second read finds.
    const remote = { ...api, name: 'remote' }
    fs.files.set(FILE, fs.files.get(FILE)!.replace('"name":"api"', '"name":"remote"'))
    fs.releaseRead()
    expect(await first).toBeNull()
    expect(await Promise.all(more)).toEqual([[remote], ...Array(9).fill(null)])
    await settle()
    expect(fs.reads).toBe(reads + 2)
    expect(sync.busy()).toBe(false)
  })
})

describe('flush and busy (#26 D5, AC6)', () => {
  const api = workspace('api', 'api')

  it('resolves only once a pending write behind a running read has landed', async () => {
    const sync = open()
    await sync.setFolder(F, state(api))
    expect(sync.busy()).toBe(false)
    fs.holdReads = true
    void sync.read()
    await settle()
    sync.noteBoard(state({ ...api, name: 'pending' }))
    expect(sync.busy()).toBe(true)
    let flushed = false
    const flush = sync.flush().then(() => {
      flushed = true
    })
    await settle()
    expect(flushed).toBe(false)
    fs.releaseRead()
    await settle()
    // The write's own re-read (D12) is held now.
    expect(fs.readsInFlight).toBe(1)
    expect(flushed).toBe(false)
    fs.releaseRead()
    await flush
    expect(fs.events.at(-1)).toBe(`rename ${TMP} -> ${FILE}`)
    expect(written().board.workspaces[0].name).toBe('pending')
    expect(sync.busy()).toBe(false)
  })

  it('goes on with the next operation after one fails, never rejecting', async () => {
    let fail = true
    const sync = new SyncFolder({
      fs,
      home: HOME,
      now: () => NOW,
      log,
      onStatus: () => {
        if (fail) throw new Error('boom')
      }
    })
    expect(await sync.setFolder(F, state(api))).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'))
    fail = false
    await sync.setFolder(null, state(api))
    expect(await sync.setFolder(F, state(api))).toEqual([api])
    expect(sync.status().kind).toBe('synced')
    expect(sync.busy()).toBe(false)
  })
})

describe('a board change while the launch read runs (#26 D2, #13 D11)', () => {
  const api = workspace('api', 'api')
  /** Starts with the launch read held, notes a change, then lets the read return. */
  const changeDuringLaunch = async (beforeRelease: () => void): Promise<SyncFolder> => {
    fs.holdReads = true
    const sync = open()
    const launched = sync.start(F, state(api))
    await settle()
    expect(fs.readsInFlight).toBe(1)
    sync.noteBoard(state({ ...api, name: 'changed' }))
    await tick(SYNC_WRITE_DELAY_MS)
    beforeRelease()
    fs.holdReads = false
    fs.releaseRead()
    expect(await launched).toBeNull()
    await settle()
    return sync
  }

  it('writes the change when the folder has no file', async () => {
    const sync = await changeDuringLaunch(() => {})
    expect(written().board.workspaces[0].name).toBe('changed')
    expect(writes()).toBe(1)
    expect(sync.status().kind).toBe('synced')
  })

  it("writes the change over another machine's file once the folder is back (D12)", async () => {
    const sync = await changeDuringLaunch(() => fs.removeFolder())
    expect(sync.status()).toEqual({ kind: 'unavailable', folder: F })
    fs.dirs.add(F)
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW, log: () => {} })
    await other.start(F, state({ ...api, name: 'remote', directory: '/home/other/api' }))
    expect(written().board.workspaces[0].name).toBe('remote')
    expect(await sync.read()).toBeNull()
    expect(written().board.workspaces[0].name).toBe('changed')
    expect(sync.status().kind).toBe('synced')
  })

  it("writes the change over another machine's valid file, returning nothing to apply (D4)", async () => {
    await open().setFolder(F, state({ ...api, name: 'file' }))
    fs.events = []
    fs.holdReads = true
    const sync = open()
    const launched = sync.start(F, state(api))
    await settle()
    sync.noteBoard(state({ ...api, name: 'changed' }))
    await tick(SYNC_WRITE_DELAY_MS)
    fs.holdReads = false
    fs.releaseRead()
    expect(await launched).toBeNull()
    await tick(1000)
    expect(written().board.workspaces[0].name).toBe('changed')
    expect(writes()).toBe(1)
    expect(sync.status().kind).toBe('synced')
    expect(sync.busy()).toBe(false)
  })

  it("returns the file's board and writes nothing when nothing changed during the read (D4)", async () => {
    await open().setFolder(F, state({ ...api, name: 'file' }))
    fs.events = []
    fs.holdReads = true
    const sync = open()
    const launched = sync.start(F, state(api))
    await settle()
    fs.holdReads = false
    fs.releaseRead()
    expect(await launched).toEqual([{ ...api, name: 'file' }])
    await tick(1000)
    expect(fs.events).toEqual([])
    expect(sync.status().kind).toBe('synced')
  })

  it('a folder set before a late valid launch read joins from the board that read applied (D4)', async () => {
    const B = '/sync-b'
    fs.dirs.add(B)
    const web = workspace('web', 'web')
    const local = workspace('local', 'local')
    await open().setFolder(F, state(api))
    await open().setFolder(B, state(web))
    fs.events = []
    fs.holdReads = true
    const sync = open()
    const launched = sync.start(F, state(local))
    await settle()
    const joined = sync.setFolder(B, state(local))
    fs.holdReads = false
    fs.releaseRead()
    expect(await launched).toEqual([api])
    expect(await joined).toEqual([web, api])
    const fileB = JSON.parse(fs.files.get(`${B}/bikube-board.json`)!) as {
      board: { workspaces: Workspace[] }
    }
    expect(fileB.board.workspaces.map((w) => w.id)).toEqual(['web', 'api'])
  })
})

describe('a board change while turning sync on is queued (#26 D2, #13 D9)', () => {
  it('joins with the latest board saved, not the one sync was turned on with', async () => {
    const api = workspace('api', 'api')
    const sync = open()
    const joined = sync.setFolder(F, state(api))
    sync.noteBoard(state({ ...api, name: 'saved' }))
    expect(await joined).toBeNull()
    expect(written().board.workspaces[0].name).toBe('saved')
  })
})

describe('a board change while turning sync on runs (#26 D2, #13 D9)', () => {
  const api = workspace('api', 'api')
  const web = workspace('web', 'web')

  it('keeps the join in the file, written once with the change', async () => {
    const other = new SyncFolder({ fs, home: '/home/other', now: () => NOW })
    await other.setFolder(F, state({ ...api, directory: '/home/other/api' }))
    fs.events = []
    fs.holdReads = true
    const sync = open()
    const joined = sync.setFolder(F, state(web))
    await settle()
    expect(fs.readsInFlight).toBe(1)
    sync.noteBoard(state({ ...web, name: 'changed' }))
    await tick(SYNC_WRITE_DELAY_MS)
    fs.holdReads = false
    fs.releaseRead()
    expect(await joined).toEqual([api, { ...web, name: 'changed' }])
    await tick(1000)
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['api', 'changed'])
    expect(writes()).toBe(1)
  })

  it('writes the change once to a folder with no file', async () => {
    fs.holdReads = true
    const sync = open()
    const turnedOn = sync.setFolder(F, state(web))
    await settle()
    sync.noteBoard(state({ ...web, name: 'changed' }))
    await tick(SYNC_WRITE_DELAY_MS)
    fs.holdReads = false
    fs.releaseRead()
    expect(await turnedOn).toBeNull()
    await tick(1000)
    expect(written().board.workspaces.map((w) => w.name)).toEqual(['changed'])
    expect(writes()).toBe(1)
  })
})
