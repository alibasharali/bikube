import { contextBridge, ipcRenderer } from 'electron'
import type { BoardCommand } from '../core/board-args'
import type { BoardReply } from '../core/board-protocol'
import { IPC, type DrovrApi, type TerminalExit } from '../shared/api'

const api: DrovrApi = {
  platform: process.platform,
  clipboard: {
    read: () => ipcRenderer.invoke(IPC.clipboardRead),
    write: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text)
  },
  fs: {
    isDirectory: (path) => ipcRenderer.invoke(IPC.fsIsDirectory, path)
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke(IPC.dialogPickDirectory)
  },
  state: {
    load: () => ipcRenderer.invoke(IPC.stateLoad),
    save: (state) => ipcRenderer.send(IPC.stateSave, state)
  },
  terminal: {
    spawn: (cols, rows, cwd, cardId) => ipcRenderer.invoke(IPC.spawn, cols, rows, cwd, cardId),
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
  },
  board: {
    onRequest: (listener) => {
      const handler = (
        _: unknown,
        requestId: string,
        cardId: string,
        command: BoardCommand
      ): void => {
        const answer = (reply: BoardReply): void =>
          ipcRenderer.send(IPC.boardAnswer, requestId, reply)
        Promise.resolve()
          .then(() => listener(cardId, command))
          .then(answer, () => answer({ ok: false, error: 'board: the board could not answer' }))
      }
      ipcRenderer.on(IPC.boardRequest, handler)
      return () => ipcRenderer.removeListener(IPC.boardRequest, handler)
    }
  }
}

contextBridge.exposeInMainWorld('drovr', api)
