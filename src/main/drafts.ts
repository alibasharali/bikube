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
import { DraftsStore } from '../core/drafts-store'
import type { EditorDraft } from '../core/editor-files-types'
import type { WorkspaceState } from '../core/workspace-store'
import { IPC } from '../shared/api'
import { appWindow } from './card-windows'

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

  let dirty = 0
  ipcMain.on(IPC.draftsSave, (event, draft: unknown) => {
    if (fromMainWindow(event)) store.save(draft)
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
