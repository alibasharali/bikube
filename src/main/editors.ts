import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { editorShell, type EditorLocation } from '../core/editor'
import type { NamedEditor } from '../core/editor-candidates'
import { readInstalledEditors } from '../core/installed-editors'
import { IPC } from '../shared/api'
import { userHome } from './home'

/** Where Settings > Editor's named editors are looked for (#70 D1): this OS, `~` as #68 reads it. */
export function editorLocation(): EditorLocation {
  return { platform: process.platform, home: userHome() }
}

/**
 * Which of VS Code, Cursor and Zed are installed (`editors:installed`, #70 D2), read through the
 * login shell the Shell setting `shellSetting()` names (else `$SHELL`), as the installed agents
 * are. Requests come from the main frame only; one check runs at a time, a request during it
 * sharing its answer.
 */
export function registerEditors(shellSetting: () => string): void {
  let running: Promise<NamedEditor[] | null> | null = null
  ipcMain.handle(IPC.editorsInstalled, (event): Promise<NamedEditor[] | null> => {
    if (event.senderFrame === null || event.senderFrame !== event.sender.mainFrame) {
      throw new Error(`${IPC.editorsInstalled} rejected: untrusted sender`)
    }
    running ??= readInstalledEditors({
      spawn,
      shell: editorShell(shellSetting(), process.env),
      env: process.env,
      ...editorLocation()
    }).finally(() => {
      running = null
    })
    return running
  })
}
