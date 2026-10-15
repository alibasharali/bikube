import { useCallback, useEffect, useState } from 'react'
import { workspaceDeleteMessage } from '../../core/card-deletes'
import { keymapAction, workspaceShortcut } from '../../core/keymap'
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
import type { Workspace } from '../../core/workspace-store'
import { removeWorkspace, startCard } from './card-actions'
import { cardTerminals, useRunningCount } from './card-terminals'
import CardView from './CardView'
import ConfirmDialog from './ConfirmDialog'
import WorkspaceDialog from './WorkspaceDialog'
import Board from './Board'
import EmptyState from './EmptyState'
import SettingsDialog from './SettingsDialog'
import { currentKeymap } from './settings'
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
      const cardIds = active ? active.cards.map((c) => c.id) : null
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
  const openCard = openedId ? (active?.cards.find((c) => c.id === openedId) ?? null) : null
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (keymapAction(event, currentKeymap()) !== 'settings') return
      // Another dialog (or Settings itself) owns the keyboard: the shortcut does nothing.
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
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
      <TitleBar collapsed={collapsed} workspace={active} card={active ? openCard : null} />
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
      message={workspaceDeleteMessage(workspace.name, running)}
      confirmLabel="Delete"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

export default App
