/**
 * Local Claude Code cards' transcript backups on this machine (#80 D8–D10): one folder per card in
 * `<userData>/transcripts`, named by the sha256 of the card id (0700), holding only the card's
 * current session: `<session id>.jsonl` and, when Claude Code keeps one, the `<session id>/`
 * folder beside it (files 0600, folders 0700), each copied to a `.tmp` and renamed. Never in the
 * state file or the Sync folder. Plain TS with an injected fs, so Vitest drives it; synchronous,
 * like kept output's store, so the copies the renderer asks for at quit are made before main stops
 * the shells.
 */
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { transcriptPath } from './agent-transcript'
import { isSessionId } from './agent-tab'
import { isPathArg } from './directories'
import type { ConversationPrepare } from './claude-retention-types'
import { isCardId } from './ipc-guards'

interface Stats {
  isFile(): boolean
  isDirectory(): boolean
  size: number
  mtimeMs: number
}

/** The synchronous fs calls the backups need (a subset of `node:fs`). */
export interface BackupFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown
  chmodSync(path: string, mode: number): void
  statSync(path: string): Stats
  lstatSync(path: string): Stats & { isSymbolicLink(): boolean }
  copyFileSync(from: string, to: string): void
  utimesSync(path: string, atime: Date, mtime: Date): void
  renameSync(from: string, to: string): void
  rmSync(path: string, options: { recursive: true; force: true }): void
  readdirSync(path: string): string[]
  /** Fails with EEXIST when `to` exists, so a restore never overwrites a file (D11). */
  linkSync(from: string, to: string): void
}

export interface TranscriptBackupsOptions {
  /** `<userData>/transcripts`, created on the first copy. */
  dir: string
  /** The user's home, where Claude Code keeps `.claude/projects`. */
  home: () => string
  fs: BackupFs
  log?: (message: string) => void
}

/**
 * What a backup did: `copied`, `unchanged` (the copy's size and mtime match, D9), `missing` (no
 * transcript, the backup left as it was), `refused` (an invalid card id, folder or session id:
 * nothing read) or `failed`.
 */
export type BackupResult = 'copied' | 'unchanged' | 'missing' | 'refused' | 'failed'

/** The folder name of a card's backups: the sha256 of its id, hex, so any id is a safe name. */
export function backupFolderName(cardId: string): string {
  return createHash('sha256').update(cardId).digest('hex')
}

/**
 * Whether a copy's mtime is the transcript's: copies get it to the millisecond, which the file
 * system may give back a hair off (seconds as a float).
 */
const sameMtime = (copy: number, source: number): boolean => {
  const ms = Math.round(copy)
  // A transcript restored from its copy (D11) has the copy's whole milliseconds, read back a hair
  // under them.
  return ms === Math.trunc(source) || ms === Math.round(source)
}

export class TranscriptBackups {
  constructor(private readonly options: TranscriptBackupsOptions) {}

  /** The card's backup folder (`<dir>/<sha256 of the card id>`). */
  cardFolder(cardId: string): string {
    return join(this.options.dir, backupFolderName(cardId))
  }

  /**
   * Backs up the card's conversation `sessionId`, run in `folder` (D8, D9): copied only when the
   * transcript's size or mtime differs from the copy's; the session's folder beside it copied with
   * it; any other session's files in the card's backup removed (D10). A card id, folder (an
   * absolute existing directory) or session id (a UUID) that doesn't check is refused before
   * anything is read.
   */
  backup(cardId: unknown, folder: unknown, sessionId: unknown): BackupResult {
    if (!isCardId(cardId) || !isSessionId(sessionId) || !isPathArg(folder)) return 'refused'
    const { fs } = this.options
    try {
      if (!fs.statSync(folder).isDirectory()) return 'refused'
    } catch {
      return 'refused'
    }
    const source = transcriptPath(this.options.home(), resolve(folder), sessionId)
    let info: Stats
    try {
      info = fs.statSync(source)
    } catch {
      return 'missing'
    }
    if (!info.isFile()) return 'missing'
    const target = this.cardFolder(cardId)
    const copy = join(target, `${sessionId}.jsonl`)
    try {
      fs.mkdirSync(this.options.dir, { recursive: true, mode: 0o700 })
      fs.chmodSync(this.options.dir, 0o700)
      fs.mkdirSync(target, { recursive: true, mode: 0o700 })
      fs.chmodSync(target, 0o700)
      // Only the current session is kept; leftovers of a failed copy go too.
      for (const name of fs.readdirSync(target)) {
        if (name === sessionId || name === `${sessionId}.jsonl`) continue
        fs.rmSync(join(target, name), { recursive: true, force: true })
      }
      if (this.matches(copy, info)) return 'unchanged'
      // The session's folder first and the transcript last, so a copy whose transcript matches
      // also has the folder copied with it.
      const sessionFolder = source.slice(0, -'.jsonl'.length)
      const folderCopy = join(target, sessionId)
      if (this.isRealFolder(sessionFolder)) {
        const tmp = `${folderCopy}.tmp`
        fs.rmSync(tmp, { recursive: true, force: true })
        this.copyFolder(sessionFolder, tmp)
        fs.rmSync(folderCopy, { recursive: true, force: true })
        fs.renameSync(tmp, folderCopy)
      }
      this.copyFile(source, copy, info.mtimeMs)
      return 'copied'
    } catch (err) {
      this.log(`transcript not backed up: ${String(err)}`)
      return 'failed'
    }
  }

  /**
   * Before a resume (D11): `present` when the session's transcript is in Claude Code's projects
   * for `folder`; else `restored` once the card's backup of that session (transcript and folder)
   * is copied back there, never over a file that appeared meanwhile (then `present`); `missing`
   * with no backup of it. Checked as `backup` checks, `refused` before anything is read.
   */
  prepare(cardId: unknown, folder: unknown, sessionId: unknown): ConversationPrepare {
    if (!isCardId(cardId) || !isSessionId(sessionId) || !isPathArg(folder)) return 'refused'
    const { fs } = this.options
    try {
      if (!fs.statSync(folder).isDirectory()) return 'refused'
    } catch {
      return 'refused'
    }
    const target = transcriptPath(this.options.home(), resolve(folder), sessionId)
    if (this.exists(target)) return 'present'
    const kept = join(this.cardFolder(cardId), `${sessionId}.jsonl`)
    let info: Stats
    try {
      info = fs.statSync(kept)
    } catch {
      return 'missing'
    }
    if (!info.isFile()) return 'missing'
    const tmp = `${target}.bikube-restore`
    try {
      fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      // The session's folder first, so the transcript Claude Code resumes has it beside it.
      const keptFolder = join(this.cardFolder(cardId), sessionId)
      const sessionFolder = target.slice(0, -'.jsonl'.length)
      if (this.isRealFolder(keptFolder) && !this.exists(sessionFolder)) {
        const folderTmp = `${sessionFolder}.bikube-restore`
        fs.rmSync(folderTmp, { recursive: true, force: true })
        this.copyFolder(keptFolder, folderTmp)
        try {
          if (this.exists(sessionFolder)) throw new Error('appeared')
          fs.renameSync(folderTmp, sessionFolder)
        } finally {
          fs.rmSync(folderTmp, { recursive: true, force: true })
        }
      }
      fs.rmSync(tmp, { recursive: true, force: true })
      fs.copyFileSync(kept, tmp)
      fs.chmodSync(tmp, 0o600)
      // The copy's own whole milliseconds, so the next backup finds it unchanged.
      const mtime = new Date(Math.round(info.mtimeMs))
      fs.utimesSync(tmp, mtime, mtime)
      // A link, unlike a rename, fails when the transcript appeared meanwhile.
      try {
        fs.linkSync(tmp, target)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'present'
        throw err
      }
      return 'restored'
    } catch (err) {
      this.log(`transcript not restored: ${String(err)}`)
      return 'failed'
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true })
      } catch {
        // Nothing left to clean.
      }
    }
  }

  /** Removes the card's backups; nothing happens when it has none (D10). */
  delete(cardId: unknown): void {
    if (!isCardId(cardId)) return
    try {
      this.options.fs.rmSync(this.cardFolder(cardId), { recursive: true, force: true })
    } catch (err) {
      this.log(`transcript backup not removed: ${String(err)}`)
    }
  }

  /**
   * At launch (D10): removes everything in the folder but the backups of `keepIds`, so cards no
   * longer on the board leave none. A missing folder is nothing to prune.
   */
  prune(keepIds: Iterable<string>): void {
    const { fs, dir } = this.options
    const keep = new Set<string>()
    for (const id of keepIds) keep.add(backupFolderName(id))
    let names: string[]
    try {
      names = fs.readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (keep.has(name)) continue
      try {
        fs.rmSync(join(dir, name), { recursive: true, force: true })
      } catch (err) {
        this.log(`transcript backup not removed: ${String(err)}`)
      }
    }
  }

  private matches(copy: string, info: Stats): boolean {
    try {
      const kept = this.options.fs.statSync(copy)
      return kept.isFile() && kept.size === info.size && sameMtime(kept.mtimeMs, info.mtimeMs)
    } catch {
      return false
    }
  }

  private exists(path: string): boolean {
    try {
      this.options.fs.lstatSync(path)
      return true
    } catch {
      return false
    }
  }

  private isRealFolder(path: string): boolean {
    try {
      const info = this.options.fs.lstatSync(path)
      return info.isDirectory() && !info.isSymbolicLink()
    } catch {
      return false
    }
  }

  /** Copies `from` to `to` through `<to>.tmp`, 0600, with `from`'s mtime. */
  private copyFile(from: string, to: string, mtimeMs: number): void {
    const { fs } = this.options
    const tmp = `${to}.tmp`
    fs.copyFileSync(from, tmp)
    fs.chmodSync(tmp, 0o600)
    const mtime = new Date(Math.trunc(mtimeMs))
    fs.utimesSync(tmp, mtime, mtime)
    fs.renameSync(tmp, to)
  }

  /** Copies a folder's regular files and folders (never a link), folders 0700 and files 0600. */
  private copyFolder(from: string, to: string): void {
    const { fs } = this.options
    fs.mkdirSync(to, { recursive: true, mode: 0o700 })
    fs.chmodSync(to, 0o700)
    for (const name of fs.readdirSync(from)) {
      const source = join(from, name)
      const info = fs.lstatSync(source)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) this.copyFolder(source, join(to, name))
      else if (info.isFile()) {
        const target = join(to, name)
        fs.copyFileSync(source, target)
        fs.chmodSync(target, 0o600)
      }
    }
  }

  private log(message: string): void {
    ;(this.options.log ?? console.error)(message)
  }
}
