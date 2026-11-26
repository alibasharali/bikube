/**
 * The file editor's references and results (#83 D6, D7, D12, D13), shared by main, the preload
 * and the renderer. Node-free: the renderer imports it.
 */

/**
 * What a tab names its file by (D6), checked by main on every request: a path relative to a shown
 * folder (`/`-separated, inside it by real path, as the Files tab lists it), or an absolute path
 * Agent setup's last read of `folder` listed.
 */
export type EditorFileRef =
  | { kind: 'folder'; folder: string; path: string }
  | { kind: 'listed'; folder: string; path: string }

/** The file as a tab last read or wrote it (D12, D13): a save writes only while it still matches. */
export interface EditorFileBase {
  size: number
  mtimeMs: number
  /** SHA-256 of the file's bytes, lowercase hex. */
  sha256: string
}

/** Line endings a text file is written back with (D7): CRLF when its first line break is CRLF. */
export type EditorEol = 'lf' | 'crlf'

/**
 * A read (D7). `realPath` is the file's absolute real path (D3: a tab's identity). `text` has its
 * line endings as `\n` and no BOM; a write puts both back. `image` is a `data:` URL (mime by
 * extension), also for a Markdown preview's relative image (D10).
 */
export type EditorReadResult =
  | {
      kind: 'text'
      text: string
      eol: EditorEol
      bom: boolean
      base: EditorFileBase
      realPath: string
    }
  | { kind: 'image'; dataUrl: string; base: EditorFileBase; realPath: string }
  | { kind: 'binary'; realPath: string }
  | { kind: 'too-large'; size: number; realPath: string }
  | { kind: 'missing' }
  | { kind: 'refused' }

/** A cheap check (D13): a changed size or mtime asks for a read, which compares the hash. */
export type EditorStatResult =
  { kind: 'file'; size: number; mtimeMs: number } | { kind: 'missing' } | { kind: 'refused' }

/** A save (D12): the tab's text with its line endings and BOM, and the base it was edited from. */
export interface EditorWrite {
  text: string
  eol: EditorEol
  bom: boolean
  base: EditorFileBase
}

/**
 * A save's outcome (D12): the new base when written; `conflict` when the file no longer matches
 * the base and nothing was written; `missing` when it is gone; `failed` with a reason for
 * `Couldn't save <name>: <reason>`; `refused` when the request named no file main allows.
 */
export type EditorWriteResult =
  | { ok: true; base: EditorFileBase }
  | { ok: false; reason: 'conflict' | 'missing' | 'refused' }
  | { ok: false; reason: 'failed'; message: string }

/** The largest file opened as text (D7): 5 MB. */
export const EDITOR_TEXT_LIMIT = 5 * 1024 * 1024

/** The largest picture shown (D7): 20 MB. */
export const EDITOR_IMAGE_LIMIT = 20 * 1024 * 1024

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

/** The picture type of a file shown as one (D7), by its extension in any case; null for others. */
export function imageMimeType(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return IMAGE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}

/** A size for `Too large to open here (<size>)` (D7): `512 B`, `1.5 KB`, `6.0 MB`, `1.2 GB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}
