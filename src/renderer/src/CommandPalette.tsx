import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { knownStatus, type CardRunState } from '../../core/card-status'
import {
  filterPalette,
  paletteItems,
  type ActionRow,
  type OpenView,
  type PaletteAction,
  type PaletteItems,
  type PaletteRow,
  type RowStatus,
  type TerminalRow
} from '../../core/palette'
import { MAIN_PANE, paneIds, type PaneLayout } from '../../core/split-tree'
import { shellCards } from '../../core/workspace-shells'
import type { WorkspaceState } from '../../core/workspace-store'
import { useWaitingQueue } from './attention'
import {
  cardPanes,
  cardTerminals,
  useCardRunState,
  usePaneLayout,
  type XtermScreen
} from './card-terminals'
import Modal from './Modal'
import ShortcutKeys from './ShortcutKeys'
import { currentKeymap, useSettings } from './settings'
import { useWorkspaceState } from './store'

/** The card or shell open at full size, as App knows it. */
export interface OpenTerminal {
  kind: OpenView['kind']
  workspaceId: string
  cardId: string
}

interface CommandPaletteProps {
  /** The card or shell open at full size, or null on the board. */
  open: OpenTerminal | null
  /** Whether the active workspace shows its Agent setup page (#68 D2). */
  agentSetup?: boolean
  onClose: () => void
  /** Opens a card or shell row (D7); the palette is closed first. */
  onOpenTerminal: (row: TerminalRow) => void
  /** Runs an action row (D6); the palette is closed first. */
  onRunAction: (action: PaletteAction) => void
}

/** The sections shown, in D2's order, each with its heading. */
const SECTIONS: { key: keyof PaletteItems; title: string }[] = [
  { key: 'cards', title: 'Cards' },
  { key: 'shells', title: 'Shells' },
  { key: 'actions', title: 'Actions' }
]

const rowKey = (row: PaletteRow): string =>
  row.kind === 'action' ? `action:${JSON.stringify(row.action)}` : `${row.kind}:${row.cardId}`

/** Every card's and shell's id in `state`. */
function terminalIds(state: WorkspaceState): string[] {
  return state.workspaces.flatMap((w) => [
    ...w.cards.map((c) => c.id),
    ...shellCards(w).map((s) => s.id)
  ])
}

function rowStatus(cardId: string): RowStatus {
  const { label, activity } = knownStatus(cardTerminals().status(cardId))
  return activity ? { label, activity } : { label }
}

/**
 * Every listed card's and shell's status label and activity, as one string that changes only
 * when one of them does, so the rows follow live changes (D3) without re-rendering on output.
 */
function useStatusKey(ids: string[]): string {
  const joined = ids.join('\n')
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = joined
        .split('\n')
        .filter(Boolean)
        .map((id) => cardTerminals().subscribe(id, listener))
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    },
    [joined]
  )
  return useSyncExternalStore(subscribe, () =>
    joined
      .split('\n')
      .map((id) => {
        const { label, activity } = rowStatus(id)
        return `${label}\t${activity ?? ''}`
      })
      .join('\n')
  )
}

/** A pane's screen, as CardView reads it: the card's own terminal for the main pane. */
function paneScreen(cardId: string, paneId: string): XtermScreen | undefined {
  return paneId === MAIN_PANE ? cardTerminals().screen(cardId) : cardPanes().screen(cardId, paneId)
}

/** The open view as the palette's rows read it, from its live run state and panes. */
function openView(
  open: OpenTerminal | null,
  runState: CardRunState,
  layout: PaneLayout
): OpenView | null {
  if (!open) return null
  return {
    ...open,
    running: runState.kind === 'running',
    paneCount: paneIds(layout.tree).length,
    extraPaneFocused: layout.focused !== MAIN_PANE,
    focusedPaneHasScreen: paneScreen(open.cardId, layout.focused) !== undefined,
    zoomed: layout.zoomed === true
  }
}

/** The command palette (#40 D2): a search field over the Cards, Shells and Actions sections. */
function CommandPalette({
  open,
  agentSetup = false,
  onClose,
  onOpenTerminal,
  onRunAction
}: CommandPaletteProps): React.JSX.Element {
  const state = useWorkspaceState()
  // The open view's actions follow its panes and whether it runs (D6).
  const runState = useCardRunState(open?.cardId ?? '')
  const layout = usePaneLayout(open?.cardId ?? '')
  const { theme, appTheme, defaultView } = useSettings()
  const [query, setQuery] = useState('')
  const listId = useId()
  const ids = terminalIds(state)
  const statusKey = useStatusKey(ids)
  // Next waiting card follows the queue live (#41 D7).
  const waiting = useWaitingQueue()

  const items = useMemo(
    () =>
      filterPalette(
        paletteItems({
          state,
          status: rowStatus,
          view: openView(open, runState, layout),
          agentSetup,
          theme,
          appTheme,
          defaultView,
          keymap: currentKeymap(),
          platform: window.bikube?.platform ?? '',
          waiting
        }),
        query
      ),
    // statusKey: the rows re-read every status when one changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state,
      open,
      agentSetup,
      runState,
      layout,
      theme,
      appTheme,
      defaultView,
      query,
      statusKey,
      waiting
    ]
  )
  const sections = SECTIONS.map(({ key, title }) => ({
    key,
    title,
    rows: items[key] as readonly PaletteRow[]
  })).filter((s) => s.rows.length > 0)
  const rows: PaletteRow[] = sections.flatMap((s) => s.rows)

  // The first row is selected whenever the list changes (D8).
  const listKey = rows.map(rowKey).join('\n')
  const [selected, setSelected] = useState(0)
  const [shownKey, setShownKey] = useState(listKey)
  if (shownKey !== listKey) {
    setShownKey(listKey)
    setSelected(0)
  }
  const select = setSelected

  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, listKey])

  // Running a row closes the palette first (D8).
  const run = (row: PaletteRow | undefined): void => {
    if (!row) return
    onClose()
    if (row.kind === 'action') onRunAction(row.action)
    else onOpenTerminal(row)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      select((selected + step + rows.length) % rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(rows[selected])
    }
  }

  const optionId = (index: number): string => `${listId}-${index}`
  let index = 0
  return (
    <Modal
      title="Command palette"
      hideTitle
      onClose={onClose}
      testId="command-palette"
      initialFocus="[data-testid=palette-input]"
      closeOnOutsideClick
      className="modal-palette"
      backdropClassName="modal-backdrop-top"
    >
      <input
        className="palette-input"
        data-testid="palette-input"
        type="text"
        role="combobox"
        aria-label="Search"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={rows.length > 0 ? optionId(selected) : undefined}
        aria-autocomplete="list"
        placeholder="Search cards, shells and actions"
        spellCheck={false}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div
        ref={listRef}
        id={listId}
        className="palette-list"
        role="listbox"
        aria-label="Results"
        data-testid="palette-list"
      >
        {rows.length === 0 && (
          <p className="palette-empty" data-testid="palette-empty">
            No matches
          </p>
        )}
        {sections.map((section) => (
          <div
            key={section.key}
            role="group"
            aria-label={section.title}
            className="palette-section"
            data-testid="palette-section"
            data-section={section.key}
          >
            <div className="palette-section-title" aria-hidden="true">
              {section.title}
            </div>
            {section.rows.map((row) => {
              const at = index++
              return (
                <div
                  key={rowKey(row)}
                  id={optionId(at)}
                  role="option"
                  aria-selected={at === selected}
                  className={
                    row.kind === 'action' ? 'palette-row palette-row-action' : 'palette-row'
                  }
                  data-testid="palette-row"
                  // Keeps the search field focused, so the keyboard stays in the palette.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => {
                    if (at !== selected) select(at)
                  }}
                  onClick={() => run(row)}
                >
                  {row.kind === 'action' ? (
                    <ActionRowContent row={row} />
                  ) : (
                    <TerminalRowContent row={row} />
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** A card or shell row (D3): its title, then workspace · branch · status (· activity). */
function TerminalRowContent({ row }: { row: TerminalRow }): React.JSX.Element {
  const meta = [row.workspaceName, row.branch, row.statusLabel, row.activityText].filter(
    (part): part is string => part !== undefined
  )
  return (
    <>
      <span className="palette-row-title" data-testid="palette-row-title">
        {row.title}
      </span>
      <span className="palette-row-meta" data-testid="palette-row-meta">
        {meta.join(' · ')}
      </span>
    </>
  )
}

/** An action row (D6): its label, and its shortcut on the right when it has one. */
function ActionRowContent({ row }: { row: ActionRow }): React.JSX.Element {
  return (
    <>
      <span className="palette-row-title" data-testid="palette-row-title">
        {row.label}
      </span>
      {row.shortcut && (
        <span className="palette-row-shortcut" data-testid="palette-row-shortcut">
          <ShortcutKeys shortcut={row.shortcut} platform={window.bikube?.platform ?? ''} />
        </span>
      )}
    </>
  )
}

export default CommandPalette
