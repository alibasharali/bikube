/**
 * The saved-state file owned by main (#8 D2, D4, D6). Plain TS with an injected fs, so Vitest
 * can drive it with a fake directory and fake timers.
 */
import { join } from 'node:path'
import type { WorkspaceState } from './workspace-store'
import {
  STATE_FILE_NAME,
  corruptFileName,
  parseSavedState,
  serializeSavedState,
  validateWorkspaceState
} from './saved-state'

export const SAVE_INTERVAL_MS = 200

/** The synchronous fs calls the state file needs (a subset of `node:fs`). */
export interface StateFileFs {
  readFileSync(path: string, encoding: 'utf8'): string
  openSync(path: string, flags: 'w'): number
  writeFileSync(fd: number, data: string, encoding: 'utf8'): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  renameSync(from: string, to: string): void
}

export interface StateFileOptions {
  /** The directory holding `bikube-state.json` (Electron's `userData`). */
  dir: string
  fs: StateFileFs
  now?: () => Date
  log?: (message: string) => void
}

const emptyState = (): WorkspaceState => ({ workspaces: [], activeId: null })

export class StateFile {
  private readonly path: string
  private readonly tmpPath: string
  private latest: WorkspaceState | null = null
  /** Whether `latest` has changes not yet written to the file. */
  private pending = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /**
   * False once a rejected or unreadable file could not be moved aside: nothing is written for
   * the rest of the session, so that file is never overwritten (D4).
   */
  private writable = true

  constructor(private readonly options: StateFileOptions) {
    this.path = join(options.dir, STATE_FILE_NAME)
    this.tmpPath = `${this.path}.tmp`
  }

  load(): WorkspaceState {
    if (this.latest === null) this.latest = this.readFile()
    return this.latest
  }

  /**
   * Keeps `value` as the latest state when it passes D3 and writes it within 200 ms; saves in
   * between replace it (the last wins). Returns false, and changes nothing, for an invalid value.
   */
  save(value: unknown): boolean {
    const checked = validateWorkspaceState(value)
    if (!checked.ok) return false
    this.load()
    this.latest = checked.value
    if (!this.writable) return true
    this.pending = true
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.write()
      }, SAVE_INTERVAL_MS)
    }
    return true
  }

  /** Writes any pending state now, synchronously (before quit). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.write()
  }

  /**
   * Writes `latest` atomically: the temp file first, flushed to disk, then a rename over the
   * state file, so a crash or power loss leaves either the old file or the whole new one.
   */
  private write(): void {
    if (!this.writable || !this.pending || this.latest === null) return
    const fs = this.options.fs
    try {
      const fd = fs.openSync(this.tmpPath, 'w')
      try {
        fs.writeFileSync(fd, serializeSavedState(this.latest), 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(this.tmpPath, this.path)
      this.pending = false
    } catch (err) {
      // Keep the state pending: the next save or flush tries again.
      this.log(`state file not written: ${String(err)}`)
    }
  }

  private now(): Date {
    return this.options.now ? this.options.now() : new Date()
  }

  private log(message: string): void {
    const log = this.options.log ?? console.error
    log(message)
  }

  private readFile(): WorkspaceState {
    let text: string
    try {
      text = this.options.fs.readFileSync(this.path, 'utf8')
    } catch (err) {
      // Missing is a first launch; a file that exists but can't be read is treated as rejected.
      if (!isMissing(err)) this.setAside(`not readable: ${String(err)}`)
      return emptyState()
    }
    const parsed = parseSavedState(text)
    if (parsed.ok) return parsed.value
    this.setAside(`rejected: ${parsed.reason}`)
    return emptyState()
  }

  /** Renames the state file to its corrupt copy; if that fails, stops all writes (D4). */
  private setAside(why: string): void {
    const aside = join(this.options.dir, corruptFileName(this.now()))
    try {
      this.options.fs.renameSync(this.path, aside)
      this.log(`state file ${why}; moved to ${aside}`)
    } catch (err) {
      this.writable = false
      this.log(
        `state file ${why}; could not move it aside (${String(err)}), so nothing will be saved this session`
      )
    }
  }
}

const isMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT'
