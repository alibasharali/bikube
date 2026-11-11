/**
 * Local Claude Code cards' transcript backups on this machine (#80 D8–D10): one folder per card in
 * `<userData>/transcripts`, named by the sha256 of the card id (0700), holding only the card's
 * current session: `<session id>.jsonl` and, when Claude Code keeps one, the `<session id>/`
 * folder beside it (files 0600, folders 0700), each file copied to a `.tmp` and renamed. Never in
 * the state file or the Sync folder. Plain TS with an injected fs, so Vitest drives it. Backups use
 * async fs, one at a time per card (`backup`, `delete` and `prepare` share the card's queue), so a
 * long session's copy never stalls main's event loop; main awaits `idle()` at quit before it stops
 * the shells. A session's folder is copied file by file, only what changed. A transcript smaller
 * than the backup of the same session is never copied over it (`kept`): transcripts only grow, so
 * a smaller one is Claude Code's cleanup having deleted it and a later write starting it again.
 * Claude Code may key a project on the folder's real path: the folder as given is tried first,
 * then its real path when different.
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

type LStats = Stats & { isSymbolicLink(): boolean }

/** The async fs calls a backup makes (a subset of `node:fs/promises`). */
export interface AsyncBackupFs {
  mkdir(path: string, options: { recursive: true; mode: number }): Promise<unknown>
  chmod(path: string, mode: number): Promise<void>
  stat(path: string): Promise<Stats>
  lstat(path: string): Promise<LStats>
  realpath(path: string): Promise<string>
  copyFile(from: string, to: string): Promise<void>
  utimes(path: string, atime: Date, mtime: Date): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(path: string, options: { recursive: true; force: true }): Promise<void>
  readdir(path: string): Promise<string[]>
}

/** The fs calls the backups need (a subset of `node:fs`): synchronous for restore and pruning. */
export interface BackupFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown
  chmodSync(path: string, mode: number): void
  statSync(path: string): Stats
  lstatSync(path: string): LStats
  realpathSync(path: string): string
  copyFileSync(from: string, to: string): void
  renameSync(from: string, to: string): void
  rmSync(path: string, options: { recursive: true; force: true }): void
  readdirSync(path: string): string[]
  /** Fails with EEXIST when `to` exists, so a restore never overwrites a file (D11). */
  linkSync(from: string, to: string): void
  promises: AsyncBackupFs
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
 * What a backup did: `copied`, `unchanged` (the copy's size and mtime match, D9), `kept` (the
 * transcript is smaller than the backup of the same session, which is kept), `missing` (no
 * transcript, the backup left as it was), `refused` (an invalid card id, folder or session id:
 * nothing read) or `failed`.
 */
export type BackupResult = 'copied' | 'unchanged' | 'kept' | 'missing' | 'refused' | 'failed'

/** The folder name of a card's backups: the sha256 of its id, hex, so any id is a safe name. */
export function backupFolderName(cardId: string): string {
  return createHash('sha256').update(cardId).digest('hex')
}

/**
 * Whether a copy's mtime is the source's: copies get it to the millisecond, which the file system
 * may give back a hair off (seconds as a float).
 */
const sameMtime = (copy: number, source: number): boolean => {
  const ms = Math.round(copy)
  return ms === Math.trunc(source) || ms === Math.round(source)
}

const unchangedCopy = (copy: Stats | null, source: Stats): boolean =>
  copy !== null &&
  copy.isFile() &&
  copy.size === source.size &&
  sameMtime(copy.mtimeMs, source.mtimeMs)

/** The suffix of a session folder file's copy in progress. */
const TMP = '.bikube-tmp'

export class TranscriptBackups {
  /** Each card's last queued task, so its backups run one at a time. */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** Card and session pairs whose smaller transcript was already logged. */
  private readonly keptLogged = new Set<string>()

  constructor(private readonly options: TranscriptBackupsOptions) {}

  /** The card's backup folder (`<dir>/<sha256 of the card id>`). */
  cardFolder(cardId: string): string {
    return join(this.options.dir, backupFolderName(cardId))
  }

  /** Whether any card's task (backup, delete, restore) is queued or running. */
  busy(): boolean {
    return this.queues.size > 0
  }

  /** Settles once every task queued so far (backups, deletes, restores) is done. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.queues.values()])
  }

  /**
   * Backs up the card's conversation `sessionId`, run in `folder` (D8, D9), after the card's
   * earlier tasks: copied only when the transcript's size or mtime differs from the copy's (never
   * when smaller than the copy: `kept`); the session's folder beside it copied with it, only its
   * changed files; any other session's files in the card's backup removed (D10). A card id, folder
   * (an absolute existing directory) or session id (a UUID) that doesn't check is refused before
   * anything is read.
   */
  backup(cardId: unknown, folder: unknown, sessionId: unknown): Promise<BackupResult> {
    if (!isCardId(cardId) || !isSessionId(sessionId) || !isPathArg(folder)) {
      return Promise.resolve('refused')
    }
    return this.queued(cardId, () => this.backupNow(cardId, folder, sessionId))
  }

  /**
   * Before a resume (D11), after the card's earlier tasks: `present` when the session's transcript
   * is in Claude Code's projects for `folder` (as given or its real path); else `restored` once the
   * card's backup of that session (transcript and folder) is copied back there with the current
   * time (so Claude Code's cleanup, run as the resuming `claude` starts, doesn't find it old again),
   * never over a file that appeared meanwhile (then `present`); `missing` with no backup of it. It
   * goes under the real path's project folder when that one exists, else under the folder's as
   * given. Checked as `backup` checks, `refused` before anything is read.
   */
  prepare(cardId: unknown, folder: unknown, sessionId: unknown): Promise<ConversationPrepare> {
    if (!isCardId(cardId) || !isSessionId(sessionId) || !isPathArg(folder)) {
      return Promise.resolve('refused')
    }
    return this.queued(cardId, () => this.prepareNow(cardId, folder, sessionId))
  }

  private queued<T>(cardId: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.queues.get(cardId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.catch(() => undefined)
    this.queues.set(cardId, settled)
    void settled.then(() => {
      if (this.queues.get(cardId) === settled) this.queues.delete(cardId)
    })
    return run
  }

  /** The transcript paths `folder` may be keyed by: as given, then its real path when different. */
  private candidates(folder: string, sessionId: string, real: string | null): string[] {
    const home = this.options.home()
    const given = transcriptPath(home, resolve(folder), sessionId)
    if (real === null || real === resolve(folder)) return [given]
    return [given, transcriptPath(home, real, sessionId)]
  }

  private async backupNow(
    cardId: string,
    folder: string,
    sessionId: string
  ): Promise<BackupResult> {
    const fs = this.options.fs.promises
    let real: string | null
    try {
      if (!(await fs.stat(folder)).isDirectory()) return 'refused'
      real = await fs.realpath(folder).catch(() => null)
    } catch {
      return 'refused'
    }
    let source: string | null = null
    let info: Stats | null = null
    for (const path of this.candidates(folder, sessionId, real)) {
      const found = await fs.stat(path).catch(() => null)
      if (found?.isFile()) {
        source = path
        info = found
        break
      }
    }
    if (source === null || info === null) return 'missing'
    const target = this.cardFolder(cardId)
    const copy = join(target, `${sessionId}.jsonl`)
    try {
      await fs.mkdir(this.options.dir, { recursive: true, mode: 0o700 })
      await fs.chmod(this.options.dir, 0o700)
      await fs.mkdir(target, { recursive: true, mode: 0o700 })
      await fs.chmod(target, 0o700)
      // Only the current session is kept; leftovers of a failed copy go too.
      for (const name of await fs.readdir(target)) {
        if (name === sessionId || name === `${sessionId}.jsonl`) continue
        await fs.rm(join(target, name), { recursive: true, force: true })
      }
      const kept = await fs.stat(copy).catch(() => null)
      if (unchangedCopy(kept, info)) return 'unchanged'
      if (kept !== null && kept.isFile() && info.size < kept.size) {
        const key = `${cardId}\n${sessionId}`
        if (!this.keptLogged.has(key)) {
          this.keptLogged.add(key)
          this.log(
            `transcript ${sessionId} is smaller than its backup (${info.size} < ${kept.size} bytes): backup kept`
          )
        }
        return 'kept'
      }
      // The session's folder first and the transcript last, so a copy whose transcript matches
      // also has the folder copied with it.
      const sessionFolder = source.slice(0, -'.jsonl'.length)
      const folderCopy = join(target, sessionId)
      if (await this.isRealFolder(sessionFolder)) await this.syncFolder(sessionFolder, folderCopy)
      await this.copyFile(source, copy, info.mtimeMs)
      return 'copied'
    } catch (err) {
      this.log(`transcript not backed up: ${String(err)}`)
      return 'failed'
    }
  }

  private prepareNow(cardId: string, folder: string, sessionId: string): ConversationPrepare {
    const { fs } = this.options
    let real: string | null
    try {
      if (!fs.statSync(folder).isDirectory()) return 'refused'
      real = fs.realpathSync(folder)
    } catch {
      return 'refused'
    }
    const candidates = this.candidates(folder, sessionId, real)
    if (candidates.some((path) => this.exists(path))) return 'present'
    const kept = join(this.cardFolder(cardId), `${sessionId}.jsonl`)
    let info: Stats
    try {
      info = fs.statSync(kept)
    } catch {
      return 'missing'
    }
    if (!info.isFile()) return 'missing'
    // The real path's project folder when Claude Code already keeps one there, else the given's.
    const target =
      candidates.find((path, i) => i > 0 && this.exists(dirname(path))) ?? candidates[0]
    const tmp = `${target}.bikube-restore`
    try {
      fs.mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      // The session's folder first, so the transcript Claude Code resumes has it beside it.
      const keptFolder = join(this.cardFolder(cardId), sessionId)
      const sessionFolder = target.slice(0, -'.jsonl'.length)
      if (this.isRealFolderSync(keptFolder) && !this.exists(sessionFolder)) {
        const folderTmp = `${sessionFolder}.bikube-restore`
        fs.rmSync(folderTmp, { recursive: true, force: true })
        this.copyFolderSync(keptFolder, folderTmp)
        try {
          if (this.exists(sessionFolder)) throw new Error('appeared')
          fs.renameSync(folderTmp, sessionFolder)
        } finally {
          fs.rmSync(folderTmp, { recursive: true, force: true })
        }
      }
      fs.rmSync(tmp, { recursive: true, force: true })
      // A plain copy has the current time, so the restored transcript isn't old to Claude Code.
      fs.copyFileSync(kept, tmp)
      fs.chmodSync(tmp, 0o600)
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

  /**
   * Removes the card's backups, after its earlier tasks; nothing happens when it has none (D10).
   */
  delete(cardId: unknown): Promise<void> {
    if (!isCardId(cardId)) return Promise.resolve()
    return this.queued(cardId, async () => {
      try {
        await this.options.fs.promises.rm(this.cardFolder(cardId), { recursive: true, force: true })
      } catch (err) {
        this.log(`transcript backup not removed: ${String(err)}`)
      }
    })
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

  private exists(path: string): boolean {
    try {
      this.options.fs.lstatSync(path)
      return true
    } catch {
      return false
    }
  }

  private isRealFolderSync(path: string): boolean {
    try {
      const info = this.options.fs.lstatSync(path)
      return info.isDirectory() && !info.isSymbolicLink()
    } catch {
      return false
    }
  }

  private async isRealFolder(path: string): Promise<boolean> {
    const info = await this.options.fs.promises.lstat(path).catch(() => null)
    return info !== null && info.isDirectory() && !info.isSymbolicLink()
  }

  /** Copies `from` to `to` through `<to>.tmp`, 0600, with `from`'s mtime. */
  private async copyFile(
    from: string,
    to: string,
    mtimeMs: number,
    tmp = `${to}.tmp`
  ): Promise<void> {
    const fs = this.options.fs.promises
    await fs.copyFile(from, tmp)
    await fs.chmod(tmp, 0o600)
    const mtime = new Date(Math.trunc(mtimeMs))
    await fs.utimes(tmp, mtime, mtime)
    await fs.rename(tmp, to)
  }

  /**
   * Brings the copy `to` of a session's folder up to `from`: regular files and folders (never a
   * link), folders 0700 and files 0600; a file copied only when its size or mtime differs from its
   * copy's, through a `.bikube-tmp` beside it; anything in the copy no longer in `from` removed.
   */
  private async syncFolder(from: string, to: string): Promise<void> {
    const fs = this.options.fs.promises
    const existing = await fs.lstat(to).catch(() => null)
    if (existing !== null && (!existing.isDirectory() || existing.isSymbolicLink())) {
      await fs.rm(to, { recursive: true, force: true })
    }
    await fs.mkdir(to, { recursive: true, mode: 0o700 })
    await fs.chmod(to, 0o700)
    const wanted = new Set<string>()
    for (const name of await fs.readdir(from)) {
      if (name.endsWith(TMP)) continue
      const source = join(from, name)
      const info = await fs.lstat(source).catch(() => null)
      if (info === null || info.isSymbolicLink()) continue
      const target = join(to, name)
      if (info.isDirectory()) {
        wanted.add(name)
        await this.syncFolder(source, target)
      } else if (info.isFile()) {
        wanted.add(name)
        const copy = await fs.lstat(target).catch(() => null)
        if (copy !== null && !copy.isSymbolicLink() && unchangedCopy(copy, info)) continue
        if (copy !== null && !copy.isFile()) await fs.rm(target, { recursive: true, force: true })
        await this.copyFile(source, target, info.mtimeMs, `${target}${TMP}`)
      }
    }
    for (const name of await fs.readdir(to)) {
      if (!wanted.has(name)) await fs.rm(join(to, name), { recursive: true, force: true })
    }
  }

  /** Copies a folder's regular files and folders (never a link), folders 0700 and files 0600. */
  private copyFolderSync(from: string, to: string): void {
    const { fs } = this.options
    fs.mkdirSync(to, { recursive: true, mode: 0o700 })
    fs.chmodSync(to, 0o700)
    for (const name of fs.readdirSync(from)) {
      const source = join(from, name)
      const info = fs.lstatSync(source)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) this.copyFolderSync(source, join(to, name))
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
