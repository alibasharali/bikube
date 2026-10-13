import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { StateFile } from '../core/state-file'
import { IPC } from '../shared/api'

/**
 * The saved-state file in `userData` (#8 D2, D5, D6, D7). Only a window's own top-level page may
 * load or save; call `flush` before quitting.
 */
export function registerState(): { flush(): void } {
  const dir = app.getPath('userData')
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error(`state directory not created: ${String(err)}`)
  }
  const file = new StateFile({ dir, fs: { readFileSync, writeFileSync, renameSync } })

  const fromMainFrame = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

  ipcMain.handle(IPC.stateLoad, async (event) => {
    if (!fromMainFrame(event)) throw new Error('state:load rejected: untrusted sender')
    return file.load()
  })
  ipcMain.on(IPC.stateSave, (event, state: unknown) => {
    if (fromMainFrame(event)) file.save(state)
  })
  return { flush: () => file.flush() }
}
