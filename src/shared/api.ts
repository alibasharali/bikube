import type { BoardCommand } from '../core/board-args'
import type { BoardReply } from '../core/board-protocol'
import type { GhosttyTheme } from '../core/ghostty-config'
import type { OpenResult } from '../core/open-result'
import type { FolderListing } from '../core/file-tree'
import type { FolderStatus } from '../core/git-status'
import type { PullRequestRead } from '../core/pr-status'
import type { AheadBehind, BranchList, GitResult, NewBranchResult, SyncResult } from '../core/git'
import type { CreateResult } from '../core/worktrees'
import type { Settings } from '../core/settings'
import type { SyncStatus } from '../core/sync-status'
import type { UpdateState } from '../core/updates'
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
  linkOpen: 'link:open',
  fsIsDirectory: 'fs:isDirectory',
  dialogPickDirectory: 'dialog:pickDirectory',
  stateLoad: 'state:load',
  stateSave: 'state:save',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  settingsShells: 'settings:shells',
  settingsGhosttyTheme: 'settings:ghosttyTheme',
  boardRequest: 'board:request',
  boardAnswer: 'board:answer',
  syncStatus: 'sync:status',
  syncStatusChanged: 'sync:statusChanged',
  syncSetFolder: 'sync:setFolder',
  syncPickFolder: 'sync:pickFolder',
  syncBoard: 'sync:board',
  appSetBadge: 'app:setBadge',
  appFocus: 'app:focus',
  appRequestAttention: 'app:requestAttention',
  appHome: 'app:home',
  appReveal: 'app:reveal',
  worktreeInfo: 'worktree:info',
  worktreeCreate: 'worktree:create',
  worktreeDirty: 'worktree:dirty',
  worktreeRemove: 'worktree:remove',
  gitBranches: 'git:branches',
  gitSwitch: 'git:switch',
  gitTrack: 'git:track',
  gitCreate: 'git:create',
  gitAheadBehind: 'git:aheadBehind',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitOpenPullRequest: 'git:openPullRequest',
  gitPullRequest: 'git:pullRequest',
  filesList: 'files:list',
  filesStatus: 'files:status',
  filesOpen: 'files:open',
  updateState: 'update:state',
  updateStateChanged: 'update:stateChanged',
  updateShow: 'update:show',
  updateCheck: 'update:check',
  updateSkip: 'update:skip',
  updateInstall: 'update:install',
  updateOpenPage: 'update:openPage',
  updateRunning: 'update:running'
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
   * Starts the Shell setting's shell (the login shell by default) as a login shell in `cwd`,
   * which main checks is an absolute path to an existing
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

/** A terminal link, opened in the default browser by main (http and https only). */
export interface LinkApi {
  open(url: string): void
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
  /** The login shell (`$SHELL`) and the shells in `/etc/shells` that exist, for the Shell setting. */
  shells(): Promise<ShellChoices>
  /** Reads the user's Ghostty config and theme now, for the "Use Ghostty theme" setting. */
  ghosttyTheme(): Promise<GhosttyTheme>
}

export interface ShellChoices {
  login: string
  shells: string[]
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

/** A local folder's git repository, for offering a card its own worktree. */
export interface WorktreeInfo {
  /** The checked-out branch; null on a detached HEAD. */
  branch: string | null
  /** Every local branch, so a new card's branch name is free. */
  branches: string[]
}

/** Cards' own git worktrees, made and removed by main in `<userData>/worktrees`. */
export interface WorktreeApi {
  /** The repository `dir` is in, or null when it isn't in one (or git is missing). */
  info(dir: string): Promise<WorktreeInfo | null>
  /**
   * Makes a worktree on the new `branch` from the repository's HEAD, with its git-ignored files
   * copied in; the result gives the card's directory inside it.
   */
  create(dir: string, branch: string): Promise<CreateResult>
  /** Whether the worktree has uncommitted changes; null when it can't tell. */
  dirty(path: string): Promise<boolean | null>
  /** Removes the worktree (its branch stays); `force` even with uncommitted changes. */
  remove(
    repo: string,
    path: string,
    force: boolean
  ): Promise<{ ok: true } | { ok: false; reason: string }>
}

/**
 * The title bar's branch menu (#33), run by main in a local folder inside a git repository: never
 * prompts, never through a shell (D12, D15).
 */
export interface GitApi {
  /** The branches of the repository `dir` is in; null outside one. */
  branches(dir: string): Promise<BranchList | null>
  /** Switches to the local `branch`; git's message when it refuses (D4, D6). */
  switch(dir: string, branch: string): Promise<GitResult>
  /** Switches to `remote`'s `branch`: its local branch, else a new one tracking it (D5). */
  track(dir: string, remote: string, branch: string): Promise<GitResult>
  /**
   * Creates `name` at HEAD and switches to it (D7); an empty, invalid or taken name runs nothing
   * and comes back with `name` set.
   */
  create(dir: string, name: string): Promise<NewBranchResult>
  /** The current branch's `↑ahead ↓behind` against its upstream as of the last fetch; null without one (D10). */
  aheadBehind(dir: string): Promise<AheadBehind | null>
  /** `git fetch --all --prune`: `Fetched`, else git's message (D8). */
  fetch(dir: string): Promise<SyncResult>
  /** `git pull --ff-only`: `Pulled` or `Already up to date`, else git's refusal (D9). */
  pull(dir: string): Promise<SyncResult>
  /** Pushes the current branch, to `origin` as its upstream when it has none: `Pushed` (D9). */
  push(dir: string): Promise<SyncResult>
  /**
   * Open pull request from a worktree card (#38 D3, D4): pushes the branch checked out in its
   * worktree `dir` like `push`, then main opens GitHub's page for a new pull request on it in the
   * browser: `Pushed · opened in the browser`, else git's message or `Not a GitHub remote: …`.
   */
  openPullRequest(dir: string): Promise<SyncResult>
  /**
   * The pull request of the branch checked out in the worktree `dir`, as the user's `gh` sees it
   * (#38 D7): the branch main read and its PR, null for none (any failure); null outside a
   * repository and on a detached HEAD. Never an error.
   */
  pullRequest(dir: string): Promise<PullRequestRead | null>
}

/**
 * The side panel's Files tab (#55 D16), read by main inside the shown folder (an absolute,
 * existing folder): anything that resolves outside it is refused with `ok: false`.
 */
export interface FilesApi {
  /**
   * The entries of the folder `path` (relative, `/`-separated, `''` for the shown folder itself)
   * inside `folder`: folders first, the first 2,000, ignored ones marked (D7, D8, D9).
   */
  list(folder: string, path: string): Promise<FolderListing>
  /**
   * What git sees as changed inside `folder` (D10): one letter per path (relative to `folder`),
   * renames with their old path; `not-repository` outside a work tree.
   */
  status(folder: string): Promise<FolderStatus>
  /**
   * Opens the file `path` (relative to `folder`) with the editor setting (D13, D14): `refused`
   * when it isn't a file inside `folder`, `no-command` for an empty custom command, `failed` with
   * the reason when the editor couldn't be started.
   */
  open(folder: string, path: string): Promise<OpenResult>
}

/** The app's place on the desktop, for notifications. */
export interface AppApi {
  /** The Dock (or launcher) badge: how many cards wait for the user; 0 clears it. */
  setBadge(count: number): void
  /** Brings this window forward, e.g. when a notification is clicked. */
  focus(): void
  /** While the window isn't focused: a Dock bounce on macOS, a flashing taskbar entry elsewhere. */
  requestAttention(): void
  /** The user's home folder, for showing paths with `~`. */
  home(): Promise<string>
  /** Opens a local folder in Finder or the file manager; anything but an existing folder is ignored. */
  reveal(path: string): void
}

/** App updates from GitHub Releases, run by main (`src/main/updates.ts`). */
export interface UpdateApi {
  /** What the updater is doing, and the version running. */
  state(): Promise<{ state: UpdateState; current: string }>
  /** `listener` gets every change. Returns an unsubscribe function. */
  onState(listener: (state: UpdateState) => void): () => void
  /** `listener` is called when the app menu's Check for Updates… asks to show the popup. */
  onShow(listener: () => void): () => void
  /** A check the user asked for. */
  check(): void
  /** Skips the available version: no download, no install at quit, no button until a newer one. */
  skip(): void
  /**
   * Installs the downloaded update: Drovr quits, the app is swapped and opened again. Opens the
   * release page instead where Drovr can't replace itself (or the download failed); starts the
   * download of a skipped version.
   */
  install(): void
  /** Opens the release's page (its notes) in the browser. */
  openPage(): void
  /** How many terminals are running, for the install confirmation. */
  running(): Promise<number>
}

/** The typed surface the preload script exposes to the renderer as `window.drovr`. Grows with each feature. */
export interface DrovrApi {
  platform: NodeJS.Platform
  terminal: TerminalApi
  clipboard: ClipboardApi
  link: LinkApi
  fs: FsApi
  dialog: DialogApi
  state: StateApi
  settings: SettingsApi
  board: BoardApi
  sync: SyncApi
  app: AppApi
  worktree: WorktreeApi
  git: GitApi
  files: FilesApi
  update: UpdateApi
}
