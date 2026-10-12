import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DrovrApi, type TerminalExit } from '../shared/api'

const api: DrovrApi = {
  platform: process.platform,
  clipboard: {
    read: () => ipcRenderer.invoke(IPC.clipboardRead),
    write: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text)
  },
  terminal: {
    spawn: (cols, rows) => ipcRenderer.invoke(IPC.spawn, cols, rows),
    write: (id, data) => ipcRenderer.send(IPC.write, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.resize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.kill, id),
    onData: (listener) => {
      const handler = (_: unknown, id: string, data: string): void => listener(id, data)
      ipcRenderer.on(IPC.data, handler)
      return () => ipcRenderer.removeListener(IPC.data, handler)
    },
    onExit: (listener) => {
      const handler = (_: unknown, exit: TerminalExit): void => listener(exit)
      ipcRenderer.on(IPC.exit, handler)
      return () => ipcRenderer.removeListener(IPC.exit, handler)
    }
  }
}

contextBridge.exposeInMainWorld('drovr', api)
