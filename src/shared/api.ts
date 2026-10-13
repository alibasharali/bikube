import type { WorkspaceState } from '../core/workspace-store'

/** IPC channel names shared by main and preload. */
export const IPC = {
  spawn: 'terminal:spawn',
  write: 'terminal:write',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  data: 'terminal:data',
  exit: 'terminal:exit',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  fsIsDirectory: 'fs:isDirectory',
  dialogPickDirectory: 'dialog:pickDirectory',
  stateLoad: 'state:load',
  stateSave: 'state:save'
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
  /** Starts the login shell in `cwd`, which main checks is an absolute path to an existing directory. */
  spawn(cols: number, rows: number, cwd: string): Promise<SpawnResult>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
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

/** The typed surface the preload script exposes to the renderer as `window.drovr`. Grows with each feature. */
export interface DrovrApi {
  platform: NodeJS.Platform
  terminal: TerminalApi
  clipboard: ClipboardApi
  fs: FsApi
  dialog: DialogApi
  state: StateApi
}
