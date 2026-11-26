/**
 * The file editor's tabs (#83 D3, D4, D9): each workspace's ordered open files and its active
 * one. Runtime only, never saved or synced. Node-free: the renderer keeps them.
 */
import type { EditorFileRef } from './editor-files-types'

/** An open file: identified by its absolute real path (D3), read and written through `ref` (D6). */
export interface EditorTab {
  /** The file's absolute real path, as main's read gave it. */
  id: string
  ref: EditorFileRef
}

/** A workspace's open files in tab order, and the tab in front (null with none). */
export interface WorkspaceTabs {
  tabs: readonly EditorTab[]
  activeId: string | null
}

export type EditorTabsMemory = Readonly<Record<string, WorkspaceTabs>>

/** No workspace has a tab. */
export const NO_TABS: EditorTabsMemory = Object.freeze({})

const EMPTY: WorkspaceTabs = Object.freeze({ tabs: Object.freeze([]), activeId: null })

export function workspaceTabs(memory: EditorTabsMemory, workspaceId: string): WorkspaceTabs {
  return Object.hasOwn(memory, workspaceId) ? memory[workspaceId] : EMPTY
}

/** The workspace's tab in front, or null with none. */
export function activeTab(memory: EditorTabsMemory, workspaceId: string): EditorTab | null {
  const { tabs, activeId } = workspaceTabs(memory, workspaceId)
  return tabs.find((t) => t.id === activeId) ?? null
}

function withTabs(
  memory: EditorTabsMemory,
  workspaceId: string,
  next: WorkspaceTabs
): EditorTabsMemory {
  if (next.tabs.length > 0) return { ...memory, [workspaceId]: next }
  if (!Object.hasOwn(memory, workspaceId)) return memory
  const rest = { ...memory }
  delete rest[workspaceId]
  return rest
}

/**
 * Opens `tab` in front: a file already open (the same real path) focuses its one tab, keeping its
 * reference; a new one goes right of the active tab (D3).
 */
export function openTab(
  memory: EditorTabsMemory,
  workspaceId: string,
  tab: EditorTab
): EditorTabsMemory {
  const { tabs, activeId } = workspaceTabs(memory, workspaceId)
  if (tabs.some((t) => t.id === tab.id)) return selectTab(memory, workspaceId, tab.id)
  const at = tabs.findIndex((t) => t.id === activeId)
  const next = [...tabs]
  next.splice(at === -1 ? tabs.length : at + 1, 0, tab)
  return withTabs(memory, workspaceId, { tabs: next, activeId: tab.id })
}

/** Puts the open tab `id` in front; nothing for a tab not open. */
export function selectTab(
  memory: EditorTabsMemory,
  workspaceId: string,
  id: string
): EditorTabsMemory {
  const current = workspaceTabs(memory, workspaceId)
  if (current.activeId === id || !current.tabs.some((t) => t.id === id)) return memory
  return withTabs(memory, workspaceId, { tabs: current.tabs, activeId: id })
}

/** Closes tab `id`; when it was in front, its right neighbour comes forward, else its left. */
export function closeTab(
  memory: EditorTabsMemory,
  workspaceId: string,
  id: string
): EditorTabsMemory {
  const { tabs, activeId } = workspaceTabs(memory, workspaceId)
  const at = tabs.findIndex((t) => t.id === id)
  if (at === -1) return memory
  const next = tabs.filter((t) => t.id !== id)
  const front = activeId === id ? ((next[at] ?? next[at - 1] ?? null)?.id ?? null) : activeId
  return withTabs(memory, workspaceId, { tabs: next, activeId: front })
}

/** Every tab of the workspace closed: the view's close button (D9). */
export function closeWorkspaceTabs(
  memory: EditorTabsMemory,
  workspaceId: string
): EditorTabsMemory {
  return withTabs(memory, workspaceId, EMPTY)
}

/** Only the workspaces in `workspaceIds` keep their tabs: a deleted workspace's close (D3). */
export function keepWorkspaces(
  memory: EditorTabsMemory,
  workspaceIds: readonly string[]
): EditorTabsMemory {
  const gone = Object.keys(memory).filter((id) => !workspaceIds.includes(id))
  if (gone.length === 0) return memory
  const next = { ...memory }
  for (const id of gone) delete next[id]
  return next
}

/** A path's last segment. */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed
}

/** A path's parent folder's name, '' at the root. */
function parentName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const parent = trimmed.slice(0, trimmed.lastIndexOf('/'))
  return baseName(parent)
}

/** What a tab reads (D9): the file's name, and its parent folder's when another tab shares it. */
export interface TabLabel {
  name: string
  detail: string | null
}

/** The labels of `tabs`, in order (D9). */
export function tabLabels(tabs: readonly EditorTab[]): TabLabel[] {
  const names = tabs.map((t) => baseName(t.id))
  return tabs.map((t, i) => ({
    name: names[i],
    detail: names.filter((n) => n === names[i]).length > 1 ? parentName(t.id) : null
  }))
}

/** The absolute path a reference names, as given (not its real path). */
export function refPath(ref: EditorFileRef): string {
  if (ref.kind === 'listed') return ref.path
  return `${ref.folder.replace(/\/+$/, '')}/${ref.path}`
}

/**
 * A tab's path as its tooltip and header show it (D4): relative to the workspace folder, else
 * with `~` for the home folder, else absolute.
 */
export function tabPath(ref: EditorFileRef, workspaceFolder: string, home: string): string {
  const path = refPath(ref)
  const inside = (folder: string): string | null => {
    const prefix = `${folder.replace(/\/+$/, '')}/`
    return folder !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : null
  }
  const relative = inside(workspaceFolder)
  if (relative !== null) return relative
  const underHome = inside(home)
  return underHome !== null ? `~/${underHome}` : path
}
