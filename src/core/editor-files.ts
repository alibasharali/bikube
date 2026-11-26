/**
 * The file editor's file access in main (#83 D6, D7, D12, D13): every request names its file by
 * an `EditorFileRef`, checked before anything is read: a folder reference's path must resolve
 * inside the folder by real path (as the Files tab's `insideFolder`), a listed one must be a path
 * Agent setup's last read of the folder listed (`ListedPaths`). Reads and writes go to the real
 * path, so a symlink inside the folder edits its target and stays a link. Plain TS: the file
 * system is injected (the real one by default), so Vitest drives real temporary folders.
 */

import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  link,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ListedPaths } from './agent-setup-open'
import { isPathArg } from './directories'
import {
  EDITOR_IMAGE_LIMIT,
  EDITOR_TEXT_LIMIT,
  imageMimeType,
  type EditorFileBase,
  type EditorFileRef,
  type EditorReadResult,
  type EditorStatResult,
  type EditorWrite,
  type EditorWriteResult
} from './editor-files-types'
import { isTreePath } from './file-tree'

interface FileStats {
  isFile(): boolean
  isDirectory(): boolean
  size: number
  mtimeMs: number
  mode: number
}

/** The file system calls the editor makes. */
export interface EditorFs {
  access(path: string, mode: number): Promise<void>
  realpath(path: string): Promise<string>
  stat(path: string): Promise<FileStats>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array, options: { mode: number; flag: 'wx' }): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  /** For D11's recreate, which never replaces a file that appeared meanwhile; Node's by default. */
  link?(existing: string, path: string): Promise<void>
}

const nodeFs: EditorFs = {
  access,
  realpath,
  stat,
  readFile,
  writeFile,
  chmod,
  rename,
  unlink,
  link
}

export interface EditorFileDeps {
  /** The files Agent setup's last read of each folder listed (D6's `listed` references). */
  listed: Pick<ListedPaths, 'has' | 'knows'>
  /**
   * Reads Agent setup for a folder with no listing yet, filling `listed` (main's `agentSetup:read`
   * path): after a restart a restored draft's listed reference is checked against a fresh read
   * rather than refused (D11). Called once per folder until it has a listing; a failure refuses.
   */
  loadListing?: (folder: string) => Promise<void>
  fs?: EditorFs
}

const BOM = [0xef, 0xbb, 0xbf]

const within = (base: string, path: string): boolean => {
  const rel = relative(base, path)
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
}

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException | null)?.code === 'ENOENT' ||
  (error as NodeJS.ErrnoException | null)?.code === 'ENOTDIR'

/**
 * A reference as the renderer sent it, checked for shape only (D6): an absolute folder, and a
 * relative path for `folder` or an absolute normalized one for `listed`; null for anything else.
 */
export function parseEditorFileRef(value: unknown): EditorFileRef | null {
  if (typeof value !== 'object' || value === null) return null
  const { kind, folder, path } = value as Record<string, unknown>
  if (!isPathArg(folder)) return null
  if (kind === 'folder' && isTreePath(path)) return { kind, folder, path }
  if (kind === 'listed' && isPathArg(path) && resolve(path) === path) return { kind, folder, path }
  return null
}

/** A save's request checked for shape (D12); null for anything else, text over 5 MB included. */
export function parseEditorWrite(value: unknown): EditorWrite | null {
  if (typeof value !== 'object' || value === null) return null
  const { text, eol, bom, base, recreate } = value as Record<string, unknown>
  if (typeof text !== 'string' || text.length > EDITOR_TEXT_LIMIT) return null
  if (recreate !== undefined && recreate !== true) return null
  if ((eol !== 'lf' && eol !== 'crlf') || typeof bom !== 'boolean') return null
  if (typeof base !== 'object' || base === null) return null
  const { size, mtimeMs, sha256 } = base as Record<string, unknown>
  if (typeof size !== 'number' || !Number.isFinite(size)) return null
  if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  const write: EditorWrite = { text, eol, bom, base: { size, mtimeMs, sha256 } }
  return recreate === true ? { ...write, recreate } : write
}

/**
 * Whether Agent setup's last read of the listed reference's folder listed its path (D6), reading
 * the folder first when it has no listing yet (`loadListing`); a failed read refuses.
 */
async function isListed(
  ref: Extract<EditorFileRef, { kind: 'listed' }>,
  deps: EditorFileDeps
): Promise<boolean> {
  const folder = resolve(ref.folder)
  if (!deps.listed.knows(folder) && deps.loadListing) {
    try {
      await deps.loadListing(folder)
    } catch {
      return false
    }
  }
  return deps.listed.has(ref.folder, ref.path)
}

/**
 * The real path of the file `ref` names (D6), `missing` when it doesn't exist, `refused` when the
 * reference is malformed, escapes its folder, isn't listed or names anything but a regular file.
 * Nothing is read before the checks pass.
 */
async function resolveRef(
  value: unknown,
  deps: EditorFileDeps
): Promise<{ real: string; stats: FileStats } | 'missing' | 'refused'> {
  const fs = deps.fs ?? nodeFs
  const ref = parseEditorFileRef(value)
  if (!ref) return 'refused'
  let real: string
  if (ref.kind === 'folder') {
    const named = resolve(ref.folder, ref.path)
    if (!within(ref.folder, named) || named === resolve(ref.folder)) return 'refused'
    let rootReal: string
    try {
      rootReal = await fs.realpath(ref.folder)
    } catch {
      return 'refused'
    }
    try {
      real = await fs.realpath(named)
    } catch (error) {
      return isMissing(error) ? 'missing' : 'refused'
    }
    if (!within(rootReal, real)) return 'refused'
  } else {
    if (!(await isListed(ref, deps))) return 'refused'
    try {
      real = await fs.realpath(ref.path)
    } catch (error) {
      return isMissing(error) ? 'missing' : 'refused'
    }
  }
  try {
    const stats = await fs.stat(real)
    return stats.isFile() ? { real, stats } : 'refused'
  } catch (error) {
    return isMissing(error) ? 'missing' : 'refused'
  }
}

/**
 * Where a file `ref` names that is gone would be written again (D11's recreate): its parent
 * folder's real path and its name, the parent inside the folder by real path for a folder
 * reference and still listed for a listed one; `no-folder` when the parent is gone, `refused`
 * when the request is malformed or escapes.
 */
async function resolveNewFile(
  value: unknown,
  deps: EditorFileDeps
): Promise<string | 'no-folder' | 'refused'> {
  const fs = deps.fs ?? nodeFs
  const ref = parseEditorFileRef(value)
  if (!ref) return 'refused'
  let named: string
  let rootReal: string | null = null
  if (ref.kind === 'folder') {
    named = resolve(ref.folder, ref.path)
    if (!within(ref.folder, named) || named === resolve(ref.folder)) return 'refused'
    try {
      rootReal = await fs.realpath(ref.folder)
    } catch {
      return 'refused'
    }
  } else {
    if (!(await isListed(ref, deps))) return 'refused'
    named = ref.path
  }
  let parent: string
  try {
    parent = await fs.realpath(dirname(named))
    if (!(await fs.stat(parent)).isDirectory()) return 'refused'
  } catch (error) {
    return isMissing(error) ? 'no-folder' : 'refused'
  }
  const target = join(parent, basename(named))
  if (rootReal !== null && (!within(rootReal, target) || target === rootReal)) return 'refused'
  return target
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

const baseOf = (data: Uint8Array, mtimeMs: number): EditorFileBase => ({
  size: data.length,
  mtimeMs,
  sha256: sha256(data)
})

const hasBom = (data: Uint8Array): boolean =>
  data.length >= 3 && data[0] === BOM[0] && data[1] === BOM[1] && data[2] === BOM[2]

/**
 * Reads the file `ref` names (D7): a picture (by extension, up to 20 MB) as a `data:` URL; any
 * other file up to 5 MB as text when it has no NUL byte and decodes as UTF-8, its BOM and line
 * endings noted and taken off; else `binary`, `too-large`, `missing` or `refused`.
 */
export async function readEditorFile(
  value: unknown,
  deps: EditorFileDeps
): Promise<EditorReadResult> {
  const fs = deps.fs ?? nodeFs
  const found = await resolveRef(value, deps)
  if (found === 'missing') return { kind: 'missing' }
  if (found === 'refused') return { kind: 'refused' }
  const { real, stats } = found
  const mime = imageMimeType((value as EditorFileRef).path)
  const limit = mime ? EDITOR_IMAGE_LIMIT : EDITOR_TEXT_LIMIT
  if (stats.size > limit) return { kind: 'too-large', size: stats.size, realPath: real }
  let data: Uint8Array
  try {
    data = await fs.readFile(real)
  } catch (error) {
    return isMissing(error) ? { kind: 'missing' } : { kind: 'refused' }
  }
  // It grew between the stat and the read.
  if (data.length > limit) return { kind: 'too-large', size: data.length, realPath: real }
  const base = baseOf(data, stats.mtimeMs)
  if (mime) {
    const dataUrl = `data:${mime};base64,${Buffer.from(data).toString('base64')}`
    return { kind: 'image', dataUrl, base, realPath: real }
  }
  if (data.includes(0)) return { kind: 'binary', realPath: real }
  const bom = hasBom(data)
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bom ? data.subarray(3) : data
    )
  } catch {
    return { kind: 'binary', realPath: real }
  }
  const lineBreak = decoded.indexOf('\n')
  const eol = lineBreak > 0 && decoded[lineBreak - 1] === '\r' ? 'crlf' : 'lf'
  return {
    kind: 'text',
    text: decoded.replace(/\r\n/g, '\n'),
    eol,
    bom,
    base,
    realPath: real
  }
}

/** The size and mtime of the file `ref` names (D13), for a cheap check before any read. */
export async function statEditorFile(
  value: unknown,
  deps: EditorFileDeps
): Promise<EditorStatResult> {
  const found = await resolveRef(value, deps)
  if (typeof found === 'string') return { kind: found }
  return { kind: 'file', size: found.stats.size, mtimeMs: found.stats.mtimeMs }
}

const sameBase = (a: EditorFileBase, b: EditorFileBase): boolean =>
  a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256

/** The bytes a save writes: the text with its line endings and BOM back. */
function fileBytes(write: EditorWrite): Buffer {
  const lf = write.text.replace(/\r\n/g, '\n')
  const body = Buffer.from(write.eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf, 'utf8')
  return write.bom ? Buffer.concat([Buffer.from(BOM), body]) : body
}

/**
 * Writes a file that is gone again (D11's `Deleted on disk` Save) where its folder still exists:
 * a `.tmp` beside it with the default mode (the umask applies), linked into place, so a file that
 * appeared meanwhile is never replaced (`conflict`), then the `.tmp` removed.
 */
async function recreateEditorFile(
  value: unknown,
  write: EditorWrite,
  deps: EditorFileDeps
): Promise<EditorWriteResult> {
  const fs = deps.fs ?? nodeFs
  const target = await resolveNewFile(value, deps)
  if (target === 'refused') return { ok: false, reason: 'refused' }
  if (target === 'no-folder') return { ok: false, reason: 'failed', message: 'folder not found' }
  const data = fileBytes(write)
  const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.writeFile(tmp, data, { mode: 0o666, flag: 'wx' })
    await (fs.link ?? link)(tmp, target)
  } catch (error) {
    await fs.unlink(tmp).catch(() => {})
    if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
      return { ok: false, reason: 'conflict' }
    }
    return { ok: false, reason: 'failed', message: writeFailureReason(error) }
  }
  await fs.unlink(tmp).catch(() => {})
  try {
    const written = await fs.stat(target)
    return { ok: true, base: baseOf(data, written.mtimeMs) }
  } catch (error) {
    return { ok: false, reason: 'failed', message: writeFailureReason(error) }
  }
}

/** A write failure as `Couldn't save <name>: <reason>` ends (D12). */
export function writeFailureReason(error: unknown): string {
  const { code, message } = (error ?? {}) as NodeJS.ErrnoException
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'permission denied'
    case 'EROFS':
      return 'read-only file system'
    case 'ENOSPC':
      return 'no space left on device'
    case 'EDQUOT':
      return 'disk quota exceeded'
    default:
      return typeof message === 'string' && message !== '' ? message : 'the write failed'
  }
}

/**
 * Saves `write` to the file `ref` names (D12) only while the file still matches `write.base`
 * (size, mtime and hash), else `conflict` and nothing is written; a file the user can't write is
 * `failed` with `permission denied`. The text gets its line endings and BOM back and goes to a
 * `.tmp` beside the real file, with the file's mode, renamed over it.
 */
export async function writeEditorFile(
  value: unknown,
  request: unknown,
  deps: EditorFileDeps
): Promise<EditorWriteResult> {
  const fs = deps.fs ?? nodeFs
  const write = parseEditorWrite(request)
  if (!write) return { ok: false, reason: 'refused' }
  const found = await resolveRef(value, deps)
  if (found === 'missing') {
    return write.recreate
      ? recreateEditorFile(value, write, deps)
      : { ok: false, reason: 'missing' }
  }
  if (found === 'refused') return { ok: false, reason: 'refused' }
  const { real, stats } = found
  // A rename needs only the folder's write access: a file the user can't write stays as it is.
  try {
    await fs.access(real, constants.W_OK)
  } catch (error) {
    if (isMissing(error)) return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'failed', message: writeFailureReason(error) }
  }
  if (stats.size !== write.base.size || stats.mtimeMs !== write.base.mtimeMs) {
    return { ok: false, reason: 'conflict' }
  }
  try {
    const current = await fs.readFile(real)
    if (!sameBase(baseOf(current, stats.mtimeMs), write.base)) {
      return { ok: false, reason: 'conflict' }
    }
  } catch (error) {
    if (isMissing(error)) return { ok: false, reason: 'missing' }
    return { ok: false, reason: 'failed', message: writeFailureReason(error) }
  }
  const data = fileBytes(write)
  const mode = stats.mode & 0o7777
  const tmp = join(dirname(real), `.${basename(real)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    await fs.writeFile(tmp, data, { mode, flag: 'wx' })
    // The umask may have taken bits off the mode `writeFile` asked for.
    await fs.chmod(tmp, mode)
    await fs.rename(tmp, real)
  } catch (error) {
    await fs.unlink(tmp).catch(() => {})
    return { ok: false, reason: 'failed', message: writeFailureReason(error) }
  }
  try {
    const written = await fs.stat(real)
    return { ok: true, base: baseOf(data, written.mtimeMs) }
  } catch (error) {
    return { ok: false, reason: 'failed', message: writeFailureReason(error) }
  }
}
