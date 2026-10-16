import { contextBridge, ipcRenderer } from 'electron'
import type { BoardCommand } from '../core/board-args'
import { NO_ANSWER, type BoardReply } from '../core/board-protocol'
import type { SyncStatus } from '../core/sync-status'
import type { Workspace } from '../core/workspace-store'
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
  settings: {
    load: () => ipcRenderer.invoke(IPC.settingsLoad),
    save: (settings) => ipcRenderer.send(IPC.settingsSave, settings),
    shells: () => ipcRenderer.invoke(IPC.settingsShells),
    ghosttyTheme: () => ipcRenderer.invoke(IPC.settingsGhosttyTheme)
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.syncStatus),
    onStatus: (listener) => {
      const handler = (_: unknown, status: SyncStatus): void => listener(status)
      ipcRenderer.on(IPC.syncStatusChanged, handler)
      return () => ipcRenderer.removeListener(IPC.syncStatusChanged, handler)
    },
    setFolder: (path) => ipcRenderer.invoke(IPC.syncSetFolder, path),
    pickFolder: () => ipcRenderer.invoke(IPC.syncPickFolder),
    onBoard: (listener) => {
      const handler = (_: unknown, workspaces: Workspace[]): void => listener(workspaces)
      ipcRenderer.on(IPC.syncBoard, handler)
      return () => ipcRenderer.removeListener(IPC.syncBoard, handler)
    }
  },
  worktree: {
    info: (dir) => ipcRenderer.invoke(IPC.worktreeInfo, dir),
    create: (dir, branch) => ipcRenderer.invoke(IPC.worktreeCreate, dir, branch),
    dirty: (path) => ipcRenderer.invoke(IPC.worktreeDirty, path),
    remove: (repo, path, force) => ipcRenderer.invoke(IPC.worktreeRemove, repo, path, force)
  },
  app: {
    setBadge: (count) => ipcRenderer.send(IPC.appSetBadge, count),
    focus: () => ipcRenderer.send(IPC.appFocus),
    requestAttention: () => ipcRenderer.send(IPC.appRequestAttention),
    home: () => ipcRenderer.invoke(IPC.appHome),
    reveal: (path) => ipcRenderer.send(IPC.appReveal, path)
  },
  terminal: {
    spawn: (cols, rows, cwd, cardId, host = null) =>
      ipcRenderer.invoke(IPC.spawn, cols, rows, cwd, cardId, host),
    write: (id, data) => ipcRenderer.send(IPC.write, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.resize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.kill, id),
    ack: (id, chars) => ipcRenderer.send(IPC.ack, id, chars),
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
          .then(answer, () => answer({ ok: false, error: NO_ANSWER }))
      }
      ipcRenderer.on(IPC.boardRequest, handler)
      return () => ipcRenderer.removeListener(IPC.boardRequest, handler)
    }
  }
}

contextBridge.exposeInMainWorld('drovr', api)

/** The part of the Navigation API used below; TypeScript's DOM lib doesn't have it yet. */
declare const navigation: {
  addEventListener(
    type: 'navigate',
    listener: (event: Event & { readonly destination: { readonly url: string } }) => void
  ): void
}

// The navigation lock in main never sees a page going to `about:blank`: no `will-navigate` fires
// for it (#20). Cancelled here, in the isolated world the page's own scripts can't reach.
navigation.addEventListener('navigate', (event) => {
  if (event.cancelable && new URL(event.destination.url).protocol === 'about:')
    event.preventDefault()
})
