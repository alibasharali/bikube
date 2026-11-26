/**
 * What the file editor does with a tab's file over time (#83 D12, D13): whether a tab is dirty,
 * what a check of its file on disk means for it (nothing, a new base, a silent reload, the
 * `changed on disk` bar or `Deleted on disk`), the smallest change that reloads its text, Mod+S,
 * and the workspace delete's line. Node-free: the renderer runs it.
 */
import type { EditorFileBase, EditorReadResult, EditorStatResult } from './editor-files-types'

/** What a tab shows about its file on disk (D13): the bar for a dirty tab, or the file gone. */
export type EditorNotice = 'changed' | 'deleted'

/** A text tab as a check sees it. */
export interface CheckedTab {
  /** Its text differs from its base's. */
  dirty: boolean
  /** The file as the tab last read or saved it. */
  base: EditorFileBase
  notice: EditorNotice | null
}

/** A tab is dirty while its text differs from the text it last read or saved (undo can clean it). */
export function isDirty(text: string, baseText: string): boolean {
  return text !== baseText
}

/** After the cheap stat (D13): nothing changed, a read to compare the hash, or the file gone. */
export function statStep(tab: CheckedTab, stat: EditorStatResult): 'none' | 'read' | 'missing' {
  if (stat.kind === 'refused') return 'none'
  if (stat.kind === 'missing') return 'missing'
  if (tab.notice === 'deleted') return 'read'
  return stat.size === tab.base.size && stat.mtimeMs === tab.base.mtimeMs ? 'none' : 'read'
}

/**
 * What a check's read means for the tab (D13): the same bytes take the new mtime (`rebase`, which
 * also clears a notice); other contents reload a clean tab silently and show a dirty tab's bar,
 * once per change: a bar already up stays; a file gone marks the tab `Deleted on disk`, once.
 */
export type CheckOutcome =
  | { kind: 'none' }
  | { kind: 'rebase'; base: EditorFileBase }
  | { kind: 'reload'; read: Exclude<EditorReadResult, { kind: 'missing' | 'refused' }> }
  | { kind: 'bar' }
  | { kind: 'deleted' }

export function checkOutcome(tab: CheckedTab, read: EditorReadResult): CheckOutcome {
  if (read.kind === 'refused') return { kind: 'none' }
  if (read.kind === 'missing')
    return tab.notice === 'deleted' ? { kind: 'none' } : { kind: 'deleted' }
  if (read.kind === 'text' && read.base.sha256 === tab.base.sha256) {
    return { kind: 'rebase', base: read.base }
  }
  if (!tab.dirty) return { kind: 'reload', read }
  return tab.notice === 'changed' ? { kind: 'none' } : { kind: 'bar' }
}

/**
 * The one change turning `from` into `to` (D13's silent reload): only the differing middle is
 * replaced, so the cursor line and scroll stay where the text around them is unchanged. Null when
 * they are equal.
 */
export function replacement(
  from: string,
  to: string
): { from: number; to: number; insert: string } | null {
  if (from === to) return null
  const max = Math.min(from.length, to.length)
  let start = 0
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++
  let end = 0
  while (
    end < max - start &&
    from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
  ) {
    end++
  }
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
}

/** Key facts of a keydown, as the DOM's `KeyboardEvent` has them. */
export interface KeyPress {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Mod+S (D12): Cmd+S on macOS, Ctrl+S elsewhere, with no other modifier. Fixed, not in Settings. */
export function isSaveKey(event: KeyPress, platform: string): boolean {
  const mac = platform === 'darwin'
  if (event.altKey || event.shiftKey) return false
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false
  return event.key.toLowerCase() === 's' || event.code === 'KeyS'
}

/** The workspace delete confirmation's line for its dirty tabs (D12); null with none. */
export function unsavedFilesLine(count: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? '1 unsaved file will be discarded'
    : `${count} unsaved files will be discarded`
}

/** The question before closing a dirty tab (D12). */
export function saveChangesQuestion(name: string): string {
  return `Save changes to ${name}?`
}

/** The line under the header when a save failed (D12). */
export function saveFailedLine(name: string, reason: string): string {
  return `Couldn't save ${name}: ${reason}`
}
