import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { resolve } from 'node:path'
import {
  parseEditorFileRef,
  readEditorFile,
  ServedListedPaths,
  statEditorFile,
  writeEditorFile
} from '../core/editor-files'
import type {
  EditorReadResult,
  EditorStatResult,
  EditorWriteResult
} from '../core/editor-files-types'
import { IPC } from '../shared/api'
import { listed, loadListing } from './agent-setup'
import { appWindow } from './card-windows'

/**
 * Only the main window's main frame may use the editor (#83 D2, D6): a card window (#53) has no
 * editor view, and a subframe is never trusted.
 */
const fromMainWindow = (event: IpcMainInvokeEvent, channel: string): void => {
  const main = appWindow()
  if (
    event.senderFrame === null ||
    event.senderFrame !== event.sender.mainFrame ||
    main === undefined ||
    event.sender !== main.webContents
  ) {
    throw new Error(`${channel} rejected: untrusted sender`)
  }
}

/**
 * The listed files the editor served this run, and those main's own drafts name at launch (#83
 * D11): still the editor's once Agent setup's next read drops them, so a deleted one shows.
 */
export const served = new ServedListedPaths()

/** Each file's running save, the next one queued behind it, so two never check one base at once. */
const writing = new Map<string, Promise<unknown>>()

/**
 * The file editor's reads, stats and saves (#83 D6, D7, D12, D13): `editor:read`, `editor:stat`
 * and `editor:write`, each naming its file by a reference `src/core/editor-files.ts` checks before
 * anything is read: a path inside a shown folder by real path, or a file Agent setup's last read
 * of a folder listed (`listed`). One save at a time per named file.
 */
export function registerEditorFiles(): void {
  ipcMain.handle(IPC.editorRead, (event, ref: unknown): Promise<EditorReadResult> => {
    fromMainWindow(event, IPC.editorRead)
    return readEditorFile(ref, { listed, loadListing, served })
  })

  ipcMain.handle(IPC.editorStat, (event, ref: unknown): Promise<EditorStatResult> => {
    fromMainWindow(event, IPC.editorStat)
    return statEditorFile(ref, { listed, loadListing, served })
  })

  ipcMain.handle(
    IPC.editorWrite,
    (event, ref: unknown, write: unknown): Promise<EditorWriteResult> => {
      fromMainWindow(event, IPC.editorWrite)
      const parsed = parseEditorFileRef(ref)
      if (!parsed) return Promise.resolve({ ok: false, reason: 'refused' })
      // One queue per named file however it is spelled (`a/../b.txt` and `b.txt`).
      const key = parsed.kind === 'folder' ? resolve(parsed.folder, parsed.path) : parsed.path
      const before = writing.get(key) ?? Promise.resolve()
      const next = before
        .catch(() => undefined)
        .then(() => writeEditorFile(ref, write, { listed, loadListing, served }))
      writing.set(key, next)
      next
        .finally(() => {
          if (writing.get(key) === next) writing.delete(key)
        })
        .catch(() => {})
      return next
    }
  )
}
