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

export interface SyncFolderOptions {
  fs: StateFileFs
  /** This machine's home directory, which D5 maps to `~`. */
  home: string
  now?: () => Date
  log?: (message: string) => void
  /** Told every status change (D13). */
  onStatus?: (status: SyncStatus) => void
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
    this.cancelPending()
    this.folder = folder
    this.last = null
    if (folder === null) {
      this.setStatus({ kind: 'off' })
      return null
    }
    const read = this.read(folder)
    switch (read.kind) {
      case 'missing':
        this.write(this.boardText(local.workspaces))
        return null
      case 'valid': {
        const joined = joinBoards(read.workspaces, local.workspaces)
        this.last = this.boardText(read.workspaces)
        const text = this.boardText(joined)
        if (text === this.last)
          this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
        else this.write(text)
        return joined
      }
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
   * board and the status. A missing file gets `local`'s board. Not a join (D11).
   */
  start(folder: string | null, local: WorkspaceState): void {
    this.folder = folder
    this.last = null
    if (folder === null) return
    const read = this.read(folder)
    switch (read.kind) {
      case 'missing':
        this.write(this.boardText(local.workspaces))
        return
      case 'valid':
        this.last = this.boardText(read.workspaces)
        this.setStatus({ kind: 'synced', folder, at: this.now().toISOString() })
        return
      case 'unreadable':
        this.log(`sync file unreadable (${read.reason}); not writing`)
        this.setStatus({ kind: 'unreadable', folder })
        return
      case 'unavailable':
        this.log(`sync folder unavailable (${read.reason})`)
        this.setStatus({ kind: 'unavailable', folder })
    }
  }

  /**
   * A board change saved on this machine: written within `SYNC_WRITE_DELAY_MS` when its board
   * differs from the last one read or written (D4). Ignored while sync is off or the file is
   * unreadable (D12: it is never overwritten).
   */
  noteBoard(state: WorkspaceState): void {
    if (this.folder === null || this.current.kind === 'unreadable') return
    const text = this.boardText(state.workspaces)
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
        if (next !== null) this.write(next)
      }, SYNC_WRITE_DELAY_MS)
    }
  }

  /** Writes a pending board now, synchronously (before quit). */
  flush(): void {
    const next = this.pending
    this.cancelPending()
    if (next !== null) this.write(next)
  }

  private cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  private boardText(workspaces: Workspace[]): string {
    return JSON.stringify(toSyncBoard({ workspaces, activeId: null }, this.options.home))
  }

  private read(folder: string): ReadResult {
    let text: string
    try {
      text = this.options.fs.readFileSync(join(folder, SYNC_FILE_NAME), 'utf8')
    } catch (err) {
      if (isMissing(err)) return { kind: 'missing' }
      return { kind: 'unavailable', reason: String(err) }
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
      this.log(`sync file not written: ${String(err)}`)
      this.setStatus({ kind: 'unavailable', folder })
      return
    }
    this.last = boardText
    this.setStatus({ kind: 'synced', folder, at: now.toISOString() })
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
