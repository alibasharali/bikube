import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { isDirectory } from '../core/directories'
import { listFolder, type FolderListing } from '../core/file-tree'
import { readOnlyGit, spawnRunner } from '../core/git'
import { IPC } from '../shared/api'

/**
 * The side panel's Files tab (#55 D7, D8, D16): lists one folder inside the shown folder, its
 * ignored entries marked by read-only git. Requests come from the main frame only; the shown
 * folder must be an absolute existing folder, and a path that resolves outside it (`..`, a
 * symlink escaping it) is refused before anything is read.
 */
export function registerFiles(): void {
  const git = readOnlyGit(spawnRunner(spawn, process.platform), process.env)
  ipcMain.handle(
    IPC.filesList,
    async (event, folder: unknown, path: unknown): Promise<FolderListing> => {
      if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
        throw new Error(`${IPC.filesList} rejected: untrusted sender`)
      }
      if (typeof folder !== 'string' || !(await isDirectory(folder))) {
        return { ok: false, reason: 'outside' }
      }
      return listFolder(folder, path, { git })
    }
  )
}
