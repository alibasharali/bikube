/**
 * The Files tab's rows (#55 D7, D8): the shown folder's root row and, under each expanded
 * folder, its listing, as one flat list in screen order; and what the `tree`'s keys do.
 */

import type { FolderListing, TreeEntry } from './file-tree'

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
  /** The listed entry, for a folder or file row. */
  entry?: TreeEntry
}

const childPath = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name)

/**
 * The rows that show: the root row named `rootName`, then the contents of each folder in
 * `expanded` whose parents are all expanded, as far as `listings` has them.
 */
export function visibleRows(
  rootName: string,
  listings: ReadonlyMap<string, FolderListing>,
  expanded: ReadonlySet<string>
): TreeRow[] {
  const rows: TreeRow[] = []
  const add = (folder: string, depth: number, ignored: boolean): void => {
    const listing = listings.get(folder)
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
    for (const entry of listing.entries) {
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
        entry
      })
      if (open) add(path, depth + 1, dimmed)
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
    expanded: rootOpen
  })
  if (rootOpen) add('', 1, false)
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
