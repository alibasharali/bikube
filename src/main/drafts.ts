import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { DraftsStore, parseEditorDraft } from '../core/drafts-store'
import type { EditorDraft } from '../core/editor-files-types'
import type { WorkspaceState } from '../core/workspace-store'
import { IPC } from '../shared/api'
import { appWindow } from './card-windows'
import { served } from './editor-files'

export interface MainDrafts {
  store: DraftsStore
  /** Whether the window last said an editor tab is dirty: a quit then waits for its drafts. */
  unsaved(): boolean
}

/** The largest dirty-tab count taken from the window. */
const MAX_DIRTY_COUNT = 100_000

/**
 * Dirty editor tabs' drafts (#83 D11) in `<userData>/drafts`: only the main window's main frame
 * may save, delete or list them (the editor is the main window's, D2). Saves and deletes are
 * written synchronously as they arrive, so the drafts the window sends at `app:quitting` are on
 * disk before its `scrollback:quitSaved`, which main waits for within `QUIT_SAVE_WAIT_MS`.
 */
export function registerDrafts(): MainDrafts {
  const store = new DraftsStore({
    dir: join(app.getPath('userData'), 'drafts'),
    fs: {
      mkdirSync,
      chmodSync,
      openSync,
      writeFileSync,
      fsyncSync,
      closeSync,
      renameSync,
      readFileSync,
      rmSync,
      readdirSync
    }
  })

  const fromMainWindow = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    const main = appWindow()
    return (
      event.senderFrame !== null &&
      event.senderFrame === event.sender.mainFrame &&
      main !== undefined &&
      event.sender === main.webContents
    )
  }

  // A draft naming a listed file was saved while the editor served it: after a restart that file
  // stays the editor's though no listing names it yet or any more (D11). Read from main's own
  // folder before the window loads, so the window can't add a path this way.
  for (const draft of store.list()) {
    if (draft.ref.kind === 'listed') served.add(draft.ref.folder, draft.ref.path)
  }

  let dirty = 0
  ipcMain.on(IPC.draftsSave, (event, value: unknown) => {
    if (!fromMainWindow(event)) return
    const draft = parseEditorDraft(value)
    // Only a listed file the editor served is drafted, so the next launch accepts no other.
    if (!draft || (draft.ref.kind === 'listed' && !served.has(draft.ref.folder, draft.ref.path)))
      return
    store.save(draft)
  })
  ipcMain.on(IPC.draftsDelete, (event, workspaceId: unknown, realPath: unknown) => {
    if (fromMainWindow(event)) store.delete(workspaceId, realPath)
  })
  ipcMain.on(IPC.draftsDirty, (event, count: unknown) => {
    if (!fromMainWindow(event)) return
    if (
      Number.isSafeInteger(count) &&
      (count as number) >= 0 &&
      (count as number) <= MAX_DIRTY_COUNT
    ) {
      dirty = count as number
    }
  })
  // The development build's dirty count for the e2e sender check (#83 AC13).
  if (!app.isPackaged) Object.assign(globalThis, { __bikubeDraftsDirty: () => dirty })
  ipcMain.handle(IPC.draftsList, (event): EditorDraft[] => {
    if (!fromMainWindow(event)) throw new Error(`${IPC.draftsList} rejected: untrusted sender`)
    return store.list()
  })
  return { store, unsaved: () => dirty > 0 }
}

/** The ids of every workspace on the given boards, whose drafts the launch prune keeps (D11). */
export function workspaceIds(...boards: WorkspaceState[]): string[] {
  return boards.flatMap((board) => board.workspaces.map((w) => w.id))
}
