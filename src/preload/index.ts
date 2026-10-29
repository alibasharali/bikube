import { contextBridge, ipcRenderer } from 'electron'
import {
  APP_THEME_ATTR,
  APP_THEME_MARK,
  appThemeStylesheet,
  parseAppThemeArg,
  type AppThemeId
} from '../core/app-themes'
import type { BoardCommand } from '../core/board-args'
import { LONG_COMMAND_MS, parseLongCommandMs } from '../core/long-commands'
import { NO_VIEW_PROMPT_ARG } from '../core/view-prompt'
import { parseHostName } from '../core/shell-marks'
import { NO_ANSWER, type BoardReply } from '../core/board-protocol'
import type { SyncStatus } from '../core/sync-status'
import type { UpdateState } from '../core/updates'
import type { Workspace } from '../core/workspace-store'
import { IPC, type BikubeApi, type TerminalExit } from '../shared/api'

const launchAppTheme = parseAppThemeArg(process.argv)

/**
 * Puts the launch App theme's `<style data-app-theme>` in the page's head as soon as the parser
 * creates it (#64 D7). The preload runs before any of the page's scripts, and a mutation
 * observer's callback runs at the end of the parser task that inserted the head, before anything
 * can paint; the page's module bundle may only run after a first paint. The renderer's
 * `app-theme.ts` then takes this element over.
 */
function insertLaunchAppTheme(id: AppThemeId): void {
  const insert = (): boolean => {
    const head = document.head
    if (!head) return false
    if (!head.querySelector(`style[${APP_THEME_ATTR}]`)) {
      const style = document.createElement('style')
      style.setAttribute(APP_THEME_ATTR, id)
      style.textContent = appThemeStylesheet(id)
      head.appendChild(style)
      performance.mark(APP_THEME_MARK)
    }
    return true
  }
  if (insert()) return
  const observer = new MutationObserver(() => {
    if (insert()) observer.disconnect()
  })
  observer.observe(document, { childList: true, subtree: true })
}

insertLaunchAppTheme(launchAppTheme)

const api: BikubeApi = {
  platform: process.platform,
  // Main passes a shortened threshold only in the development build (#45 D7).
  longCommandMs: parseLongCommandMs(process.argv) ?? LONG_COMMAND_MS,
  // Main passes it only in the development build, for the smoke tests.
  noViewPrompt: process.argv.includes(NO_VIEW_PROMPT_ARG),
  hostName: parseHostName(process.argv),
  appTheme: launchAppTheme,
  clipboard: {
    read: () => ipcRenderer.invoke(IPC.clipboardRead),
    write: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
    hasImage: () => ipcRenderer.invoke(IPC.clipboardHasImage)
  },
  link: {
    open: (url) => ipcRenderer.send(IPC.linkOpen, url)
  },
  ports: {
    probe: (ports) => ipcRenderer.invoke(IPC.portsProbe, ports)
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
  scrollback: {
    read: (cardId) => ipcRenderer.invoke(IPC.scrollbackRead, cardId),
    save: (cardId, data) => ipcRenderer.send(IPC.scrollbackSave, cardId, data),
    delete: (cardId) => ipcRenderer.send(IPC.scrollbackDelete, cardId),
    quitSaved: () => ipcRenderer.send(IPC.scrollbackQuitSaved)
  },
  settings: {
    load: () => ipcRenderer.invoke(IPC.settingsLoad),
    save: (settings) => ipcRenderer.send(IPC.settingsSave, settings),
    shells: () => ipcRenderer.invoke(IPC.settingsShells),
    ghosttyConfig: () => ipcRenderer.invoke(IPC.settingsGhosttyConfig)
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
  git: {
    branches: (dir) => ipcRenderer.invoke(IPC.gitBranches, dir),
    switch: (dir, branch) => ipcRenderer.invoke(IPC.gitSwitch, dir, branch),
    track: (dir, remote, branch) => ipcRenderer.invoke(IPC.gitTrack, dir, remote, branch),
    create: (dir, name) => ipcRenderer.invoke(IPC.gitCreate, dir, name),
    aheadBehind: (dir) => ipcRenderer.invoke(IPC.gitAheadBehind, dir),
    fetch: (dir) => ipcRenderer.invoke(IPC.gitFetch, dir),
    pull: (dir) => ipcRenderer.invoke(IPC.gitPull, dir),
    push: (dir) => ipcRenderer.invoke(IPC.gitPush, dir),
    openPullRequest: (dir) => ipcRenderer.invoke(IPC.gitOpenPullRequest, dir),
    pullRequest: (dir) => ipcRenderer.invoke(IPC.gitPullRequest, dir),
    merge: (dir, repo, cardBranch, branch) =>
      ipcRenderer.invoke(IPC.gitMerge, dir, repo, cardBranch, branch)
  },
  files: {
    list: (folder, path) => ipcRenderer.invoke(IPC.filesList, folder, path),
    status: (folder) => ipcRenderer.invoke(IPC.filesStatus, folder),
    open: (folder, path) => ipcRenderer.invoke(IPC.filesOpen, folder, path)
  },
  agents: {
    installed: () => ipcRenderer.invoke(IPC.agentsInstalled)
  },
  editors: {
    installed: () => ipcRenderer.invoke(IPC.editorsInstalled)
  },
  agentSetup: {
    read: (folder) => ipcRenderer.invoke(IPC.agentSetupRead, folder),
    claudeVersion: () => ipcRenderer.invoke(IPC.agentSetupClaudeVersion),
    setSwitch: (folder, change) => ipcRenderer.invoke(IPC.agentSetupSwitch, folder, change),
    editConfig: (folder, edit) => ipcRenderer.invoke(IPC.agentSetupConfig, folder, edit),
    openFile: (folder, path) => ipcRenderer.invoke(IPC.agentSetupOpen, folder, path),
    reveal: (folder, path) => ipcRenderer.invoke(IPC.agentSetupReveal, folder, path),
    stats: (folder, extra) => ipcRenderer.invoke(IPC.agentSetupStats, folder, extra)
  },
  agentTab: {
    summary: (folder, sessionId, since) =>
      ipcRenderer.invoke(IPC.agentTabSummary, folder, sessionId, since)
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState),
    onState: (listener) => {
      const handler = (_: unknown, state: UpdateState): void => listener(state)
      ipcRenderer.on(IPC.updateStateChanged, handler)
      return () => ipcRenderer.removeListener(IPC.updateStateChanged, handler)
    },
    onShow: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.updateShow, handler)
      return () => ipcRenderer.removeListener(IPC.updateShow, handler)
    },
    check: () => ipcRenderer.send(IPC.updateCheck),
    skip: () => ipcRenderer.send(IPC.updateSkip),
    install: () => ipcRenderer.send(IPC.updateInstall),
    openPage: () => ipcRenderer.send(IPC.updateOpenPage),
    running: () => ipcRenderer.invoke(IPC.updateRunning)
  },
  app: {
    setBadge: (count) => ipcRenderer.send(IPC.appSetBadge, count),
    focus: () => ipcRenderer.send(IPC.appFocus),
    requestAttention: () => ipcRenderer.send(IPC.appRequestAttention),
    home: () => ipcRenderer.invoke(IPC.appHome),
    reveal: (path) => ipcRenderer.send(IPC.appReveal, path),
    onQuitting: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.appQuitting, handler)
      return () => ipcRenderer.removeListener(IPC.appQuitting, handler)
    },
    onGlobalShow: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC.appGlobalShow, handler)
      return () => ipcRenderer.removeListener(IPC.appGlobalShow, handler)
    }
  },
  cardWindow: {
    focus: (cardId) => ipcRenderer.send(IPC.cardWindowFocus, cardId)
  },
  globalShortcut: {
    state: () => ipcRenderer.invoke(IPC.globalShortcutState),
    suspend: (suspended) => ipcRenderer.send(IPC.globalShortcutSuspend, suspended)
  },
  terminal: {
    spawn: (cols, rows, cwd, cardId, host = null) =>
      ipcRenderer.invoke(IPC.spawn, cols, rows, cwd, cardId, host),
    write: (id, data) => ipcRenderer.send(IPC.write, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.resize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.kill, id),
    ack: (id, chars) => ipcRenderer.send(IPC.ack, id, chars),
    foreground: (id) => ipcRenderer.invoke(IPC.foreground, id),
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

contextBridge.exposeInMainWorld('bikube', api)

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
