/**
 * Main's side of the sync folder (#13 D4, D9, D13), on the state file's pattern: plain TS with an
 * injected fs, so Vitest drives it with a fake directory and fake timers. It owns the sync status
 * and the last board read from or written to the file (kept in memory only, D11), and writes the
 * board atomically when it differs from that one (D4).
 *
 * The fs is async (#26 D1), so a stalled folder never blocks main's event loop. Every operation
 * (set folder, launch read, read, the timer's write, flush) runs on one queue, each to completion
 * before the next starts (#26 D2), so each sees and leaves the state the synchronous code did; a
 * read asked for while one is waiting to start shares that one's result (#26 D3). The returned
 * promises never reject: an operation that throws is logged and resolves to nothing.
 */
import { join } from 'node:path'
import {
  SYNC_FILE_NAME,
  joinBoards,
  parseSyncFile,
  serializeSyncFile,
  toSyncBoard
} from './sync-file'
import type { SyncStatus } from './sync-status'
import type { Workspace, WorkspaceState } from './workspace-store'

/** How long after a board change the file is written; D4 asks for within 1 second. */
export const SYNC_WRITE_DELAY_MS = 200

/** An open temp file (`node:fs/promises`' `FileHandle`). */
export interface SyncFileHandle {
  writeFile(data: string, encoding: 'utf8'): Promise<void>
  sync(): Promise<void>
  close(): Promise<void>
}

/**
 * The `node:fs/promises` calls the sync folder needs (#26 D1): `stat` tells a missing file from a
 * missing folder (D12).
 */
export interface SyncFolderFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  stat(path: string): Promise<{ isDirectory(): boolean }>
  open(path: string, flags: 'w'): Promise<SyncFileHandle>
  rename(from: string, to: string): Promise<void>
}

export interface SyncFolderOptions {
  fs: SyncFolderFs
  /** This machine's home directory, which D5 maps to `~`. */
  home: string
  now?: () => Date
  log?: (message: string) => void
  /** Told every status change (D13). */
  onStatus?: (status: SyncStatus) => void
  /**
   * Handed a newer board found in the file when a pending write re-read it first (D7, D12), for
   * this machine to apply as any read board.
   */
  onBoard?: (workspaces: Workspace[]) => void
}

/** What reading the file found. */
type ReadResult =
  | { kind: 'missing' }
  | { kind: 'valid'; workspaces: Workspace[] }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'unavailable'; reason: string }

export class SyncFolder {
  private folder: string | null = null
  private current: SyncStatus = { kind: 'off' }
  /** D3's `board` as last read from or written to the file, serialized (D4); null for none. */
  private last: string | null = null
  /**
   * This machine's board as last noted (launch, folder set, saves, or a board handed over to
   * apply), serialized; what D12's recovery writes when it differs from `last`. Null for none.
   */
  private local: string | null = null
  /** The workspaces `local` was made from, which an owed join (D9) joins with the file's. */
  private localWorkspaces: Workspace[] = []
  /**
   * D9's join is owed: sync was turned on while the folder was unavailable or its file unreadable.
   * The first read finding the folder ready joins (or writes this machine's board when it has no
   * file) instead of D7's replace or D12's write.
   */
  private joinOwed = false
  /** The board to write when the timer fires, serialized. */
  private pending: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The queue's tail (#26 D2): settles once every operation queued so far has finished. */
  private tail: Promise<void> = Promise.resolve()
  /** Operations queued or running. */
  private queued = 0
  /** A read queued and not yet started, which a later read shares (#26 D3); null for none. */
  private waitingRead: Promise<Workspace[] | null> | null = null

  constructor(private readonly options: SyncFolderOptions) {}

  status(): SyncStatus {
    return this.current
  }

  /** The folder in use, or null when sync is off. */
  folderPath(): string | null {
    return this.folder
  }

  /**
   * Turns sync on for `folder` (already checked to be an existing directory) and joins the boards
   * (D9), or turns it off with null. With no file in the folder, `local`'s board is written to it;
   * with a valid one, the joined board is written and returned for the renderer to apply. Returns
   * null when there is nothing to apply. Setting the folder in use again changes nothing. Queued
   * (#26 D2); resolves once done.
   */
  setFolder(folder: string | null, local: WorkspaceState): Promise<Workspace[] | null> {
    // The join uses the latest board noted when it runs, so a save made meanwhile isn't lost.
    this.noteLocal(local.workspaces)
    return this.enqueue(() => this.setFolderNow(folder), null)
  }

  private async setFolderNow(folder: string | null): Promise<Workspace[] | null> {
    if (folder === this.folder) return null
    // D10: a pending change goes to the old folder first when it is synced (read first, D12).
    if (this.current.kind === 'synced') await this.writePending()
    else this.cancelPending()
    this.folder = folder
    this.last = null
    this.joinOwed = folder !== null
    if (folder === null) {
      this.setStatus({ kind: 'off' })
      return null
    }
    const read = await this.readFile(folder)
    switch (read.kind) {
      case 'missing': {
        // The latest board, with any change noted during the read; its pending write would only
        // repeat it.
        const latest = this.noteLocal(this.localWorkspaces)
        this.cancelPending()
        await this.write(latest)
        return null
      }
      case 'valid':
        // A change noted during the read is in the join; its pending write would undo the join.
        this.cancelPending()
        return this.join(folder, read.workspaces)
      case 'unreadable':
        this.log(`sync file unreadable (${read.reason}); not joining or writing`)
        this.setStatus({ kind: 'unreadable', folder })
        return null
      case 'unavailable':
        this.log(`sync folder unavailable (${read.reason})`)
        this.setStatus({ kind: 'unavailable', folder })
        return null
    }
  }

  /**
   * At launch, with the folder kept in the settings (or null): reads the file to know the last
   * board and the status, and returns the file's board for this machine to apply (D7, D11): not a
   * join, and compared with nothing, so a valid file always applies. A missing file gets `local`'s
   * board. Returns null when there is nothing to apply. Queued (#26 D2); resolves once done. The
   * folder is in use at once, so a board change noted while the read runs is kept (its write is
   * queued behind this read) and the read uses the latest board noted.
   */
  start(folder: string | null, local: WorkspaceState): Promise<Workspace[] | null> {
    this.folder = folder
    this.last = null
    const launchText = this.noteLocal(local.workspaces)
    this.joinOwed = false
    return this.enqueue(() => this.startNow(folder, launchText), null)
  }

  /** `launchText` is this machine's board as at launch, before any change noted during the read. */
  private async startNow(folder: string | null, launchText: string): Promise<Workspace[] | null> {
    if (folder === null) return null
    const read = await this.readFile(folder)
    const localText = this.noteLocal(this.localWorkspaces)
    switch (read.kind) {
      case 'missing':
        // The latest board is written now; a pending write of it would only repeat it.
        this.cancelPending()
        await this.write(localText)
        return null
      case 'valid':
        // The file's board wins at launch (D11), over a change noted while it was read.
        this.cancelPending()
        this.last = this.boardText(read.workspaces)
        this.local = this.last
        this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
        return read.workspaces
      case 'unreadable':
        // Once the file is valid it applies (D11), unless a change was noted here since launch,
        // even during this read, which then wins (D12).
        this.last = launchText
        this.log(`sync file unreadable (${read.reason}); not writing`)
        this.setStatus({ kind: 'unreadable', folder })
        return null
      case 'unavailable':
        // Once the folder is back its file applies (D11), unless a change was noted here since
        // launch, even during this read, which then wins (D12).
        this.last = launchText
        this.log(`sync folder unavailable (${read.reason})`)
        this.setStatus({ kind: 'unavailable', folder })
        return null
    }
  }

  /**
   * Reads the file again (the folder changed, or a window gained focus, D11): returns its board
   * for this machine to apply when it differs from the last one read or written (D4, D7), dropping
   * a pending write of an older board (last writer wins); else null. Applying it saves a board
   * equal to the file's, which is then not written back, so machines never echo (D4). A folder
   * with no file gets this machine's board. While the folder is unavailable or its file
   * unreadable, this is D12's retry and recovery. Queued (#26 D2), and shared with a read already
   * waiting to start (#26 D3), so at most one read runs and one waits.
   */
  read(): Promise<Workspace[] | null> {
    if (this.waitingRead !== null) return this.waitingRead
    const read = this.enqueue(() => {
      this.waitingRead = null
      return this.readNow()
    }, null)
    this.waitingRead = read
    return read
  }

  private async readNow(): Promise<Workspace[] | null> {
    const folder = this.folder
    if (folder === null) return null
    const recovering = this.current.kind === 'unavailable' || this.current.kind === 'unreadable'
    const read = await this.readFile(folder)
    switch (read.kind) {
      case 'missing':
        this.cancelPending()
        if (this.local !== null) await this.write(this.local)
        return null
      case 'valid': {
        if (this.joinOwed) {
          this.cancelPending()
          return this.join(folder, read.workspaces)
        }
        const text = this.boardText(read.workspaces)
        // D12: back from unavailable or unreadable with a change made meanwhile, this machine's
        // board wins.
        if (recovering && this.local !== null && this.local !== this.last && this.local !== text) {
          this.cancelPending()
          await this.write(this.local)
          return null
        }
        this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
        if (text === this.last) return null
        this.cancelPending()
        this.last = text
        this.noteLocal(read.workspaces)
        return read.workspaces
      }
      case 'unreadable':
        this.cancelPending()
        this.reportUnreadable(read.reason)
        return null
      case 'unavailable':
        this.reportUnavailable(read.reason)
        return null
    }
  }

  /**
   * A board change saved on this machine: written within `SYNC_WRITE_DELAY_MS` when its board
   * differs from the last one read or written (D4). Ignored while sync is off or the file is
   * unreadable (D12: it is never overwritten). Synchronous bookkeeping: the timer queues the write
   * (#26 D2), which takes the pending board when it runs, so a read before it can still drop it.
   */
  noteBoard(state: WorkspaceState): void {
    // Noted even while sync is off, for a queued `setFolder`'s join.
    const text = this.noteLocal(state.workspaces)
    if (this.folder === null) return
    if (this.current.kind === 'unreadable') return
    if (text === this.last) {
      this.cancelPending()
      return
    }
    this.pending = text
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        void this.enqueue(async () => {
          const next = this.pending
          this.cancelPending()
          const newer = next === null ? null : await this.writeChange(next)
          if (newer !== null) this.options.onBoard?.(newer)
        }, undefined)
      }, SYNC_WRITE_DELAY_MS)
    }
  }

  /**
   * Writes a pending board now, behind any running operation, and resolves once the queue is empty
   * (#26 D5, before quit).
   */
  async flush(): Promise<void> {
    await this.enqueue(() => this.writePending(), undefined)
    while (this.queued > 0) await this.tail
  }

  /** Whether a board is pending or an operation is queued or running (#26 D5's quit hold). */
  busy(): boolean {
    return this.pending !== null || this.queued > 0
  }

  /**
   * Runs `operation` once every operation queued before it has finished (#26 D2). A failure is
   * logged and resolves to `fallback`, and the queue goes on.
   */
  private enqueue<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    this.queued++
    const run = this.tail.then(operation).catch((err: unknown) => {
      this.log(`sync operation failed: ${String(err)}`)
      return fallback
    })
    this.tail = run.then(() => {
      this.queued--
    })
    return run
  }

  /** Writes a pending board now, dropping a newer board the file holds (nothing will apply it). */
  private async writePending(): Promise<void> {
    const next = this.pending
    this.cancelPending()
    if (next !== null) await this.writeChange(next)
  }

  /**
   * Writes a board change, reading the file first (D12): one that has become unreadable is never
   * written over, and a valid one holding a newer board than the last read or written (another
   * machine's write, D7) wins: it is returned for this machine to apply instead. While the folder
   * is unavailable this is D12's retry, where a change made meanwhile wins over the file.
   */
  private async writeChange(boardText: string): Promise<Workspace[] | null> {
    const folder = this.folder
    if (folder === null) return null
    const recovering = this.current.kind === 'unavailable' || this.current.kind === 'unreadable'
    const read = await this.readFile(folder)
    switch (read.kind) {
      case 'unavailable':
        this.reportUnavailable(read.reason)
        return null
      case 'unreadable':
        this.reportUnreadable(read.reason)
        return null
      case 'missing':
        await this.write(boardText)
        return null
      case 'valid': {
        // An owed join is the next read's (D9): this machine's board never replaces the file's.
        if (this.joinOwed) return null
        const text = this.boardText(read.workspaces)
        if (recovering || text === this.last) {
          await this.write(boardText)
          return null
        }
        this.last = text
        this.noteLocal(read.workspaces)
        this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
        return read.workspaces
      }
    }
  }

  /**
   * D9's join of the file's board with this machine's: written when it differs from the file,
   * and returned for this machine to apply.
   */
  private async join(folder: string, file: Workspace[]): Promise<Workspace[]> {
    const joined = joinBoards(file, this.localWorkspaces)
    this.last = this.boardText(file)
    const text = this.noteLocal(joined)
    if (text === this.last) {
      this.joinOwed = false
      this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
    } else await this.write(text)
    return joined
  }

  /** Remembers `workspaces` as this machine's board; returns it serialized. */
  private noteLocal(workspaces: Workspace[]): string {
    this.localWorkspaces = workspaces
    this.local = this.boardText(workspaces)
    return this.local
  }

  private cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  private boardText(workspaces: Workspace[]): string {
    return JSON.stringify(toSyncBoard({ workspaces, activeId: null }, this.options.home))
  }

  private async readFile(folder: string): Promise<ReadResult> {
    let text: string
    try {
      text = await this.options.fs.readFile(join(folder, SYNC_FILE_NAME), 'utf8')
    } catch (err) {
      if (!isMissing(err)) return { kind: 'unavailable', reason: String(err) }
      // No file: only a folder that is still a directory is merely empty (D12).
      try {
        if ((await this.options.fs.stat(folder)).isDirectory()) return { kind: 'missing' }
        return { kind: 'unavailable', reason: `${folder} is not a directory` }
      } catch (statErr) {
        return { kind: 'unavailable', reason: String(statErr) }
      }
    }
    const parsed = parseSyncFile(text, this.options.home)
    if (!parsed.ok) return { kind: 'unreadable', reason: parsed.reason }
    return { kind: 'valid', workspaces: parsed.workspaces }
  }

  /**
   * Writes `boardText` atomically (temp file, flushed, renamed over the file, as #8 D2) and
   * remembers it as the last board; a failure reports the folder unavailable.
   */
  private async write(boardText: string): Promise<void> {
    const folder = this.folder
    if (folder === null) return
    const path = join(folder, SYNC_FILE_NAME)
    const tmpPath = `${path}.tmp`
    const now = this.now()
    const fs = this.options.fs
    try {
      const file = await fs.open(tmpPath, 'w')
      try {
        await file.writeFile(serializeSyncFile(JSON.parse(boardText), now), 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await fs.rename(tmpPath, path)
    } catch (err) {
      this.reportUnavailable(`sync file not written: ${String(err)}`)
      return
    }
    this.joinOwed = false
    this.last = boardText
    this.setStatus({ kind: 'synced', folder, at: now.toISOString() })
  }

  /** D12: reports the file unreadable, logging only the change into it. */
  private reportUnreadable(reason: string): void {
    const folder = this.folder
    if (folder === null || (this.current.kind === 'unreadable' && this.current.folder === folder))
      return
    this.log(`sync file unreadable (${reason}); not writing`)
    this.setStatus({ kind: 'unreadable', folder })
  }

  /** D12: reports the folder unavailable, logging only the change into it. */
  private reportUnavailable(reason: string): void {
    const folder = this.folder
    if (folder === null || (this.current.kind === 'unavailable' && this.current.folder === folder))
      return
    this.log(`sync folder unavailable (${reason})`)
    this.setStatus({ kind: 'unavailable', folder })
  }

  private setStatus(status: SyncStatus): void {
    this.current = status
    this.options.onStatus?.(status)
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date()
  }

  private log(message: string): void {
    const log = this.options.log ?? console.error
    log(message)
  }
}

const isMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT'
