/**
 * Workspace and board model. Plain TS: no Electron or Node imports (D4). The store is
 * synchronous and in memory; `WorkspaceStore` is the seam persistence can slot in behind.
 * Directory existence is checked elsewhere (main, via an fs bridge): pass an injected
 * `validateDirectory` that returns an error message or null.
 */

import type { AgentKind } from './agent-presets'
import { keepKnownRules, rulesNameKnownColumns, type AutoMove } from './auto-move'
import { checkHost, checkRemoteDirectory } from './ssh-location'
import { isWorkspaceLogo, type WorkspaceLogoId } from './workspace-logos'
import {
  CLAUDE_STARTUP,
  checkCardStartup,
  checkStartup,
  type StartupCommand
} from './startup-command'

export const DEFAULT_COLUMN_NAMES = ['Backlog', 'In Progress', 'Review', 'Done'] as const

/**
 * How a workspace shows its cards: `kanban`, its columns as lanes, or `grid`, every card in one
 * grid, latest first. Cards keep their columns in both, so switching changes no card.
 */
export const WORKSPACE_VIEWS = ['kanban', 'grid'] as const
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]

export const isWorkspaceView = (value: unknown): value is WorkspaceView =>
  (WORKSPACE_VIEWS as readonly unknown[]).includes(value)

/** The workspace's view: absent, as in files from before views, is Kanban. */
export const workspaceView = (workspace: Pick<Workspace, 'view'>): WorkspaceView =>
  workspace.view ?? 'kanban'

export interface Column {
  id: string
  name: string
}

/** A terminal on the board (#4 D1). Its session and status are renderer runtime state. */
export interface Card {
  id: string
  columnId: string
  /** Trimmed, never empty (#4 D5). */
  title: string
  /**
   * Copied from the workspace at creation and never changed (#4 D2): an absolute local path, or
   * for an SSH card a path on its host (#12 D3). A worktree card's is in its worktree.
   */
  directory: string
  /** The card's own git worktree, when it was created with one; absent otherwise. */
  worktree?: CardWorktree
  /** The SSH host, copied from the workspace at creation and never changed; absent when local (#12 D1). */
  host?: string
  /** What is typed into the shell on every start (#5 D2); changed only per card (#5 D11). */
  startup: StartupCommand
  /** UUID v4 given at creation, kept whatever the startup command (#5 D4). */
  agentSessionId: string
  /** Whether Claude Code was started with `agentSessionId`; false at creation (#5 D4, D5). */
  claudeStarted: boolean
  /**
   * The agent presets this card has started, distinct, empty at creation (#21 D3); kept whatever
   * the startup command.
   */
  startedAgents: AgentKind[]
  /**
   * Its pending setup (#39 D2): the workspace's Worktree setup, copied when the card was created
   * with its own worktree, typed before its startup command until it succeeds or is skipped (D7).
   * Absent when none. Saved, never synced (D8).
   */
  setup?: string
  /**
   * When it was created, in ms since the epoch, never changed: synced, so the grid view orders a
   * card from another machine too. Absent for cards from before it.
   */
  createdAt?: number
  /**
   * When it was last opened on this machine, in ms since the epoch: saved, never synced, since
   * every open would write the sync file. The grid shows the latest of the two first.
   */
  lastOpenedAt?: number
  /** Only a workspace shell's card-shaped record (never stored): see `StartupState`. */
  exitAfterStartup?: boolean
}

/** Where a card's own git worktree is, and how to remove it. */
export interface CardWorktree {
  /** The worktree's top folder (the card's directory is it, or a folder inside it). */
  path: string
  branch: string
  /** The workspace folder it was made from, which git removes it through. */
  repo: string
}

/** A card created in its own worktree instead of the workspace's folder. */
export interface NewCardWorktree {
  directory: string
  worktree: CardWorktree
}

export interface Workspace {
  id: string
  name: string
  /**
   * Absolute path, or for an SSH workspace a path on its host (#12 D3). New cards start here;
   * existing cards keep their own (#4 D2).
   */
  directory: string
  /** The SSH host (#12 D1, D2); absent for a local workspace. New cards copy it. */
  host?: string
  /** The sidebar badge's icon (#59 D1, D2); absent for none, which shows the name's initial. */
  logo?: WorkspaceLogoId
  /** Each workspace owns exactly one board; this is its ordered columns. */
  columns: Column[]
  /**
   * All cards of the board. Within a column they are in board order, top to bottom: new
   * cards go to the bottom and only moves change it (#6 D2). Filter by `columnId`.
   */
  cards: Card[]
  /** N for the next default `Terminal N` title; starts at 1, never reused (#4 D5). */
  nextCardNumber: number
  /** Preset for new cards only; Claude Code for a new workspace (#5 D10). Never `shell`. */
  defaultStartup: StartupCommand
  /**
   * The workspace's shells: terminals that aren't tasks (a dev server, a test watcher), shown above
   * the board, not on it. The Default shell isn't stored: every workspace has it.
   */
  shells: WorkspaceShell[]
  /**
   * One line typed in a new worktree card's terminal before its startup command (#39 D1); '' for
   * none. Local workspaces only use it; an SSH workspace keeps whatever it has.
   */
  worktreeSetup: string
  /**
   * Its automatic move rules (#42 D2), each naming one of `columns` by id; absent when every
   * rule is off. Deleting a column turns off the rules naming it.
   */
  autoMove?: AutoMove
  /** How it shows its cards; absent for Kanban, so a file never holds `kanban`. */
  view?: 'grid'
}

/** A named shell in the workspace's folder, which types `command` (when set) each time it starts. */
export interface WorkspaceShell {
  id: string
  /** Trimmed, never empty. */
  name: string
  /** One line typed after each start; '' for none. */
  command: string
  /** Started when its workspace is first opened in a run of the app. */
  autostart: boolean
  /**
   * `shell`: a click opens it, typing its command (if any) each start. `trigger`: a click runs its
   * command in the background (`<command>; exit`, out of the sidebar until opened) and it exits
   * when the command ends, with a done or failed result; a click while it runs opens it. A
   * trigger always has a command.
   */
  type: ShellType
  /**
   * The worktree card it runs in, by id: it starts in that card's directory while the card is on
   * the board with its own worktree, else in the workspace's folder. This machine's: saved, never
   * synced (a worktree is a folder on this machine). Absent for the workspace's folder.
   */
  runIn?: string
  /**
   * Added by the New shell shortcut (#66 D2): a plain shell removed from the workspace as soon as
   * it stops, never saved or synced. Runtime only; absent for every other shell.
   */
  temporary?: true
}

export type ShellType = 'shell' | 'trigger'

export const isShellType = (value: unknown): value is ShellType =>
  value === 'shell' || value === 'trigger'

export interface ShellInput {
  name: string
  command: string
  autostart: boolean
  /** Missing is `shell`. */
  type?: ShellType
}

export const MAX_SHELL_NAME_LENGTH = 100

/**
 * A new temporary shell's name (#66 D3): `Terminal N`, N the lowest positive integer no shell of
 * the workspace is called by.
 */
export function temporaryShellName(shells: readonly WorkspaceShell[]): string {
  const taken = new Set(shells.map((s) => s.name))
  let n = 1
  while (taken.has(`Terminal ${n}`)) n++
  return `Terminal ${n}`
}

/** The id of a workspace's Default shell: a plain shell in its folder, never stored. */
export const defaultShellId = (workspaceId: string): string => `default-shell:${workspaceId}`

export interface WorkspaceState {
  workspaces: Workspace[]
  /** Id of the active workspace, or null when there are none. */
  activeId: string | null
}

/** Which input an error belongs to, so the UI can show it inline under that field. */
export type ErrorField =
  | 'name'
  | 'directory'
  | 'host'
  | 'column'
  | 'workspace'
  | 'title'
  | 'card'
  | 'command'
  | 'shell'
  | 'setup'
  | 'logo'

export interface FieldError {
  field: ErrorField
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: FieldError }

export interface WorkspaceInput {
  /** Empty or whitespace defaults to `defaultWorkspaceName` (D6, #12 D4). */
  name: string
  directory: string
  /** An SSH host makes an SSH workspace (#12 D1); absent or null means local. */
  host?: string | null
  /** Defaults to Shell (#5 D10). */
  defaultStartup?: StartupCommand
  /** One line or '' (#39 D1); defaults to ''. */
  worktreeSetup?: string
  /** One of `WORKSPACE_LOGOS` (#59 D1); absent or null means none. */
  logo?: WorkspaceLogoId | null
  /** Defaults to Kanban. */
  view?: WorkspaceView
}

export interface WorkspacePatch {
  name?: string
  directory?: string
  /** A host makes the workspace SSH, null makes it local; new cards only (#12 D1). */
  host?: string | null
  /** Changes the preset for new cards only; existing cards keep theirs (#5 D10). */
  defaultStartup?: StartupCommand
  /** Changes the setup for new worktree cards only (#39 D1, D2). */
  worktreeSetup?: string
  /** A logo sets the badge's icon, null clears it (#59 D2). */
  logo?: WorkspaceLogoId | null
  /**
   * Replaces every automatic move rule (#42 D2, D9): a key per rule that is on, each a column id
   * of this workspace; `{}` turns them all off.
   */
  autoMove?: AutoMove
  /** How it shows its cards; no card changes. */
  view?: WorkspaceView
}

export type MoveDirection = 'left' | 'right'

export interface WorkspaceStore {
  getState(): WorkspaceState
  subscribe(listener: () => void): () => void
  createWorkspace(input: WorkspaceInput): Result<Workspace>
  updateWorkspace(id: string, patch: WorkspacePatch): Result<Workspace>
  deleteWorkspace(id: string): Result<void>
  selectWorkspace(id: string): Result<void>
  /**
   * Moves the workspace to `toIndex` in the sidebar (0 = top, counted among the other workspaces,
   * rounded as `moveCard` rounds); past the end or NaN means the bottom. Only the order changes
   * (#32 D1, D2).
   */
  moveWorkspace(workspaceId: string, toIndex: number): Result<void>
  addColumn(workspaceId: string, name: string): Result<Column>
  renameColumn(workspaceId: string, columnId: string, name: string): Result<Column>
  moveColumn(workspaceId: string, columnId: string, direction: MoveDirection): Result<void>
  deleteColumn(workspaceId: string, columnId: string): Result<void>
  /**
   * Adds a card at the bottom of the column; an empty title becomes `Terminal N`. `startup`
   * defaults to the workspace's default startup command (#5 D9, D10). With `worktree` (a local
   * workspace only) the card runs in that worktree instead of the workspace's folder.
   */
  createCard(
    workspaceId: string,
    columnId: string,
    title: string,
    startup?: StartupCommand,
    worktree?: NewCardWorktree
  ): Result<Card>
  renameCard(workspaceId: string, cardId: string, title: string): Result<Card>
  deleteCard(workspaceId: string, cardId: string): Result<void>
  /**
   * Moves the card to `toColumnId` at `toIndex` (0 = top, counted among that column's cards
   * without this one, fractions rounded down); past the end or NaN means the bottom. Only
   * the card's column and position change (#6 D3, D4).
   */
  moveCard(workspaceId: string, cardId: string, toColumnId: string, toIndex: number): Result<void>
  /** Records that the card was opened at `at` (ms since the epoch), for the grid's order. */
  markCardOpened(workspaceId: string, cardId: string, at: number): Result<Card>
  /** Changes only the setting, used at the card's next start (#5 D11). */
  setCardStartup(workspaceId: string, cardId: string, startup: StartupCommand): Result<Card>
  /** Adds a shell at the end of the workspace's shells; name required, command one line or ''. */
  createShell(workspaceId: string, input: ShellInput): Result<WorkspaceShell>
  /**
   * Adds a temporary plain shell (#66 D2) named by `temporaryShellName` at the end of the
   * workspace's shells.
   */
  createTemporaryShell(workspaceId: string): Result<WorkspaceShell>
  updateShell(workspaceId: string, shellId: string, input: ShellInput): Result<WorkspaceShell>
  /**
   * Where the shell runs from its next start: a worktree card of the workspace, or null for the
   * workspace's folder. Saved on this machine only.
   */
  setShellRunIn(workspaceId: string, shellId: string, cardId: string | null): Result<WorkspaceShell>
  deleteShell(workspaceId: string, shellId: string): Result<void>
  /** Records that `claude --session-id` was typed for this card (#5 D5). */
  markClaudeStarted(workspaceId: string, cardId: string): Result<Card>
  /**
   * The Claude Code session the card resumes from now on, reported by Bikube's hooks once it has
   * a conversation (a message sent, a `/resume`): its agent session id, and started.
   */
  setAgentSession(workspaceId: string, cardId: string, sessionId: string): Result<Card>
  /** Records that the preset's first-start line was typed for this card (#21 D3). */
  markAgentStarted(workspaceId: string, cardId: string, kind: AgentKind): Result<Card>
  /** The card's pending setup succeeded or was skipped (#39 D4, D6): it has none from now on. */
  clearCardSetup(workspaceId: string, cardId: string): Result<Card>
  /**
   * Moves a local card without a worktree into its own new one: it runs there from its next
   * start, after the workspace's Worktree setup when it has one (#39 D2). Agents keep their
   * conversations per folder, so the card gets a new agent session and starts its agent afresh.
   */
  moveCardToWorktree(workspaceId: string, cardId: string, worktree: NewCardWorktree): Result<Card>
  /**
   * Replaces every workspace with `workspaces` (a board from the sync folder, #13 D7, D14): the
   * active workspace stays active when it is still there, else the first one is (or none).
   */
  replaceBoard(workspaces: Workspace[]): void
}

export interface StoreOptions {
  /** Returns an error message, or null when the directory is usable. */
  validateDirectory?: (directory: string) => string | null
  /** Id generator; defaults to a counter. */
  generateId?: () => string
  /** Agent session id generator (#5 D4); defaults to `crypto.randomUUID`. */
  generateSessionId?: () => string
  /** State to start from, e.g. the saved state (#8 D5); defaults to no workspaces. */
  initialState?: WorkspaceState
  /** The clock a new card's `createdAt` is read from; without one, cards get none. */
  now?: () => number
}

/** Last path segment, ignoring trailing separators (POSIX and Windows). */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0)
  const last = parts[parts.length - 1] ?? ''
  return /^[A-Za-z]:$/.test(last) ? '' : last
}

/**
 * The name a workspace gets when none is typed (D6, #12 D4): the directory's last path segment,
 * or for an SSH workspace in `~` its host.
 */
export function defaultWorkspaceName(directory: string, host?: string | null): string {
  const dir = directory.trim()
  if (host && /^~\/*$/.test(dir)) return host.trim()
  return basename(dir)
}

/**
 * `state` with every workspace replaced by `workspaces` (#13 D7): the active workspace stays active
 * when it is still there, else the first one is (or none).
 */
export function withBoard(state: WorkspaceState, workspaces: Workspace[]): WorkspaceState {
  const kept = workspaces.some((w) => w.id === state.activeId)
  return { workspaces, activeId: kept ? state.activeId : (workspaces[0]?.id ?? null) }
}

/** The column's cards, top to bottom (#6 D2). */
export function cardsInColumn(workspace: Workspace, columnId: string): Card[] {
  return workspace.cards.filter((c) => c.columnId === columnId)
}

const isAbsolute = (p: string): boolean => /^([\\/]|[A-Za-z]:[\\/])/.test(p)

const fail = (field: ErrorField, message: string): { ok: false; error: FieldError } => ({
  ok: false,
  error: { field, message }
})

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private state: WorkspaceState
  private readonly listeners = new Set<() => void>()
  private readonly validateDirectory: (directory: string) => string | null
  private readonly generateId: () => string
  private readonly generateSessionId: () => string
  private readonly now: (() => number) | undefined
  private counter = 0

  constructor(options: StoreOptions = {}) {
    this.state = options.initialState ?? { workspaces: [], activeId: null }
    this.validateDirectory = options.validateDirectory ?? (() => null)
    this.generateId = options.generateId ?? (() => `id-${++this.counter}`)
    this.generateSessionId = options.generateSessionId ?? (() => globalThis.crypto.randomUUID())
    this.now = options.now
  }

  getState(): WorkspaceState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  createWorkspace(input: WorkspaceInput): Result<Workspace> {
    const location = this.checkLocation(input.directory, input.host ?? null)
    if (!location.ok) return location
    const { directory, host } = location.value
    const name = this.checkName(input.name.trim() || defaultWorkspaceName(directory, host), null)
    if (!name.ok) return name
    const startup = checkCardStartup(input.defaultStartup ?? CLAUDE_STARTUP)
    if (!startup.ok) return startup
    const setup = checkWorktreeSetup(input.worktreeSetup ?? '')
    if (!setup.ok) return setup
    const logo = checkLogo(input.logo ?? null)
    if (!logo.ok) return logo
    const workspace: Workspace = {
      id: this.generateId(),
      name: name.value,
      directory,
      ...(host !== null && { host }),
      ...(logo.value !== null && { logo: logo.value }),
      columns: DEFAULT_COLUMN_NAMES.map((n) => ({ id: this.generateId(), name: n })),
      cards: [],
      nextCardNumber: 1,
      defaultStartup: startup.value,
      shells: [],
      worktreeSetup: setup.value,
      ...(input.view === 'grid' && { view: 'grid' })
    }
    this.set({
      workspaces: [...this.state.workspaces, workspace],
      activeId: this.state.activeId ?? workspace.id
    })
    return { ok: true, value: workspace }
  }

  updateWorkspace(id: string, patch: WorkspacePatch): Result<Workspace> {
    const current = this.find(id)
    if (!current) return unknownWorkspace()
    let name = current.name
    let directory = current.directory
    let host = current.host ?? null
    if (patch.directory !== undefined || patch.host !== undefined) {
      const location = this.checkLocation(
        patch.directory ?? current.directory,
        patch.host !== undefined ? patch.host : host
      )
      if (!location.ok) return location
      ;({ directory, host } = location.value)
    }
    if (patch.name !== undefined) {
      const checked = this.checkName(patch.name.trim(), id)
      if (!checked.ok) return checked
      name = checked.value
    }
    let defaultStartup = current.defaultStartup
    if (patch.defaultStartup !== undefined) {
      const checked = checkCardStartup(patch.defaultStartup)
      if (!checked.ok) return checked
      defaultStartup = checked.value
    }
    let worktreeSetup = current.worktreeSetup
    if (patch.worktreeSetup !== undefined) {
      const checked = checkWorktreeSetup(patch.worktreeSetup)
      if (!checked.ok) return checked
      worktreeSetup = checked.value
    }
    let logo = current.logo ?? null
    if (patch.logo !== undefined) {
      const checked = checkLogo(patch.logo)
      if (!checked.ok) return checked
      logo = checked.value
    }
    const view = patch.view === undefined ? workspaceView(current) : patch.view
    if (!isWorkspaceView(view)) return fail('workspace', 'Unknown view')
    let autoMove = current.autoMove ?? null
    if (patch.autoMove !== undefined) {
      const columnIds = current.columns.map((c) => c.id)
      if (!rulesNameKnownColumns(patch.autoMove, columnIds)) return unknownColumn()
      autoMove = keepKnownRules(patch.autoMove, columnIds)
    }
    const updated: Workspace = { ...current, name, directory, defaultStartup, worktreeSetup }
    // A local workspace has no `host` key at all, so the saved file never gets one (#12 D10).
    if (host === null) delete updated.host
    else updated.host = host
    // Likewise no `logo` key without a logo (#59 D2).
    if (logo === null) delete updated.logo
    else updated.logo = logo
    // And no `autoMove` key with every rule off (#42 D2).
    if (autoMove === null) delete updated.autoMove
    else updated.autoMove = autoMove
    // And no `view` key for Kanban.
    if (view === 'kanban') delete updated.view
    else updated.view = view
    this.replace(updated)
    return { ok: true, value: updated }
  }

  deleteWorkspace(id: string): Result<void> {
    if (!this.find(id)) return unknownWorkspace()
    const workspaces = this.state.workspaces.filter((w) => w.id !== id)
    const activeId = this.state.activeId === id ? (workspaces[0]?.id ?? null) : this.state.activeId
    this.set({ workspaces, activeId })
    return { ok: true, value: undefined }
  }

  selectWorkspace(id: string): Result<void> {
    if (!this.find(id)) return unknownWorkspace()
    if (this.state.activeId !== id) this.set({ ...this.state, activeId: id })
    return { ok: true, value: undefined }
  }

  moveWorkspace(workspaceId: string, toIndex: number): Result<void> {
    const current = this.find(workspaceId)
    if (!current) return unknownWorkspace()
    const others = this.state.workspaces.filter((w) => w.id !== workspaceId)
    // Fractions round down; NaN fails the comparison and lands at the bottom.
    const index = Math.max(0, Math.floor(toIndex))
    const at = index < others.length ? index : others.length
    const workspaces = [...others.slice(0, at), current, ...others.slice(at)]
    if (workspaces.every((w, i) => w === this.state.workspaces[i])) {
      return { ok: true, value: undefined }
    }
    this.set({ ...this.state, workspaces })
    return { ok: true, value: undefined }
  }

  addColumn(workspaceId: string, name: string): Result<Column> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const checked = checkColumnName(ws, name, null)
    if (!checked.ok) return checked
    const column: Column = { id: this.generateId(), name: checked.value }
    this.replace({ ...ws, columns: [...ws.columns, column] })
    return { ok: true, value: column }
  }

  renameColumn(workspaceId: string, columnId: string, name: string): Result<Column> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    if (!ws.columns.some((c) => c.id === columnId)) return unknownColumn()
    const checked = checkColumnName(ws, name, columnId)
    if (!checked.ok) return checked
    const renamed: Column = { id: columnId, name: checked.value }
    this.replace({ ...ws, columns: ws.columns.map((c) => (c.id === columnId ? renamed : c)) })
    return { ok: true, value: renamed }
  }

  /** Moving past either end is a no-op that still succeeds. */
  moveColumn(workspaceId: string, columnId: string, direction: MoveDirection): Result<void> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const from = ws.columns.findIndex((c) => c.id === columnId)
    if (from < 0) return unknownColumn()
    const to = direction === 'left' ? from - 1 : from + 1
    if (to >= 0 && to < ws.columns.length) {
      const columns = [...ws.columns]
      ;[columns[from], columns[to]] = [columns[to], columns[from]]
      this.replace({ ...ws, columns })
    }
    return { ok: true, value: undefined }
  }

  deleteColumn(workspaceId: string, columnId: string): Result<void> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    if (!ws.columns.some((c) => c.id === columnId)) return unknownColumn()
    if (ws.columns.length === 1) return fail('column', 'A board must keep at least one column')
    if (ws.cards.some((c) => c.columnId === columnId))
      return fail('column', 'Move or delete its cards first')
    const columns = ws.columns.filter((c) => c.id !== columnId)
    const updated: Workspace = { ...ws, columns }
    // Rules naming the deleted column turn off in the same change (#42 D2).
    if (ws.autoMove !== undefined) {
      const autoMove = keepKnownRules(
        ws.autoMove,
        columns.map((c) => c.id)
      )
      if (autoMove === null) delete updated.autoMove
      else updated.autoMove = autoMove
    }
    this.replace(updated)
    return { ok: true, value: undefined }
  }

  createCard(
    workspaceId: string,
    columnId: string,
    title: string,
    startup?: StartupCommand,
    worktree?: NewCardWorktree
  ): Result<Card> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    if (!ws.columns.some((c) => c.id === columnId)) return unknownColumn()
    const checked = checkCardStartup(startup ?? ws.defaultStartup)
    if (!checked.ok) return checked
    const trimmed = title.trim()
    const created: Card = {
      id: this.generateId(),
      columnId,
      title: trimmed || `Terminal ${ws.nextCardNumber}`,
      directory: worktree && ws.host === undefined ? worktree.directory : ws.directory,
      ...(ws.host !== undefined && { host: ws.host }),
      ...(worktree && ws.host === undefined && { worktree: { ...worktree.worktree } }),
      startup: checked.value,
      agentSessionId: this.generateSessionId(),
      claudeStarted: false,
      startedAgents: [],
      // Its worktree is new: the workspace's setup runs first, until it succeeds (#39 D2, D7).
      ...(worktree && ws.host === undefined && ws.worktreeSetup && { setup: ws.worktreeSetup }),
      ...(this.now && { createdAt: this.now() })
    }
    this.replace({
      ...ws,
      cards: [...ws.cards, created],
      nextCardNumber: trimmed ? ws.nextCardNumber : ws.nextCardNumber + 1
    })
    return { ok: true, value: created }
  }

  renameCard(workspaceId: string, cardId: string, title: string): Result<Card> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const current = ws.cards.find((c) => c.id === cardId)
    if (!current) return unknownCard()
    const trimmed = title.trim()
    if (!trimmed) return fail('title', 'Title is required')
    const renamed: Card = { ...current, title: trimmed }
    this.replace({ ...ws, cards: ws.cards.map((c) => (c.id === cardId ? renamed : c)) })
    return { ok: true, value: renamed }
  }

  deleteCard(workspaceId: string, cardId: string): Result<void> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    if (!ws.cards.some((c) => c.id === cardId)) return unknownCard()
    this.replace({ ...ws, cards: ws.cards.filter((c) => c.id !== cardId) })
    return { ok: true, value: undefined }
  }

  moveCard(workspaceId: string, cardId: string, toColumnId: string, toIndex: number): Result<void> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const current = ws.cards.find((c) => c.id === cardId)
    if (!current) return unknownCard()
    if (!ws.columns.some((c) => c.id === toColumnId)) return unknownColumn()
    const others = ws.cards.filter((c) => c.id !== cardId)
    const target = others.filter((c) => c.columnId === toColumnId)
    // Fractions round down; NaN fails every comparison below and lands at the bottom.
    const index = Math.max(0, Math.floor(toIndex))
    let at: number
    if (index < target.length) at = others.indexOf(target[index])
    else if (target.length > 0) at = others.indexOf(target[target.length - 1]) + 1
    else at = others.length
    const moved: Card =
      current.columnId === toColumnId ? current : { ...current, columnId: toColumnId }
    const cards = [...others.slice(0, at), moved, ...others.slice(at)]
    if (cards.every((c, i) => c === ws.cards[i])) return { ok: true, value: undefined }
    this.replace({ ...ws, cards })
    return { ok: true, value: undefined }
  }

  createShell(workspaceId: string, input: ShellInput): Result<WorkspaceShell> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const checked = checkShell(input)
    if (!checked.ok) return checked
    const shell: WorkspaceShell = { id: this.generateId(), ...checked.value }
    this.replace({ ...ws, shells: [...ws.shells, shell] })
    return { ok: true, value: shell }
  }

  createTemporaryShell(workspaceId: string): Result<WorkspaceShell> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const shell: WorkspaceShell = {
      id: this.generateId(),
      name: temporaryShellName(ws.shells),
      command: '',
      autostart: false,
      type: 'shell',
      temporary: true
    }
    this.replace({ ...ws, shells: [...ws.shells, shell] })
    return { ok: true, value: shell }
  }

  updateShell(workspaceId: string, shellId: string, input: ShellInput): Result<WorkspaceShell> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    if (!ws.shells.some((s) => s.id === shellId)) {
      return { ok: false, error: { field: 'shell', message: 'Shell not found' } }
    }
    const checked = checkShell(input)
    if (!checked.ok) return checked
    const current = ws.shells.find((s) => s.id === shellId)
    const runIn = current?.runIn
    const shell: WorkspaceShell = {
      id: shellId,
      ...checked.value,
      ...(runIn !== undefined && { runIn }),
      // An edit keeps a temporary shell temporary (#66 D2; the UI offers no edit for one).
      ...(current?.temporary && { temporary: true })
    }
    this.replace({ ...ws, shells: ws.shells.map((s) => (s.id === shellId ? shell : s)) })
    return { ok: true, value: shell }
  }

  setShellRunIn(
    workspaceId: string,
    shellId: string,
    cardId: string | null
  ): Result<WorkspaceShell> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const current = ws.shells.find((s) => s.id === shellId)
    if (!current) return { ok: false, error: { field: 'shell', message: 'Shell not found' } }
    if (cardId !== null && !ws.cards.some((c) => c.id === cardId && c.worktree)) {
      return fail('card', 'Not a card with its own worktree')
    }
    if ((current.runIn ?? null) === cardId) return { ok: true, value: current }
    const shell: WorkspaceShell = { ...current }
    if (cardId === null) delete shell.runIn
    else shell.runIn = cardId
    this.replace({ ...ws, shells: ws.shells.map((s) => (s.id === shellId ? shell : s)) })
    return { ok: true, value: shell }
  }

  deleteShell(workspaceId: string, shellId: string): Result<void> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    this.replace({ ...ws, shells: ws.shells.filter((s) => s.id !== shellId) })
    return { ok: true, value: undefined }
  }

  markCardOpened(workspaceId: string, cardId: string, at: number): Result<Card> {
    const current = this.find(workspaceId)?.cards.find((c) => c.id === cardId)
    // The same time again changes nothing, so nothing is saved.
    if (current?.lastOpenedAt === at) return { ok: true, value: current }
    return this.updateCard(workspaceId, cardId, (card) => ({
      ok: true,
      value: { ...card, lastOpenedAt: at }
    }))
  }

  setCardStartup(workspaceId: string, cardId: string, startup: StartupCommand): Result<Card> {
    const checked = checkCardStartup(startup)
    return this.updateCard(workspaceId, cardId, (card) =>
      checked.ok ? { ok: true, value: { ...card, startup: checked.value } } : checked
    )
  }

  setAgentSession(workspaceId: string, cardId: string, sessionId: string): Result<Card> {
    return this.updateCard(workspaceId, cardId, (card) => ({
      ok: true,
      value: { ...card, agentSessionId: sessionId, claudeStarted: true }
    }))
  }

  markClaudeStarted(workspaceId: string, cardId: string): Result<Card> {
    return this.updateCard(workspaceId, cardId, (card) => ({
      ok: true,
      value: { ...card, claudeStarted: true }
    }))
  }

  markAgentStarted(workspaceId: string, cardId: string, kind: AgentKind): Result<Card> {
    return this.updateCard(workspaceId, cardId, (card) => ({
      ok: true,
      value: card.startedAgents.includes(kind)
        ? card
        : { ...card, startedAgents: [...card.startedAgents, kind] }
    }))
  }

  clearCardSetup(workspaceId: string, cardId: string): Result<Card> {
    return this.updateCard(workspaceId, cardId, (card) => {
      if (card.setup === undefined) return { ok: true, value: card }
      const cleared: Card = { ...card }
      delete cleared.setup
      return { ok: true, value: cleared }
    })
  }

  moveCardToWorktree(workspaceId: string, cardId: string, worktree: NewCardWorktree): Result<Card> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    return this.updateCard(workspaceId, cardId, (card) => {
      if (card.host !== undefined) return fail('card', 'An SSH card can’t have its own worktree')
      if (card.worktree) return fail('card', 'The card already has its own worktree')
      const moved: Card = {
        ...card,
        directory: worktree.directory,
        worktree: { ...worktree.worktree },
        agentSessionId: this.generateSessionId(),
        claudeStarted: false,
        startedAgents: []
      }
      if (ws.worktreeSetup) moved.setup = ws.worktreeSetup
      return { ok: true, value: moved }
    })
  }

  replaceBoard(workspaces: Workspace[]): void {
    this.set(withBoard(this.state, workspaces))
  }

  private updateCard(
    workspaceId: string,
    cardId: string,
    change: (card: Card) => Result<Card>
  ): Result<Card> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    const current = ws.cards.find((c) => c.id === cardId)
    if (!current) return unknownCard()
    const changed = change(current)
    if (!changed.ok) return changed
    this.replace({ ...ws, cards: ws.cards.map((c) => (c.id === cardId ? changed.value : c)) })
    return changed
  }

  private find(id: string): Workspace | undefined {
    return this.state.workspaces.find((w) => w.id === id)
  }

  /**
   * The trimmed directory and host: a local directory by today's rules, or an SSH host and
   * remote directory by #12 D2 and D3 (never checked locally).
   */
  private checkLocation(
    rawDirectory: string,
    rawHost: string | null
  ): Result<{ directory: string; host: string | null }> {
    if (rawHost === null) {
      const directory = rawDirectory.trim()
      const dir = this.checkDirectory(directory)
      return dir ?? { ok: true, value: { directory, host: null } }
    }
    const host = checkHost(rawHost)
    if (!host.ok) return fail('host', host.message)
    const directory = checkRemoteDirectory(rawDirectory)
    if (!directory.ok) return fail('directory', directory.message)
    return { ok: true, value: { directory: directory.value, host: host.value } }
  }

  private checkDirectory(directory: string): { ok: false; error: FieldError } | null {
    if (!directory) return fail('directory', 'Working directory is required')
    if (!isAbsolute(directory))
      return fail('directory', 'Working directory must be an absolute path')
    const message = this.validateDirectory(directory)
    return message ? fail('directory', message) : null
  }

  /** `name` must already be trimmed. `selfId` is excluded from the uniqueness check. */
  private checkName(name: string, selfId: string | null): Result<string> {
    if (!name) return fail('name', 'Name is required')
    if (this.state.workspaces.some((w) => w.id !== selfId && sameName(w.name, name))) {
      return fail('name', 'A workspace with this name already exists')
    }
    return { ok: true, value: name }
  }

  private replace(workspace: Workspace): void {
    this.set({
      ...this.state,
      workspaces: this.state.workspaces.map((w) => (w.id === workspace.id ? workspace : w))
    })
  }

  private set(state: WorkspaceState): void {
    this.state = state
    this.listeners.forEach((l) => l())
  }
}

function checkColumnName(ws: Workspace, raw: string, selfId: string | null): Result<string> {
  const name = raw.trim()
  if (!name) return fail('column', 'Column name is required')
  if (ws.columns.some((c) => c.id !== selfId && sameName(c.name, name))) {
    return fail('column', 'A column with this name already exists')
  }
  return { ok: true, value: name }
}

const unknownWorkspace = (): { ok: false; error: FieldError } =>
  fail('workspace', 'Workspace not found')
const unknownColumn = (): { ok: false; error: FieldError } => fail('column', 'Column not found')
const unknownCard = (): { ok: false; error: FieldError } => fail('card', 'Card not found')

/** A shell's fields, trimmed and checked: a name of 1 to 100 characters, a one-line command or ''. */
export function checkShell(input: ShellInput): Result<Omit<WorkspaceShell, 'id'>> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: { field: 'name', message: 'Name is required' } }
  if (name.length > MAX_SHELL_NAME_LENGTH) {
    return { ok: false, error: { field: 'name', message: 'Name is too long' } }
  }
  const command = input.command.trim()
  if (command) {
    const checked = checkStartup({ kind: 'custom', command })
    if (!checked.ok) return { ok: false, error: { ...checked.error, field: 'command' } }
  }
  const type: ShellType = input.type === 'trigger' ? 'trigger' : 'shell'
  // A trigger types `<command>; exit`: an ending `;`, `&` or `|` would make that a syntax error,
  // and a `#` comment would comment the `exit` out (as #39's setup line refuses).
  if (type === 'trigger') {
    if (!command) return fail('command', 'A trigger needs a command')
    if (/[;&|]$/.test(command))
      return fail('command', "A trigger's command can't end with ; & or |")
    if (/(^|\s)#/.test(command))
      return fail('command', "A trigger's command can't have a # comment")
  }
  return { ok: true, value: { name, command, autostart: input.autostart === true, type } }
}

/**
 * A workspace's Worktree setup, trimmed and checked like a Custom command; '' is none (#39 D1).
 * It may not end with `;`, `&` or `|`: the setup line appends `&& …` to it, which would then
 * never report back.
 */
export function checkWorktreeSetup(raw: string): Result<string> {
  const command = raw.trim()
  if (!command) return { ok: true, value: '' }
  const checked = checkStartup({ kind: 'custom', command })
  if (!checked.ok) return { ok: false, error: { ...checked.error, field: 'setup' } }
  if (/[;&|]$/.test(command)) {
    return { ok: false, error: { field: 'setup', message: "Command can't end with ; & or |" } }
  }
  return { ok: true, value: command }
}

/** A workspace's logo: one of `WORKSPACE_LOGOS`, or null for none (#59 D1, D2). */
function checkLogo(raw: WorkspaceLogoId | null): Result<WorkspaceLogoId | null> {
  if (raw === null || isWorkspaceLogo(raw)) return { ok: true, value: raw }
  return fail('logo', 'Unknown logo')
}
