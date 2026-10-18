import { useCallback, useEffect, useRef, useState } from 'react'
import { workspaceDeleteMessage } from '../../core/card-deletes'
import { keymapAction, workspaceShortcut } from '../../core/keymap'
import type { PaletteAction } from '../../core/palette'
import { syncStatusText } from '../../core/sync-status'
import {
  enterWorkspace,
  forgetView,
  NO_VIEWS,
  openedCard,
  rememberCard,
  selectWorkspace,
  type ViewMemory
} from '../../core/view-memory'
import { onOpenRequest, setLookingAt } from './attention'
import { removeWorkspace, startCard } from './card-actions'
import { findShellCard, shellCards } from '../../core/workspace-shells'
import { defaultShellId, type Workspace } from '../../core/workspace-store'
import { cardTerminals, useRunningCount } from './card-terminals'
import { isCardViewAction, runCardViewAction } from './card-view-actions'
import CardView from './CardView'
import CommandPalette from './CommandPalette'
import ConfirmDialog from './ConfirmDialog'
import WorkspaceDialog from './WorkspaceDialog'
import Board from './Board'
import EmptyState from './EmptyState'
import SettingsDialog from './SettingsDialog'
import { requestNewCard } from './new-card-request'
import { currentKeymap, settingsStore } from './settings'
import Sidebar from './Sidebar'
import TitleBar from './TitleBar'
import { useWorkspaceState, workspaceStore } from './store'
import { useSyncStatus } from './sync'

function App(): React.JSX.Element {
  const { workspaces, activeId } = useWorkspaceState()
  const syncStatus = syncStatusText(useSyncStatus())
  const [collapsed, setCollapsed] = useState(false)
  const active = workspaces.find((w) => w.id === activeId) ?? null
  // One card open at full size at a time, always one of the active workspace's (#4 D7). Each
  // workspace remembers its view for this run (#31 D19): the card open in it, or its board.
  const [views, setViews] = useState<ViewMemory>(NO_VIEWS)
  // However the active workspace changed (sidebar, Mod+digit, a workspace created or deleted),
  // it comes back to its card only while that card exists and runs (D19).
  const [entered, setEntered] = useState(activeId)
  if (entered !== activeId) {
    setEntered(activeId)
    if (activeId) {
      const cardIds = active
        ? [...active.cards.map((c) => c.id), ...shellCards(active).map((s) => s.id)]
        : null
      setViews((v) =>
        enterWorkspace(
          v,
          activeId,
          cardIds,
          (id) => cardTerminals().runState(id)?.kind === 'running'
        )
      )
    }
  }
  const openedId = activeId ? openedCard(views, activeId) : null
  // The open terminal: one of the board's cards, or one of the workspace's shells.
  const openCard = openedId
    ? (active?.cards.find((c) => c.id === openedId) ??
      (active && findShellCard(active, openedId)) ??
      null)
    : null
  const openIsShell = openCard !== null && !active?.cards.some((c) => c.id === openCard.id)
  // Back, or the open card's shell stopping: the active workspace forgets its card (D19).
  const closeCard = useCallback(() => {
    if (activeId) setViews((v) => forgetView(v, activeId))
  }, [activeId, setViews])
  // Opening a card whose shell isn't running starts it first (#5 D7).
  const onOpenCard = useCallback(
    (cardId: string) => {
      if (!activeId) return
      startCard(activeId, cardId)
      setViews((v) => rememberCard(v, activeId, cardId))
    },
    [activeId, setViews]
  )
  // Selecting a workspace (sidebar or Mod+digit, #31 D18) shows the view it was left in; the
  // active one goes to its board (D19).
  const onSelectWorkspace = useCallback(
    (id: string) => {
      setViews((v) => selectWorkspace(v, activeId, id))
      workspaceStore.selectWorkspace(id)
    },
    [activeId, setViews]
  )

  // Notifications skip the card in view, and a clicked one opens its card in its workspace.
  useEffect(() => setLookingAt(openedId), [openedId])
  useEffect(
    () =>
      onOpenRequest((workspaceId, cardId) => {
        setViews((v) => rememberCard(v, workspaceId, cardId))
        if (workspaceId !== activeId) workspaceStore.selectWorkspace(workspaceId)
      }),
    [activeId, setViews]
  )

  // The Default shell's shortcut opens the active workspace's, starting it when stopped.
  const openDefaultShell = useRef(() => {})
  useEffect(() => {
    openDefaultShell.current = () => {
      if (activeId) onOpenCard(defaultShellId(activeId))
    }
  })

  // A workspace's autostart shells start the first time it is opened in this run of the app.
  const autostarted = useRef(new Set<string>())
  useEffect(() => {
    if (!active || autostarted.current.has(active.id)) return
    autostarted.current.add(active.id)
    for (const shell of active.shells) {
      if (shell.autostart && cardTerminals().runState(shell.id)?.kind !== 'running') {
        startCard(active.id, shell.id)
      }
    }
  }, [active])

  // On macOS the title bar leaves room for the window buttons (main hides the native one).
  const darwin = window.drovr?.platform === 'darwin'

  const [dialog, setDialog] = useState<
    { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string } | null
  >(null)
  const onCreateWorkspace = (): void => setDialog({ kind: 'create' })
  const target =
    dialog && dialog.kind !== 'create' ? workspaces.find((w) => w.id === dialog.id) : undefined

  // Settings (#10 D5): from the sidebar, or its shortcut (#31 D5) anywhere. Capture phase, so it
  // works wherever focus is, including a terminal (which swallows the key too).
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The command palette (#40 D1): its shortcut opens it anywhere no other dialog is open, and
  // closes it when it is.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const paletteShown = useRef(false)
  useEffect(() => {
    paletteShown.current = paletteOpen
  }, [paletteOpen])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const action = keymapAction(event, currentKeymap())
      if (action === 'palette') {
        // Another dialog owns the keyboard (Settings may be recording this very press).
        if (!paletteShown.current && document.querySelector('[aria-modal="true"]')) return
        event.preventDefault()
        event.stopPropagation()
        // A held shortcut's auto-repeat does nothing more (#31 D7).
        if (event.repeat) return
        paletteShown.current = !paletteShown.current
        setPaletteOpen(paletteShown.current)
        return
      }
      if (action !== 'settings' && action !== 'openShell') return
      // Another dialog (or Settings itself) owns the keyboard: the shortcut does nothing.
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      if (action === 'settings') setSettingsOpen(true)
      else openDefaultShell.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // A card or shell picked in the palette opens at full size in its workspace, started first when
  // it isn't running, as a click on it does; one in another workspace makes that workspace active,
  // as a clicked notification does (#40 D7). The card already open just stays.
  const onPaletteOpen = useCallback(
    (workspaceId: string, cardId: string) => {
      if (workspaceId === activeId && cardId === openedId) return
      startCard(workspaceId, cardId)
      setViews((v) => rememberCard(v, workspaceId, cardId))
      if (workspaceId !== activeId) workspaceStore.selectWorkspace(workspaceId)
    },
    [activeId, openedId, setViews]
  )

  // An action picked in the palette (#40 D6) does what its shortcut, button or menu item does. It
  // runs once the palette has closed and given focus back (D8), so a card view action acts in the
  // view as its shortcut would, and a dialog or form it opens keeps the focus.
  const runAction = useRef<(action: PaletteAction) => void>(() => {})
  useEffect(() => {
    runAction.current = (action) => {
      if (isCardViewAction(action.id)) runCardViewAction(action.id)
      // To the column's bottom, as the card menu's move (#6 D8); the card stays open.
      else if (action.id === 'moveCard') {
        if (activeId && openCard && !openIsShell) {
          workspaceStore.moveCard(activeId, openCard.id, action.columnId, Number.POSITIVE_INFINITY)
        }
      }
      // The active workspace's board, its first column's New card form open (D9).
      else if (action.id === 'newCard') {
        if (!activeId) return
        closeCard()
        requestNewCard(activeId)
      } else if (action.id === 'openShell') openDefaultShell.current()
      else if (action.id === 'newWorkspace') setDialog({ kind: 'create' })
      else if (action.id === 'settings') setSettingsOpen(true)
      else if (action.id === 'theme') settingsStore.update({ theme: action.theme })
      else if (action.id === 'switchWorkspace') onSelectWorkspace(action.workspaceId)
    }
  })
  const pendingAction = useRef<PaletteAction | null>(null)
  useEffect(() => {
    const action = pendingAction.current
    if (paletteOpen || !action) return
    pendingAction.current = null
    runAction.current(action)
  }, [paletteOpen])
  const onRunAction = useCallback((action: PaletteAction) => {
    pendingAction.current = action
    setPaletteOpen(false)
  }, [])

  // Mod+1…9 select the 1st…9th workspace in sidebar order (#31 D18), anywhere no dialog owns the
  // keyboard, swallowed whole even with no workspace at that number; once per press (D7).
  const workspaceIds = workspaces.map((w) => w.id).join('\n')
  useEffect(() => {
    const ids = workspaceIds.split('\n')
    const onKey = (event: KeyboardEvent): void => {
      const number = workspaceShortcut(event, window.drovr?.platform ?? '')
      if (number === null) return
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type !== 'keydown' || event.repeat) return
      const id = ids[number - 1]
      if (id) onSelectWorkspace(id)
    }
    const types = ['keydown', 'keypress', 'keyup'] as const
    for (const type of types) window.addEventListener(type, onKey, true)
    return () => {
      for (const type of types) window.removeEventListener(type, onKey, true)
    }
  }, [workspaceIds, onSelectWorkspace])

  return (
    <div className={darwin ? 'app app-darwin' : 'app'} data-testid="app">
      <TitleBar
        collapsed={collapsed}
        workspace={active}
        card={active ? openCard : null}
        isShell={openIsShell}
        onBack={closeCard}
      />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          activeId={activeId}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          onSelect={onSelectWorkspace}
          onAdd={onCreateWorkspace}
          onEdit={(id) => setDialog({ kind: 'edit', id })}
          onDelete={(id) => setDialog({ kind: 'delete', id })}
          onSettings={() => setSettingsOpen(true)}
          syncStatus={syncStatus}
        />
        <main className="main">
          {active && openCard ? (
            <CardView key={openCard.id} card={openCard} onBack={closeCard} />
          ) : active ? (
            <Board key={active.id} workspace={active} onOpenCard={onOpenCard} />
          ) : (
            <EmptyState onCreateWorkspace={onCreateWorkspace} />
          )}
        </main>
      </div>
      {paletteOpen && (
        <CommandPalette
          open={
            active && openCard
              ? {
                  kind: openIsShell ? 'shell' : 'card',
                  workspaceId: active.id,
                  cardId: openCard.id
                }
              : null
          }
          onClose={() => setPaletteOpen(false)}
          onOpenTerminal={(row) => onPaletteOpen(row.workspaceId, row.cardId)}
          onRunAction={onRunAction}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {dialog?.kind === 'create' && (
        <WorkspaceDialog workspace={null} workspaces={workspaces} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'edit' && target && (
        <WorkspaceDialog
          workspace={target}
          workspaces={workspaces}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && target && (
        <DeleteWorkspaceDialog
          workspace={target}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            removeWorkspace(target)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

/** The workspace delete confirmation; its running count follows cards that exit meanwhile (D15). */
function DeleteWorkspaceDialog({
  workspace,
  onConfirm,
  onCancel
}: {
  workspace: Workspace
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const running = useRunningCount(workspace.cards)
  return (
    <ConfirmDialog
      title="Delete workspace"
      message={workspaceDeleteMessage(
        workspace.name,
        running,
        workspace.cards.filter((c) => c.worktree).length
      )}
      confirmLabel="Delete"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

export default App
