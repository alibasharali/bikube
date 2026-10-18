/**
 * The Files tab's rows (#55 D7, D8, D10, D11): the shown folder's root row and, under each
 * expanded folder, its listing with git's changes marked, as one flat list in screen order; the
 * Changed only rows; and what the `tree`'s keys do. No Node imports: the renderer runs it.
 */

import type { FolderListing, TreeEntry } from './file-tree'
import { changedFolders, type ChangeLetter, type FileChange } from './git-status'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Entry names in the tree's order (D7): case-insensitive, natural (`file2` before `file10`). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** Folders first, then files, each by `compareNames` (D7). */
const entryOrder = (a: TreeEntry, b: TreeEntry): number =>
  a.folder === b.folder ? compareNames(a.name, b.name) : a.folder ? -1 : 1

export interface TreeRow {
  /** Relative to the shown folder, `/`-separated; `''` is the root row. A `more` or `error` row has its folder's path with a suffix. */
  path: string
  name: string
  /** 0 for the root row. */
  depth: number
  /** `more`: the `… <n> more` last row of a capped folder; `error`: `Can't read this folder`. */
  kind: 'root' | 'folder' | 'file' | 'more' | 'error'
  /** The folder's path the row is listed in; null for the root row. */
  parent: string | null
  /** Dimmed (D8): git ignores it, or it is inside a folder git ignores. */
  ignored: boolean
  /** For a root or folder row: whether its contents show. */
  expanded?: boolean
  /** The listed entry, for a folder or file row; none for a row only git knows of (deleted, Changed only). */
  entry?: TreeEntry
  /** git's letter for a changed path (D10). */
  change?: ChangeLetter
  /** A rename's old path, relative to the repository (D10's tooltip). */
  from?: string
  /** A folder (or the root) with a changed path inside (D10). */
  dot?: true
}

/**
 * The entries each folder has from `changes`, by folder path: with `only`, the changed paths and
 * the folders leading to them; else the deleted ones (D10: gone from disk, still shown).
 */
function changedEntries(
  changes: readonly FileChange[],
  only: (change: FileChange) => boolean
): Map<string, Map<string, TreeEntry>> {
  const byFolder = new Map<string, Map<string, TreeEntry>>()
  for (const change of changes) {
    if (!only(change)) continue
    const parts = change.path.split('/')
    parts.forEach((name, i) => {
      const parent = parts.slice(0, i).join('/')
      let entries = byFolder.get(parent)
      if (!entries) byFolder.set(parent, (entries = new Map()))
      const folder = i < parts.length - 1
      if (!entries.get(name)?.folder) entries.set(name, { name, folder })
    })
  }
  return byFolder
}

/** A row's marks from git (D10). */
function marks(
  path: string,
  folder: boolean,
  byPath: ReadonlyMap<string, FileChange>,
  dotted: ReadonlySet<string>
): Pick<TreeRow, 'change' | 'from' | 'dot'> {
  const change = byPath.get(path)
  return {
    ...(change && { change: change.letter }),
    ...(change?.from !== undefined && { from: change.from }),
    ...(folder && dotted.has(path) && { dot: true as const })
  }
}

const childPath = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name)

/**
 * The rows that show: the root row named `rootName`, then the contents of each folder in
 * `expanded` whose parents are all expanded, as far as `listings` has them, with `changes`
 * marked (D10): a letter on each changed path, a dot on each folder leading to one, and the
 * deleted files (and their folders, when gone too) merged into their folders' listings.
 */
export function visibleRows(
  rootName: string,
  listings: ReadonlyMap<string, FolderListing>,
  expanded: ReadonlySet<string>,
  changes: readonly FileChange[] = []
): TreeRow[] {
  const byPath = new Map(changes.map((c) => [c.path, c]))
  const dotted = changedFolders(changes)
  const deleted = changedEntries(changes, (c) => c.letter === 'D')
  const rows: TreeRow[] = []
  /** `gone`: a folder only git knows of, its deleted files its only contents. */
  const add = (folder: string, depth: number, ignored: boolean, gone: boolean): void => {
    const listing = gone ? ({ ok: true, entries: [], more: 0 } as const) : listings.get(folder)
    if (!listing) return
    if (!listing.ok) {
      rows.push({
        path: `${folder}\0error`,
        name: "Can't read this folder",
        depth,
        kind: 'error',
        parent: folder,
        ignored
      })
      return
    }
    const listed = new Set(listing.entries.map((e) => e.name))
    const extra = [...(deleted.get(folder)?.values() ?? [])].filter((e) => !listed.has(e.name))
    const entries =
      extra.length > 0 ? [...listing.entries, ...extra].sort(entryOrder) : listing.entries
    for (const entry of entries) {
      const fromGit = !listed.has(entry.name)
      const path = childPath(folder, entry.name)
      const dimmed = ignored || entry.ignored === true
      const open = entry.folder && expanded.has(path)
      rows.push({
        path,
        name: entry.name,
        depth,
        kind: entry.folder ? 'folder' : 'file',
        parent: folder,
        ignored: dimmed,
        ...(entry.folder && { expanded: open }),
        ...(!fromGit && { entry }),
        ...marks(path, entry.folder, byPath, dotted)
      })
      if (open) add(path, depth + 1, dimmed, gone || fromGit)
    }
    if (listing.more > 0) {
      rows.push({
        path: `${folder}\0more`,
        name: `… ${listing.more} more`,
        depth,
        kind: 'more',
        parent: folder,
        ignored
      })
    }
  }
  const rootOpen = expanded.has('')
  rows.push({
    path: '',
    name: rootName,
    depth: 0,
    kind: 'root',
    parent: null,
    ignored: false,
    expanded: rootOpen,
    ...marks('', true, byPath, dotted)
  })
  if (rootOpen) add('', 1, false, false)
  return rows
}

/**
 * The Changed only rows (D11): the root row named `rootName`, then just the changed paths and the
 * folders leading to them, every folder expanded; none when nothing changed.
 */
export function changedRows(rootName: string, changes: readonly FileChange[]): TreeRow[] {
  if (changes.length === 0) return []
  const byPath = new Map(changes.map((c) => [c.path, c]))
  const dotted = changedFolders(changes)
  const children = changedEntries(changes, () => true)
  const rows: TreeRow[] = [
    {
      path: '',
      name: rootName,
      depth: 0,
      kind: 'root',
      parent: null,
      ignored: false,
      expanded: true,
      ...marks('', true, byPath, dotted)
    }
  ]
  const add = (folder: string, depth: number): void => {
    for (const entry of [...(children.get(folder)?.values() ?? [])].sort(entryOrder)) {
      const path = childPath(folder, entry.name)
      rows.push({
        path,
        name: entry.name,
        depth,
        kind: entry.folder ? 'folder' : 'file',
        parent: folder,
        ignored: false,
        ...(entry.folder && { expanded: true }),
        ...marks(path, entry.folder, byPath, dotted)
      })
      if (entry.folder) add(path, depth + 1)
    }
  }
  add('', 1)
  return rows
}

/** What a key on the tree does: select another row, expand or collapse a folder, or open a file. */
export type TreeAction = { select?: string; toggle?: string; open?: string }

const selectable = (row: TreeRow): boolean =>
  row.kind === 'root' || row.kind === 'folder' || row.kind === 'file'

/**
 * The action of `key` with `selected` the selected row's path (D7): Up/Down move, Right expands
 * a collapsed folder (else goes to its first child), Left collapses an expanded one (else goes to
 * the parent), Enter toggles a folder or opens a file. `{}` when it does nothing.
 */
export function treeKey(rows: TreeRow[], selected: string | null, key: string): TreeAction {
  const items = rows.filter(selectable)
  const at = items.findIndex((r) => r.path === selected)
  if (at < 0)
    return items[0] && (key === 'ArrowDown' || key === 'ArrowUp') ? { select: items[0].path } : {}
  const row = items[at]!
  const folder = row.kind !== 'file'
  switch (key) {
    case 'ArrowDown':
      return items[at + 1] ? { select: items[at + 1]!.path } : {}
    case 'ArrowUp':
      return items[at - 1] ? { select: items[at - 1]!.path } : {}
    case 'ArrowRight':
      if (!folder) return {}
      if (!row.expanded) return { toggle: row.path }
      return items[at + 1]?.parent === row.path ? { select: items[at + 1]!.path } : {}
    case 'ArrowLeft':
      if (folder && row.expanded) return { toggle: row.path }
      return row.parent !== null ? { select: row.parent } : {}
    case 'Enter':
      return folder ? { toggle: row.path } : { open: row.path }
    default:
      return {}
  }
}
