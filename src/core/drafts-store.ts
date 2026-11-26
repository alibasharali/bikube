/**
 * Dirty editor tabs' drafts on this machine (#83 D11): one file per tab in `<userData>/drafts`,
 * named by the sha256 of its workspace id and real path, the folder 0700 and each file 0600,
 * written to a temporary file and renamed. Never in the state file or the Sync folder. Plain TS
 * with an injected fs, so Vitest drives it; synchronous, as kept output's store, so the drafts the
 * window sends as the app quits are on disk before it says its quit saves were sent.
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isPathArg } from './directories'
import { parseEditorFileRef, parseEditorWrite } from './editor-files'
import type { EditorDraft } from './editor-files-types'

/** The synchronous fs calls the store needs (a subset of `node:fs`). */
export interface DraftsFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): unknown
  chmodSync(path: string, mode: number): void
  openSync(path: string, flags: 'w', mode: number): number
  writeFileSync(fd: number, data: string, encoding: 'utf8'): void
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  renameSync(from: string, to: string): void
  readFileSync(path: string, encoding: 'utf8'): string
  rmSync(path: string, options: { force: true }): void
  readdirSync(path: string): string[]
}

export interface DraftsStoreOptions {
  /** `<userData>/drafts`, created on the first save. */
  dir: string
  fs: DraftsFs
  log?: (message: string) => void
}

/** The longest workspace id a draft may name. */
const MAX_WORKSPACE_ID_LENGTH = 200

const isWorkspaceId = (id: unknown): id is string =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= MAX_WORKSPACE_ID_LENGTH &&
  !id.includes('\n') &&
  !id.includes('\0')

/** A draft file's name: the sha256 of its workspace id and the tab's real path, hex. */
export function draftFileName(workspaceId: string, realPath: string): string {
  return createHash('sha256').update(`${workspaceId}\n${realPath}`).digest('hex')
}

/**
 * A draft as the renderer sent it or a file holds it, checked for shape (D6's reference, D12's
 * text limit and base); null for anything else.
 */
export function parseEditorDraft(value: unknown): EditorDraft | null {
  if (typeof value !== 'object' || value === null) return null
  const { workspaceId, ref, realPath } = value as Record<string, unknown>
  if (!isWorkspaceId(workspaceId) || !isPathArg(realPath)) return null
  const parsedRef = parseEditorFileRef(ref)
  const write = parseEditorWrite(value)
  if (!parsedRef || !write) return null
  const { text, eol, bom, base } = write
  return { workspaceId, ref: parsedRef, realPath, text, eol, bom, base }
}

export class DraftsStore {
  constructor(private readonly options: DraftsStoreOptions) {}

  /** Replaces the tab's draft; false, writing nothing, for a malformed one or a failed write. */
  save(value: unknown): boolean {
    const draft = parseEditorDraft(value)
    if (!draft) return false
    const { fs, dir } = this.options
    const path = this.path(draft.workspaceId, draft.realPath)
    const tmp = `${path}.tmp`
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.chmodSync(dir, 0o700)
      const fd = fs.openSync(tmp, 'w', 0o600)
      try {
        fs.writeFileSync(fd, JSON.stringify(draft), 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      // A temporary file left by a crash may predate the mode above.
      fs.chmodSync(tmp, 0o600)
      fs.renameSync(tmp, path)
      return true
    } catch (err) {
      this.log(`draft not saved: ${String(err)}`)
      return false
    }
  }

  /** Removes the tab's draft; nothing happens when it has none. */
  delete(workspaceId: unknown, realPath: unknown): void {
    if (!isWorkspaceId(workspaceId) || !isPathArg(realPath)) return
    this.remove(this.path(workspaceId, realPath))
  }

  /**
   * Every draft in the folder (D11's restore at launch). A file that can't be read, isn't a
   * draft or isn't named for the draft it holds is removed; temporary files are left to `prune`.
   */
  list(): EditorDraft[] {
    const drafts: EditorDraft[] = []
    for (const name of this.names()) {
      if (name.endsWith('.tmp')) continue
      const draft = this.read(name)
      if (draft) drafts.push(draft)
      else this.remove(join(this.options.dir, name))
    }
    return drafts
  }

  /**
   * At launch (D11): removes every file in the folder but the drafts of `workspaceIds`, so drafts
   * of deleted workspaces, malformed files and temporary files a failed save left are gone. A
   * missing folder is nothing to prune.
   */
  prune(workspaceIds: Iterable<string>): void {
    const keep = new Set(workspaceIds)
    for (const name of this.names()) {
      const draft = name.endsWith('.tmp') ? null : this.read(name)
      if (draft && keep.has(draft.workspaceId)) continue
      this.remove(join(this.options.dir, name))
    }
  }

  private read(name: string): EditorDraft | null {
    try {
      const draft = parseEditorDraft(
        JSON.parse(this.options.fs.readFileSync(join(this.options.dir, name), 'utf8'))
      )
      return draft && draftFileName(draft.workspaceId, draft.realPath) === name ? draft : null
    } catch {
      return null
    }
  }

  private names(): string[] {
    try {
      return this.options.fs.readdirSync(this.options.dir)
    } catch {
      return []
    }
  }

  private remove(path: string): void {
    try {
      this.options.fs.rmSync(path, { force: true })
    } catch (err) {
      this.log(`draft not removed: ${String(err)}`)
    }
  }

  private path(workspaceId: string, realPath: string): string {
    return join(this.options.dir, draftFileName(workspaceId, realPath))
  }

  private log(message: string): void {
    ;(this.options.log ?? console.error)(message)
  }
}
