/**
 * Workspace and board model. Plain TS: no Electron or Node imports (D4). The store is
 * synchronous and in memory; `WorkspaceStore` is the seam persistence can slot in behind.
 * Directory existence is checked elsewhere (main, via an fs bridge): pass an injected
 * `validateDirectory` that returns an error message or null.
 */

export const DEFAULT_COLUMN_NAMES = ['Backlog', 'Running', 'Needs me', 'Done'] as const

export interface Column {
  id: string
  name: string
}

export interface Workspace {
  id: string
  name: string
  /** Absolute path. Every terminal in this workspace starts here (later item). */
  directory: string
  /** Each workspace owns exactly one board; this is its ordered columns. */
  columns: Column[]
}

export interface WorkspaceState {
  workspaces: Workspace[]
  /** Id of the active workspace, or null when there are none. */
  activeId: string | null
}

/** Which input an error belongs to, so the UI can show it inline under that field. */
export type ErrorField = 'name' | 'directory' | 'column' | 'workspace'

export interface FieldError {
  field: ErrorField
  message: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: FieldError }

export interface WorkspaceInput {
  /** Empty or whitespace defaults to the directory's basename (D6). */
  name: string
  directory: string
}

export interface WorkspacePatch {
  name?: string
  directory?: string
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
}

export interface StoreOptions {
  /** Returns an error message, or null when the directory is usable. */
  validateDirectory?: (directory: string) => string | null
  /** Id generator; defaults to a counter. */
  generateId?: () => string
}

/** Last path segment, ignoring trailing separators (POSIX and Windows). */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0)
  const last = parts[parts.length - 1] ?? ''
  return /^[A-Za-z]:$/.test(last) ? '' : last
}

const isAbsolute = (p: string): boolean => /^([\\/]|[A-Za-z]:[\\/])/.test(p)

const fail = (field: ErrorField, message: string): { ok: false; error: FieldError } => ({
  ok: false,
  error: { field, message }
})

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private state: WorkspaceState = { workspaces: [], activeId: null }
  private readonly listeners = new Set<() => void>()
  private readonly validateDirectory: (directory: string) => string | null
  private readonly generateId: () => string
  private counter = 0

  constructor(options: StoreOptions = {}) {
    this.validateDirectory = options.validateDirectory ?? (() => null)
    this.generateId = options.generateId ?? (() => `id-${++this.counter}`)
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
    const workspace: Workspace = {
      id: this.generateId(),
      name: name.value,
      directory,
      columns: DEFAULT_COLUMN_NAMES.map((n) => ({ id: this.generateId(), name: n }))
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
    const updated: Workspace = { ...current, name, directory }
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
    this.replace({ ...ws, columns: ws.columns.filter((c) => c.id !== columnId) })
    return { ok: true, value: undefined }
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
