/**
 * Cards' kept output on this machine (#46 D4): one file per card in `<userData>/scrollback`, named
 * by the sha256 of the card id, the folder 0700 and each file 0600, written to a temporary file
 * and renamed. Never in the state file or the Sync folder. Plain TS with an injected fs, so Vitest
 * drives it; synchronous, so a save and the next start's read reach the disk in the order sent.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isCardId } from './ipc-guards'
import { MAX_KEPT_CHARS, type KeptOutput } from './kept-output'

/** The synchronous fs calls the store needs (a subset of `node:fs`). */
export interface ScrollbackFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown
  chmodSync(path: string, mode: number): void
  openSync(path: string, flags: 'w', mode: number): number
  writeFileSync(fd: number, data: string, encoding: 'utf8'): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  renameSync(from: string, to: string): void
  readFileSync(path: string, encoding: 'utf8'): string
  statSync(path: string): { mtimeMs: number }
  rmSync(path: string, options: { force: true }): void
  readdirSync(path: string): string[]
}

export interface ScrollbackStoreOptions {
  /** `<userData>/scrollback`, created on the first save. */
  dir: string
  fs: ScrollbackFs
  log?: (message: string) => void
}

/** The file name of a card's save: the sha256 of its id, hex, so any id is a safe name. */
export function scrollbackFileName(cardId: string): string {
  return createHash('sha256').update(cardId).digest('hex')
}

export class ScrollbackStore {
  constructor(private readonly options: ScrollbackStoreOptions) {}

  /** The card's save, or null when it has none (or it can't be read, or is too long). */
  read(cardId: unknown): KeptOutput | null {
    if (!isCardId(cardId)) return null
    const path = this.path(cardId)
    try {
      const data = this.options.fs.readFileSync(path, 'utf8')
      if (data.length > MAX_KEPT_CHARS) return null
      return { data, savedAt: this.options.fs.statSync(path).mtimeMs }
    } catch {
      return null
    }
  }

  /**
   * Replaces the card's save with `data`; false, writing nothing, for an invalid id, data that
   * isn't a string or is longer than `MAX_KEPT_CHARS` (D3), or a failed write.
   */
  save(cardId: unknown, data: unknown): boolean {
    if (!isCardId(cardId) || typeof data !== 'string' || data.length > MAX_KEPT_CHARS) return false
    const { fs, dir } = this.options
    const path = this.path(cardId)
    const tmp = `${path}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.chmodSync(dir, 0o700)
      const fd = fs.openSync(tmp, 'w', 0o600)
      try {
        fs.writeFileSync(fd, data, 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      // A temporary file left by a crash may predate the mode above.
      fs.chmodSync(tmp, 0o600)
      fs.renameSync(tmp, path)
      return true
    } catch (err) {
      this.log(`kept output not saved: ${String(err)}`)
      return false
    }
  }

  /** Removes the card's save; nothing happens when it has none (D7). */
  delete(cardId: unknown): void {
    if (!isCardId(cardId)) return
    try {
      this.options.fs.rmSync(this.path(cardId), { force: true })
    } catch (err) {
      this.log(`kept output not removed: ${String(err)}`)
    }
  }

  /**
   * At launch (D7): removes every file in the folder but the saves of `keepIds`, so saves of
   * cards no longer on the board and temporary files a failed save left are gone. A missing
   * folder is nothing to prune.
   */
  prune(keepIds: Iterable<string>): void {
    const { fs, dir } = this.options
    const keep = new Set<string>()
    for (const id of keepIds) keep.add(scrollbackFileName(id))
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (keep.has(name)) continue
      try {
        fs.rmSync(join(dir, name), { force: true })
      } catch (err) {
        this.log(`kept output not removed: ${String(err)}`)
      }
    }
  }

  private path(cardId: string): string {
    return join(this.options.dir, scrollbackFileName(cardId))
  }

  private log(message: string): void {
    ;(this.options.log ?? console.error)(message)
  }
}
