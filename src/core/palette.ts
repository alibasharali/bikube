/**
 * The command palette's rows and matching (#40 D3–D6): card and shell rows from the workspace
 * state, the actions that apply now, and the fuzzy matcher. Plain TS with no DOM, Electron or Node
 * imports: the renderer runs it.
 */
import { ACTIVITY_LABELS, type Activity } from './activity'
import { APP_THEMES, type AppThemeId } from './app-themes'
import { SHORTCUT_LABELS, type Keymap } from './keymap'
import type { Theme } from './settings'
import { MAX_PANES } from './split-tree'
import { nextWaitingCard } from './waiting'
import { DEFAULT_SHELL_TITLE, shellCards } from './workspace-shells'
import {
  cardsInColumn,
  defaultShellId,
  workspaceView,
  type Workspace,
  type WorkspaceState,
  type WorkspaceView
} from './workspace-store'

const PREFIX_SCORE = 4
const WORD_START_SCORE = 3
const CONTIGUOUS_SCORE = 2
const SCATTERED_SCORE = 1

const isWordChar = (c: string): boolean => /[\p{L}\p{N}]/u.test(c)

function isSubsequence(term: string, text: string): boolean {
  let at = 0
  for (let i = 0; i < text.length && at < term.length; i++) {
    if (text[i] === term[at]) at++
  }
  return at === term.length
}

function startsAtWordStart(term: string, text: string): boolean {
  for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
    if (i === 0 || !isWordChar(text[i - 1])) return true
  }
  return false
}

function termScore(term: string, text: string, primary: string): number | null {
  if (!isSubsequence(term, text)) return null
  if (primary.startsWith(term)) return PREFIX_SCORE
  if (startsAtWordStart(term, text)) return WORD_START_SCORE
  if (text.includes(term)) return CONTIGUOUS_SCORE
  return SCATTERED_SCORE
}

/**
 * How well `query` matches a row (D4), or null when it doesn't: the trimmed query is split on
 * spaces into terms, each of which must be a case-insensitive subsequence of `searchable`; the
 * score is the sum of each term's best: a prefix of `primary` (the title or label) > starting at a
 * word start in `searchable` > contiguous > scattered. An empty query matches with 0.
 */
export function matchScore(query: string, searchable: string, primary: string): number | null {
  const text = searchable.toLowerCase()
  const title = primary.toLowerCase()
  let total = 0
  for (const term of query.toLowerCase().split(' ')) {
    if (!term) continue
    const score = termScore(term, text, title)
    if (score === null) return null
    total += score
  }
  return total
}

/** A card's or shell's live status as the renderer tracks it (see `CardStatus`). */
export interface RowStatus {
  /** `Running`, `Stopped`, `SSH failed: …` or `Couldn't start: …`. */
  label: string
  activity?: Activity
}

/** A card or shell row (D3). */
export interface TerminalRow {
  kind: 'card' | 'shell'
  workspaceId: string
  /** The card's id, or the shell's (the Default shell's is `defaultShellId`). */
  cardId: string
  /** The card's title or shell's name; `Default shell` for the Default shell. */
  title: string
  workspaceName: string
  /** The card's worktree branch, when it has one. */
  branch?: string
  statusLabel: string
  /** The activity pill's text (`Working`, `Waiting for you`, `Needs your answer`) when set. */
  activityText?: string
}

/** What an action row does when run (D6). */
export type PaletteAction =
  | { id: 'back' }
  | { id: 'splitRight' }
  | { id: 'splitDown' }
  | { id: 'closePane' }
  | { id: 'closeCard' }
  | { id: 'togglePanel' }
  | { id: 'find' }
  | { id: 'copyCommandOutput' }
  | { id: 'moveCard'; columnId: string }
  | { id: 'newCard' }
  | { id: 'openShell' }
  | { id: 'nextWaiting' }
  | { id: 'zoomPane' }
  | { id: 'openInWindow' }
  | { id: 'newWorkspace' }
  | { id: 'settings' }
  | { id: 'theme'; theme: Theme }
  | { id: 'appTheme'; appTheme: AppThemeId }
  | { id: 'switchWorkspace'; workspaceId: string }
  | { id: 'workspaceView'; view: WorkspaceView }

/** An action row (D6): its label and, when it has one, its shortcut as D7 text. */
export interface ActionRow {
  kind: 'action'
  action: PaletteAction
  label: string
  shortcut?: string
}

export type PaletteRow = TerminalRow | ActionRow

/** The palette's three sections, in D2's order. */
export interface PaletteItems {
  cards: TerminalRow[]
  shells: TerminalRow[]
  actions: ActionRow[]
}

/** The card or shell open at full size. */
export interface OpenView {
  kind: 'card' | 'shell'
  workspaceId: string
  cardId: string
  /** Whether its main shell runs. */
  running: boolean
  /** Its panes, the main one included. */
  paneCount: number
  /** Whether the focused pane is an extra pane (not the main one). */
  extraPaneFocused: boolean
  /** Whether the focused pane has a terminal screen to search (Find does nothing without, #35 D12). */
  focusedPaneHasScreen: boolean
  /** Whether the view shows only its focused pane (#48 D1). */
  zoomed?: boolean
}

export interface PaletteInput {
  state: WorkspaceState
  /** The live status of a card or shell by id. */
  status: (cardId: string) => RowStatus
  /** The card or shell open at full size, or null on the board. */
  view: OpenView | null
  theme: Theme
  /** The current app theme (#64 D9). */
  appTheme: AppThemeId
  keymap: Keymap
  platform: string
  /** The waiting cards' and shells' ids, oldest first (#41 D2). */
  waiting: readonly string[]
}

const THEME_LABELS: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' }
const THEME_ORDER: Theme[] = ['system', 'dark', 'light']
const WORKSPACE_SHORTCUTS = 9

/** The workspaces in D5's order: the active one first, then the others in sidebar order. */
function workspaceOrder(state: WorkspaceState): Workspace[] {
  const active = state.workspaces.filter((w) => w.id === state.activeId)
  return [...active, ...state.workspaces.filter((w) => w.id !== state.activeId)]
}

function terminalRow(
  kind: TerminalRow['kind'],
  workspace: Workspace,
  cardId: string,
  title: string,
  branch: string | undefined,
  status: RowStatus
): TerminalRow {
  return {
    kind,
    workspaceId: workspace.id,
    cardId,
    title,
    workspaceName: workspace.name,
    ...(branch !== undefined && { branch }),
    statusLabel: status.label,
    ...(status.activity && { activityText: ACTIVITY_LABELS[status.activity] })
  }
}

function cardRows(input: PaletteInput, order: Workspace[]): TerminalRow[] {
  return order.flatMap((w) =>
    w.columns.flatMap((column) =>
      cardsInColumn(w, column.id).map((c) =>
        terminalRow('card', w, c.id, c.title, c.worktree?.branch, input.status(c.id))
      )
    )
  )
}

function shellRows(input: PaletteInput, order: Workspace[]): TerminalRow[] {
  return order.flatMap((w) =>
    shellCards(w).map((s) => {
      const title = s.id === defaultShellId(w.id) ? DEFAULT_SHELL_TITLE : s.title
      return terminalRow('shell', w, s.id, title, undefined, input.status(s.id))
    })
  )
}

type KeymapAction = Exclude<
  PaletteAction['id'],
  | 'moveCard'
  | 'newCard'
  | 'newWorkspace'
  | 'theme'
  | 'appTheme'
  | 'switchWorkspace'
  | 'workspaceView'
>

/** A row for an action with a configurable shortcut, labelled as Settings labels it. */
function keymapRow(id: KeymapAction, keymap: Keymap): ActionRow {
  return { kind: 'action', action: { id }, label: SHORTCUT_LABELS[id], shortcut: keymap[id] }
}

function viewRows(input: PaletteInput, view: OpenView): ActionRow[] {
  const { keymap } = input
  const rows = [keymapRow('back', keymap)]
  if (view.running && view.paneCount < MAX_PANES) {
    rows.push(keymapRow('splitRight', keymap), keymapRow('splitDown', keymap))
  }
  if (view.extraPaneFocused) rows.push(keymapRow('closePane', keymap))
  if (view.running) rows.push(keymapRow('closeCard', keymap))
  rows.push(keymapRow('togglePanel', keymap))
  if (view.focusedPaneHasScreen) {
    rows.push(keymapRow('find', keymap), keymapRow('copyCommandOutput', keymap))
  }
  // Whenever the view has panes to zoom, or is zoomed (#48 D7).
  if (view.paneCount > 1 || view.zoomed) rows.push(keymapRow('zoomPane', keymap))
  // A card or shell open here goes to its own window (#53 D6).
  rows.push(keymapRow('openInWindow', keymap))
  if (view.kind !== 'card') return rows
  const workspace = input.state.workspaces.find((w) => w.id === view.workspaceId)
  const card = workspace?.cards.find((c) => c.id === view.cardId)
  // The grid view shows no columns, so it offers no moves between them.
  if (!workspace || !card || workspaceView(workspace) === 'grid') return rows
  for (const column of workspace.columns) {
    if (column.id === card.columnId) continue
    rows.push({
      kind: 'action',
      action: { id: 'moveCard', columnId: column.id },
      label: `Move card to ${column.name}`
    })
  }
  return rows
}

function actionRows(input: PaletteInput): ActionRow[] {
  const { state, keymap, view } = input
  const hasActive = state.workspaces.some((w) => w.id === state.activeId)
  // On the board the panel toggles too, as in a card (#57 D4).
  const rows = view ? viewRows(input, view) : hasActive ? [keymapRow('togglePanel', keymap)] : []
  if (hasActive) {
    rows.push({ kind: 'action', action: { id: 'newCard' }, label: 'New card' })
    rows.push(keymapRow('openShell', keymap))
  }
  // Only when the Next waiting card shortcut would open something (#41 D7).
  if (nextWaitingCard(input.waiting, view?.cardId ?? null, state.workspaces)) {
    rows.push(keymapRow('nextWaiting', keymap))
  }
  // The other view for the active workspace, as its Edit dialog's View sets it.
  const active = state.workspaces.find((w) => w.id === state.activeId)
  if (active) {
    const other: WorkspaceView = workspaceView(active) === 'grid' ? 'kanban' : 'grid'
    rows.push({
      kind: 'action',
      action: { id: 'workspaceView', view: other },
      label: other === 'grid' ? 'View: Grid' : 'View: Kanban'
    })
  }
  rows.push({ kind: 'action', action: { id: 'newWorkspace' }, label: 'New workspace' })
  rows.push(keymapRow('settings', keymap))
  for (const theme of THEME_ORDER) {
    if (theme === input.theme) continue
    rows.push({
      kind: 'action',
      action: { id: 'theme', theme },
      label: `Theme: ${THEME_LABELS[theme]}`
    })
  }
  // Every app theme but the current one, beside the Theme rows (#64 D9).
  for (const { id, name } of APP_THEMES) {
    if (id === input.appTheme) continue
    rows.push({
      kind: 'action',
      action: { id: 'appTheme', appTheme: id },
      label: `App theme: ${name}`
    })
  }
  const mod = input.platform === 'darwin' ? 'Cmd' : 'Ctrl'
  state.workspaces.forEach((w, index) => {
    if (w.id === state.activeId) return
    rows.push({
      kind: 'action',
      action: { id: 'switchWorkspace', workspaceId: w.id },
      label: `Switch to workspace ${w.name}`,
      ...(index < WORKSPACE_SHORTCUTS && { shortcut: `${mod}+${index + 1}` })
    })
  })
  return rows
}

/** Every row of the palette with an empty query, in D5's order. */
export function paletteItems(input: PaletteInput): PaletteItems {
  const order = workspaceOrder(input.state)
  return {
    cards: cardRows(input, order),
    shells: shellRows(input, order),
    actions: actionRows(input)
  }
}

/** A card or shell row's searchable text (D3): title, workspace, branch, status and activity. */
function searchableText(row: TerminalRow): string {
  return [row.title, row.workspaceName, row.branch, row.statusLabel, row.activityText]
    .filter((part) => part !== undefined)
    .join(' ')
}

function filterRows<T>(rows: T[], query: string, text: (row: T) => [string, string]): T[] {
  const scored: { row: T; score: number }[] = []
  for (const row of rows) {
    const [searchable, primary] = text(row)
    const score = matchScore(query, searchable, primary)
    if (score !== null) scored.push({ row, score })
  }
  // Array sort is stable: ties keep D5's order.
  return scored.sort((a, b) => b.score - a.score).map((s) => s.row)
}

/**
 * The rows matching `query` (D4): every row for a blank query, as given; else only matching rows,
 * each section sorted by score with ties in their given order. Sections keep D2's order.
 */
export function filterPalette(items: PaletteItems, query: string): PaletteItems {
  if (!query.trim()) return items
  const terminal = (row: TerminalRow): [string, string] => [searchableText(row), row.title]
  return {
    cards: filterRows(items.cards, query, terminal),
    shells: filterRows(items.shells, query, terminal),
    actions: filterRows(items.actions, query, (row) => [row.label, row.label])
  }
}
