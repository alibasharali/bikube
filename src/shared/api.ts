import type { BoardCommand } from '../core/board-args'
import type { BoardReply } from '../core/board-protocol'
import type { Settings } from '../core/settings'
import type { SyncStatus } from '../core/sync-status'
import type { Workspace, WorkspaceState } from '../core/workspace-store'

/** IPC channel names shared by main and preload. */
export const IPC = {
  spawn: 'terminal:spawn',
  write: 'terminal:write',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  ack: 'terminal:ack',
  data: 'terminal:data',
  exit: 'terminal:exit',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  fsIsDirectory: 'fs:isDirectory',
  dialogPickDirectory: 'dialog:pickDirectory',
  stateLoad: 'state:load',
  stateSave: 'state:save',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  boardRequest: 'board:request',
  boardAnswer: 'board:answer',
  syncStatus: 'sync:status',
  syncStatusChanged: 'sync:statusChanged',
  syncSetFolder: 'sync:setFolder',
  syncPickFolder: 'sync:pickFolder',
  syncBoard: 'sync:board'
} as const

export interface TerminalExit {
  id: string
  exitCode: number
  signal?: number
}

/**
 * Outcome of `terminal:spawn`. A refusal (bad arguments, missing directory) or a failed spawn
 * resolves with a `reason` to show after "Couldn't start: ", e.g. `working directory not found`,
 * or `window reloaded` when the page that asked went away while main was checking.
 */
export type SpawnResult = { ok: true; id: string } | { ok: false; reason: string }

/** Terminal operations the renderer may use; main owns the PTYs (D6). */
export interface TerminalApi {
  /**
   * Starts the login shell in `cwd`, which main checks is an absolute path to an existing
   * directory, for the card `cardId` (a non-empty string of at most 100 chars): the shell gets
   * the card's `board` variables (#9 D3). With the card's SSH `host` (#12 D5, D12) it instead
   * runs `ssh` to the host and `cwd` there, which main checks by #12 D2 and D3 (refusing with
   * `invalid host` or `invalid working directory`), with no `board` variables; `null` (or
   * omitted) is a local card.
   */
  spawn(
    cols: number,
    rows: number,
    cwd: string,
    cardId: string,
    host?: string | null
  ): Promise<SpawnResult>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  /**
   * Acknowledges `chars` characters of session `id`'s output (JavaScript string length) that its
   * screen has parsed (#16 D1, D3); main pauses a session's PTY while too much is unacknowledged.
   */
  ack(id: string, chars: number): void
  /** Returns an unsubscribe function. */
  onData(listener: (id: string, data: string) => void): () => void
  onExit(listener: (exit: TerminalExit) => void): () => void
}

/** System clipboard text, owned by main; the renderer has no direct access. */
export interface ClipboardApi {
  read(): Promise<string>
  write(text: string): Promise<void>
}

/** Filesystem checks, run by main. */
export interface FsApi {
  /** True only for an existing directory; false for files, missing paths and invalid arguments. */
  isDirectory(path: string): Promise<boolean>
}

/** Native dialogs, opened by main. */
export interface DialogApi {
  /** Opens the native folder picker; resolves to the chosen absolute path, or null when cancelled. */
  pickDirectory(): Promise<string | null>
}

/** The saved board, stored by main in `userData/drovr-state.json` (#8 D5, D6). */
export interface StateApi {
  /** Main's latest state: the last valid save, else the file's contents, else an empty board. */
  load(): Promise<WorkspaceState>
  /** Main validates `state`, ignores it when invalid, and writes it within 200 ms. */
  save(state: WorkspaceState): void
}

/** App-wide settings, stored by main in `userData/drovr-settings.json` (#10 D6). */
export interface SettingsApi {
  /** Main's latest settings: the last valid save, else the file's (invalid fields defaulted), else the defaults. */
  load(): Promise<Settings>
  /**
   * Main validates `settings` (#10 D1), ignores them when any field is invalid, sets the native
   * theme and writes the file within 200 ms.
   */
  save(settings: Settings): void
}

/**
 * `board` requests main forwards from a card's shell (#9 D10). The renderer resolves and applies
 * each one against its store and returns the reply the CLI prints; preload sends it back.
 */
export interface BoardApi {
  /** `listener` answers one command run by the card `cardId`. Returns an unsubscribe function. */
  onRequest(
    listener: (cardId: string, command: BoardCommand) => BoardReply | Promise<BoardReply>
  ): () => void
}

/** Outcome of setting the sync folder (#13 D10, D14). */
export type SyncFolderResult = { ok: true } | { ok: false; reason: 'not found' }

/**
 * The sync folder (#13 D13, D14), owned by main: its status, setting it, and the boards main hands
 * the renderer to apply. The folder itself is kept in `drovr-settings.json`, never through
 * `settings:save` (D10).
 */
export interface SyncApi {
  /** Main's current status; `off` when no folder is set. */
  status(): Promise<SyncStatus>
  /** `listener` gets every status change. Returns an unsubscribe function. */
  onStatus(listener: (status: SyncStatus) => void): () => void
  /**
   * Sets the sync folder and joins the boards (D9), or turns sync off with null. Main checks the
   * path is an absolute path to an existing directory, else resolves `not found` and keeps the
   * previous folder.
   */
  setFolder(path: string | null): Promise<SyncFolderResult>
  /** Opens the native folder picker and sets the chosen folder; cancelling changes nothing. */
  pickFolder(): Promise<SyncFolderResult>
  /**
   * `listener` gets every board main hands the renderer to apply (D7, D9): it replaces the whole
   * board, keeping the active workspace, and is saved through `state:save` as any change. Returns
   * an unsubscribe function.
   */
  onBoard(listener: (workspaces: Workspace[]) => void): () => void
}

/** The typed surface the preload script exposes to the renderer as `window.drovr`. Grows with each feature. */
export interface DrovrApi {
  platform: NodeJS.Platform
  terminal: TerminalApi
  clipboard: ClipboardApi
  fs: FsApi
  dialog: DialogApi
  state: StateApi
  settings: SettingsApi
  board: BoardApi
  sync: SyncApi
}
