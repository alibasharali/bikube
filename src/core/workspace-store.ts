/**
 * Workspace and board model. Plain TS: no Electron or Node imports (D4). The store is
 * synchronous and in memory; `WorkspaceStore` is the seam persistence can slot in behind.
 * Directory existence is checked elsewhere (main, via an fs bridge): pass an injected
 * `validateDirectory` that returns an error message or null.
 */

import { SHELL_STARTUP, checkStartup, type StartupCommand } from './startup-command'

export const DEFAULT_COLUMN_NAMES = ['Backlog', 'Running', 'Needs me', 'Done'] as const

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
  /** Absolute path, copied from the workspace at creation and never changed (#4 D2). */
  directory: string
  /** What is typed into the shell on every start (#5 D2); changed only per card (#5 D11). */
  startup: StartupCommand
  /** UUID v4 given at creation, kept whatever the startup command (#5 D4). */
  agentSessionId: string
  /** Whether Claude Code was started with `agentSessionId`; false at creation (#5 D4, D5). */
  claudeStarted: boolean
}

export interface Workspace {
  id: string
  name: string
  /** Absolute path. New cards start here; existing cards keep their own (#4 D2). */
  directory: string
  /** Each workspace owns exactly one board; this is its ordered columns. */
  columns: Column[]
  /**
   * All cards of the board. Within a column they are in board order, top to bottom: new
   * cards go to the bottom and only moves change it (#6 D2). Filter by `columnId`.
   */
  cards: Card[]
  /** N for the next default `Terminal N` title; starts at 1, never reused (#4 D5). */
  nextCardNumber: number
  /** Preset for new cards only; `shell` for a new workspace (#5 D10). */
  defaultStartup: StartupCommand
}

export interface WorkspaceState {
  workspaces: Workspace[]
  /** Id of the active workspace, or null when there are none. */
  activeId: string | null
}

/** Which input an error belongs to, so the UI can show it inline under that field. */
export type ErrorField =
  'name' | 'directory' | 'column' | 'workspace' | 'title' | 'card' | 'command'

export interface FieldError {
  field: ErrorField
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: FieldError }

export interface WorkspaceInput {
  /** Empty or whitespace defaults to the directory's basename (D6). */
  name: string
  directory: string
  /** Defaults to Shell (#5 D10). */
  defaultStartup?: StartupCommand
}

export interface WorkspacePatch {
  name?: string
  directory?: string
  /** Changes the preset for new cards only; existing cards keep theirs (#5 D10). */
  defaultStartup?: StartupCommand
}

export type MoveDirection = 'left' | 'right'

export interface WorkspaceStore {
  getState(): WorkspaceState
  subscribe(listener: () => void): () => void
  createWorkspace(input: WorkspaceInput): Result<Workspace>
  updateWorkspace(id: string, patch: WorkspacePatch): Result<Workspace>
  deleteWorkspace(id: string): Result<void>
  selectWorkspace(id: string): Result<void>
  addColumn(workspaceId: string, name: string): Result<Column>
  renameColumn(workspaceId: string, columnId: string, name: string): Result<Column>
  moveColumn(workspaceId: string, columnId: string, direction: MoveDirection): Result<void>
  deleteColumn(workspaceId: string, columnId: string): Result<void>
  /**
   * Adds a card at the bottom of the column; an empty title becomes `Terminal N`. `startup`
   * defaults to the workspace's default startup command (#5 D9, D10).
   */
  createCard(
    workspaceId: string,
    columnId: string,
    title: string,
    startup?: StartupCommand
  ): Result<Card>
  renameCard(workspaceId: string, cardId: string, title: string): Result<Card>
  deleteCard(workspaceId: string, cardId: string): Result<void>
  /**
   * Moves the card to `toColumnId` at `toIndex` (0 = top, counted among that column's cards
   * without this one, fractions rounded down); past the end or NaN means the bottom. Only
   * the card's column and position change (#6 D3, D4).
   */
  moveCard(workspaceId: string, cardId: string, toColumnId: string, toIndex: number): Result<void>
  /** Changes only the setting, used at the card's next start (#5 D11). */
  setCardStartup(workspaceId: string, cardId: string, startup: StartupCommand): Result<Card>
  /** Records that `claude --session-id` was typed for this card (#5 D5). */
  markClaudeStarted(workspaceId: string, cardId: string): Result<Card>
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
}

/** Last path segment, ignoring trailing separators (POSIX and Windows). */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0)
  const last = parts[parts.length - 1] ?? ''
  return /^[A-Za-z]:$/.test(last) ? '' : last
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
  private counter = 0

  constructor(options: StoreOptions = {}) {
    this.state = options.initialState ?? { workspaces: [], activeId: null }
    this.validateDirectory = options.validateDirectory ?? (() => null)
    this.generateId = options.generateId ?? (() => `id-${++this.counter}`)
    this.generateSessionId = options.generateSessionId ?? (() => globalThis.crypto.randomUUID())
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
    const directory = input.directory.trim()
    const dir = this.checkDirectory(directory)
    if (dir) return dir
    const name = this.checkName(input.name.trim() || basename(directory), null)
    if (!name.ok) return name
    const startup = checkStartup(input.defaultStartup ?? SHELL_STARTUP)
    if (!startup.ok) return startup
    const workspace: Workspace = {
      id: this.generateId(),
      name: name.value,
      directory,
      columns: DEFAULT_COLUMN_NAMES.map((n) => ({ id: this.generateId(), name: n })),
      cards: [],
      nextCardNumber: 1,
      defaultStartup: startup.value
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
    if (patch.directory !== undefined) {
      directory = patch.directory.trim()
      const dir = this.checkDirectory(directory)
      if (dir) return dir
    }
    if (patch.name !== undefined) {
      const checked = this.checkName(patch.name.trim(), id)
      if (!checked.ok) return checked
      name = checked.value
    }
    let defaultStartup = current.defaultStartup
    if (patch.defaultStartup !== undefined) {
      const checked = checkStartup(patch.defaultStartup)
      if (!checked.ok) return checked
      defaultStartup = checked.value
    }
    const updated: Workspace = { ...current, name, directory, defaultStartup }
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
    this.replace({ ...ws, columns: ws.columns.filter((c) => c.id !== columnId) })
    return { ok: true, value: undefined }
  }

  createCard(
    workspaceId: string,
    columnId: string,
    title: string,
    startup?: StartupCommand
  ): Result<Card> {
    const ws = this.find(workspaceId)
    if (!ws) return unknownWorkspace()
    if (!ws.columns.some((c) => c.id === columnId)) return unknownColumn()
    const checked = checkStartup(startup ?? ws.defaultStartup)
    if (!checked.ok) return checked
    const trimmed = title.trim()
    const created: Card = {
      id: this.generateId(),
      columnId,
      title: trimmed || `Terminal ${ws.nextCardNumber}`,
      directory: ws.directory,
      startup: checked.value,
      agentSessionId: this.generateSessionId(),
      claudeStarted: false
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

  setCardStartup(workspaceId: string, cardId: string, startup: StartupCommand): Result<Card> {
    const checked = checkStartup(startup)
    return this.updateCard(workspaceId, cardId, (card) =>
      checked.ok ? { ok: true, value: { ...card, startup: checked.value } } : checked
    )
  }

  markClaudeStarted(workspaceId: string, cardId: string): Result<Card> {
    return this.updateCard(workspaceId, cardId, (card) => ({
      ok: true,
      value: { ...card, claudeStarted: true }
    }))
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
