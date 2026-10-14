/**
 * Main's side of the sync folder (#13 D4, D9, D13), on the state file's pattern: plain TS with an
 * injected fs, so Vitest drives it with a fake directory and fake timers. It owns the sync status
 * and the last board read from or written to the file (kept in memory only, D11), and writes the
 * board atomically when it differs from that one (D4).
 */
import { join } from 'node:path'
import type { StateFileFs } from './state-file'
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

/** The state file's fs, plus `statSync` to tell a missing file from a missing folder (D12). */
export interface SyncFolderFs extends StateFileFs {
  statSync(path: string): { isDirectory(): boolean }
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
   * null when there is nothing to apply. Setting the folder in use again changes nothing.
   */
  setFolder(folder: string | null, local: WorkspaceState): Workspace[] | null {
    if (folder === this.folder) return null
    // D10: a pending change goes to the old folder first when it is synced (read first, D12).
    if (this.current.kind === 'synced') this.writePending()
    else this.cancelPending()
    this.folder = folder
    this.last = null
    const localText = this.noteLocal(local.workspaces)
    this.joinOwed = folder !== null
    if (folder === null) {
      this.setStatus({ kind: 'off' })
      return null
    }
    const read = this.readFile(folder)
    switch (read.kind) {
      case 'missing':
        this.write(localText)
        return null
      case 'valid':
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
   * board. Returns null when there is nothing to apply.
   */
  start(folder: string | null, local: WorkspaceState): Workspace[] | null {
    this.folder = folder
    this.last = null
    const localText = this.noteLocal(local.workspaces)
    this.joinOwed = false
    if (folder === null) return null
    const read = this.readFile(folder)
    switch (read.kind) {
      case 'missing':
        this.write(localText)
        return null
      case 'valid':
        this.last = this.boardText(read.workspaces)
        this.local = this.last
        this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
        return read.workspaces
      case 'unreadable':
        // Nothing has changed here since launch: once the file is valid it applies (D11).
        this.last = localText
        this.log(`sync file unreadable (${read.reason}); not writing`)
        this.setStatus({ kind: 'unreadable', folder })
        return null
      case 'unavailable':
        // Nothing has changed here since launch: once the folder is back its file applies (D11).
        this.last = localText
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
   * with no file gets this machine's board. While the folder is unavailable or its file unreadable, this is D12's retry and recovery.
   */
  read(): Workspace[] | null {
    const folder = this.folder
    if (folder === null) return null
    const recovering = this.current.kind === 'unavailable' || this.current.kind === 'unreadable'
    const read = this.readFile(folder)
    switch (read.kind) {
      case 'missing':
        this.cancelPending()
        if (this.local !== null) this.write(this.local)
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
          this.write(this.local)
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
   * unreadable (D12: it is never overwritten).
   */
  noteBoard(state: WorkspaceState): void {
    if (this.folder === null) return
    const text = this.noteLocal(state.workspaces)
    if (this.current.kind === 'unreadable') return
    if (text === this.last) {
      this.cancelPending()
      return
    }
    this.pending = text
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        const next = this.pending
        this.pending = null
        const newer = next === null ? null : this.writeChange(next)
        if (newer !== null) this.options.onBoard?.(newer)
      }, SYNC_WRITE_DELAY_MS)
    }
  }

  /** Writes a pending board now, synchronously (before quit). */
  flush(): void {
    this.writePending()
  }

  /** Writes a pending board now, dropping a newer board the file holds (nothing will apply it). */
  private writePending(): void {
    const next = this.pending
    this.cancelPending()
    if (next !== null) this.writeChange(next)
  }

  /**
   * Writes a board change, reading the file first (D12): one that has become unreadable is never
   * written over, and a valid one holding a newer board than the last read or written (another
   * machine's write, D7) wins: it is returned for this machine to apply instead. While the folder
   * is unavailable this is D12's retry, where a change made meanwhile wins over the file.
   */
  private writeChange(boardText: string): Workspace[] | null {
    const folder = this.folder
    if (folder === null) return null
    const recovering = this.current.kind === 'unavailable' || this.current.kind === 'unreadable'
    const read = this.readFile(folder)
    switch (read.kind) {
      case 'unavailable':
        this.reportUnavailable(read.reason)
        return null
      case 'unreadable':
        this.reportUnreadable(read.reason)
        return null
      case 'missing':
        this.write(boardText)
        return null
      case 'valid': {
        // An owed join is the next read's (D9): this machine's board never replaces the file's.
        if (this.joinOwed) return null
        const text = this.boardText(read.workspaces)
        if (recovering || text === this.last) {
          this.write(boardText)
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
  private join(folder: string, file: Workspace[]): Workspace[] {
    const joined = joinBoards(file, this.localWorkspaces)
    this.last = this.boardText(file)
    const text = this.noteLocal(joined)
    if (text === this.last) {
      this.joinOwed = false
      this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
    } else this.write(text)
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

  private readFile(folder: string): ReadResult {
    let text: string
    try {
      text = this.options.fs.readFileSync(join(folder, SYNC_FILE_NAME), 'utf8')
    } catch (err) {
      if (!isMissing(err)) return { kind: 'unavailable', reason: String(err) }
      // No file: only a folder that is still a directory is merely empty (D12).
      try {
        if (this.options.fs.statSync(folder).isDirectory()) return { kind: 'missing' }
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
  private write(boardText: string): void {
    const folder = this.folder
    if (folder === null) return
    const path = join(folder, SYNC_FILE_NAME)
    const tmpPath = `${path}.tmp`
    const now = this.now()
    const fs = this.options.fs
    try {
      const fd = fs.openSync(tmpPath, 'w')
      try {
        fs.writeFileSync(fd, serializeSyncFile(JSON.parse(boardText), now), 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(tmpPath, path)
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
