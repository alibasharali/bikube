import { useSyncExternalStore } from 'react'
import type { EditorState } from '@codemirror/state'
import type { EditorFileRef, EditorReadResult } from '../../core/editor-files-types'
import {
  closeTab,
  closeWorkspaceTabs,
  keepWorkspaces,
  NO_TABS,
  openTab,
  refPath,
  selectTab,
  type EditorTabsMemory
} from '../../core/editor-tabs'

/**
 * What an open tab holds (#83 D3, D7): main's read, and once shown as text its CodeMirror state,
 * kept across tab and view switches so its edits and undo history stay.
 */
export interface EditorDoc {
  read: Exclude<EditorReadResult, { kind: 'refused' }>
  state: EditorState | null
}

type Reader = (ref: EditorFileRef) => Promise<EditorReadResult>

export interface EditorFiles {
  get(): EditorTabsMemory
  subscribe(listener: () => void): () => void
  /** App shows `workspaceId`'s editor view with its active tab (D2). */
  onShow(fn: (workspaceId: string) => void): () => void
  /**
   * Opens `ref` in a tab of `workspaceId` (D3) and shows the editor; a file already open is
   * focused, keeping what its tab holds. `refused`, nothing opened, when main refused it.
   */
  open(workspaceId: string, ref: EditorFileRef): Promise<'opened' | 'refused'>
  doc(workspaceId: string, id: string): EditorDoc | null
  /** Keeps a shown text tab's editor state for when it shows again. */
  keepState(workspaceId: string, id: string, state: EditorState): void
  select(workspaceId: string, id: string): void
  close(workspaceId: string, id: string): void
  closeAll(workspaceId: string): void
  /** Only these workspaces keep their tabs: deleted workspaces' tabs close (D3). */
  keep(workspaceIds: readonly string[]): void
}

/**
 * Every workspace's open files for this run of the app (#83 D3): the tab lists (`editor-tabs.ts`)
 * and each tab's document. Opening a file asks main to read it first, since a tab is its real
 * path, then shows the editor view through what App registered (`onShow`).
 */
export function createEditorFiles(read: Reader): EditorFiles {
  let memory: EditorTabsMemory = NO_TABS
  const docs = new Map<string, EditorDoc>()
  const listeners = new Set<() => void>()
  let show: ((workspaceId: string) => void) | null = null
  const key = (workspaceId: string, id: string): string => `${workspaceId}\n${id}`
  const set = (next: EditorTabsMemory): void => {
    if (next === memory) return
    memory = next
    // Documents of tabs no longer open go.
    for (const k of [...docs.keys()]) {
      const [workspaceId, id] = k.split('\n')
      if (!memory[workspaceId]?.tabs.some((t) => t.id === id)) docs.delete(k)
    }
    for (const listener of [...listeners]) listener()
  }
  return {
    get: (): EditorTabsMemory => memory,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** App shows `workspaceId`'s editor view with its active tab (D2). */
    onShow(fn: (workspaceId: string) => void): () => void {
      show = fn
      return () => {
        if (show === fn) show = null
      }
    },
    /**
     * Opens `ref` in a tab of `workspaceId` (D3) and shows the editor; a file already open is
     * focused, keeping what its tab holds. `refused`, nothing opened, when main refused it.
     */
    async open(workspaceId: string, ref: EditorFileRef): Promise<'opened' | 'refused'> {
      const result = await read(ref)
      if (result.kind === 'refused') return 'refused'
      const id = result.kind === 'missing' ? refPath(ref) : result.realPath
      const k = key(workspaceId, id)
      const held = docs.get(k)
      // An open text or picture keeps its tab's document; a tab that showed no file reads again.
      if (!held || (held.read.kind !== 'text' && held.read.kind !== 'image')) {
        docs.set(k, { read: result, state: null })
      }
      set(openTab(memory, workspaceId, { id, ref }))
      show?.(workspaceId)
      return 'opened'
    },
    doc: (workspaceId: string, id: string): EditorDoc | null =>
      docs.get(key(workspaceId, id)) ?? null,
    /** Keeps a shown text tab's editor state for when it shows again. */
    keepState(workspaceId: string, id: string, state: EditorState): void {
      const doc = docs.get(key(workspaceId, id))
      if (doc) doc.state = state
    },
    select: (workspaceId: string, id: string): void => set(selectTab(memory, workspaceId, id)),
    close: (workspaceId: string, id: string): void => set(closeTab(memory, workspaceId, id)),
    closeAll: (workspaceId: string): void => set(closeWorkspaceTabs(memory, workspaceId)),
    /** Deleted workspaces' tabs close (D3). */
    keep: (workspaceIds: readonly string[]): void => set(keepWorkspaces(memory, workspaceIds))
  }
}

/** The app's open files, read through main (D6). */
export const editorFiles: EditorFiles = createEditorFiles((ref) => window.bikube.editor.read(ref))

export function useEditorTabs(): EditorTabsMemory {
  return useSyncExternalStore(editorFiles.subscribe, editorFiles.get)
}
