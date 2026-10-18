import { useCallback, useSyncExternalStore } from 'react'
import type { FolderListing } from '../../core/file-tree'
import type { FolderStatus } from '../../core/git-status'

/**
 * The Files tab's tree data (#55 D7, D10, D11, D12), kept per folder shown for the run of the app
 * (never saved): which folders are expanded, the last listing of each folder read, the last git
 * status read and whether Changed only is on. Leaving and reopening a card shows its tree as it
 * was, then reads it again.
 */

interface FolderTree {
  /** Expanded folders' paths; `''` is the root, expanded when the tab first shows (D7). */
  expanded: Set<string>
  listings: Map<string, FolderListing>
  /** The last git status read; null until the first read. */
  status: FolderStatus | null
  /** Changed only (D11). */
  changedOnly: boolean
  /** Changes on every change, for `useSyncExternalStore`. */
  version: number
}

const trees = new Map<string, FolderTree>()
/** Folders with a refresh running: a refresh never starts while the one before it runs (D12). */
const refreshing = new Set<string>()
const listeners = new Set<() => void>()

function treeOf(folder: string): FolderTree {
  let tree = trees.get(folder)
  if (!tree) {
    tree = {
      expanded: new Set(['']),
      listings: new Map(),
      status: null,
      changedOnly: false,
      version: 0
    }
    trees.set(folder, tree)
  }
  return tree
}

const changed = (tree: FolderTree): void => {
  tree.version++
  for (const listener of [...listeners]) listener()
}

/** Keeps `listing` for `path`; nothing changes (no re-render) when it reads as before. */
function store(folder: string, path: string, listing: FolderListing): boolean {
  const tree = treeOf(folder)
  const before = tree.listings.get(path)
  if (before && JSON.stringify(before) === JSON.stringify(listing)) return false
  tree.listings.set(path, listing)
  return true
}

/**
 * Keeps `status`; nothing changes when it reads as before, and a failed read (a timeout) keeps
 * the status read before it.
 */
function storeStatus(folder: string, status: FolderStatus): boolean {
  const tree = treeOf(folder)
  const before = tree.status
  if (before && !status.ok && status.reason === 'failed') return false
  if (before && JSON.stringify(before) === JSON.stringify(status)) return false
  tree.status = status
  return true
}

async function readStatus(folder: string): Promise<FolderStatus> {
  try {
    return await window.drovr.files.status(folder)
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

async function read(folder: string, path: string): Promise<FolderListing> {
  try {
    return await window.drovr.files.list(folder, path)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** The expanded folders that show: each one's parents are all expanded too. */
function shownFolders(expanded: ReadonlySet<string>): string[] {
  return [...expanded].filter((path) => {
    if (path === '') return true
    if (!expanded.has('')) return false
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      if (!expanded.has(parts.slice(0, i).join('/'))) return false
    }
    return true
  })
}

/**
 * Reads every expanded folder that shows in `folder`'s tree and its git status again (D12),
 * replacing only what changed, so expansion, selection and scroll stay. Skipped while one runs.
 */
export async function refreshTree(folder: string): Promise<void> {
  if (refreshing.has(folder)) return
  refreshing.add(folder)
  try {
    const tree = treeOf(folder)
    const paths = shownFolders(tree.expanded)
    const [status, ...listings] = await Promise.all([
      readStatus(folder),
      ...paths.map((path) => read(folder, path))
    ])
    let any = storeStatus(folder, status)
    paths.forEach((path, i) => {
      if (store(folder, path, listings[i] as FolderListing)) any = true
    })
    if (any) changed(tree)
  } finally {
    refreshing.delete(folder)
  }
}

/** Expands or collapses `path` in `folder`'s tree; an expanded folder is read at once. */
export function toggleFolder(folder: string, path: string): void {
  const tree = treeOf(folder)
  if (tree.expanded.delete(path)) {
    changed(tree)
    return
  }
  tree.expanded.add(path)
  changed(tree)
  void read(folder, path).then((listing) => {
    if (store(folder, path, listing)) changed(tree)
  })
}

/** Turns Changed only on or off for `folder` (D11). */
export function setChangedOnly(folder: string, on: boolean): void {
  const tree = treeOf(folder)
  if (tree.changedOnly === on) return
  tree.changedOnly = on
  changed(tree)
}

/** `folder`'s tree, re-rendered on every change. */
export function useFolderTree(folder: string): {
  expanded: ReadonlySet<string>
  listings: ReadonlyMap<string, FolderListing>
  status: FolderStatus | null
  changedOnly: boolean
} {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  useSyncExternalStore(subscribe, () => treeOf(folder).version)
  const tree = treeOf(folder)
  return {
    expanded: tree.expanded,
    listings: tree.listings,
    status: tree.status,
    changedOnly: tree.changedOnly
  }
}
