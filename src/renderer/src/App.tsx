import { useCallback, useEffect, useState } from 'react'
import { workspaceDeleteMessage } from '../../core/card-deletes'
import { isSettingsShortcut } from '../../core/card-shortcuts'
import { syncStatusText } from '../../core/sync-status'
import type { Workspace } from '../../core/workspace-store'
import { removeWorkspace, startCard } from './card-actions'
import { useRunningCount } from './card-terminals'
import CardView from './CardView'
import ConfirmDialog from './ConfirmDialog'
import WorkspaceDialog from './WorkspaceDialog'
import Board from './Board'
import EmptyState from './EmptyState'
import SettingsDialog from './SettingsDialog'
import Sidebar from './Sidebar'
import { useWorkspaceState, workspaceStore } from './store'
import { useSyncStatus } from './sync'

function App(): React.JSX.Element {
  const { workspaces, activeId } = useWorkspaceState()
  const syncStatus = syncStatusText(useSyncStatus())
  const [collapsed, setCollapsed] = useState(false)
  const active = workspaces.find((w) => w.id === activeId) ?? null
  // One card open at full size at a time, always one of the active workspace's (#4 D7). It is
  // tied to the workspace it was opened in and dropped as soon as another one is active, however
  // the switch happened (sidebar, workspace created or deleted), so it never reopens later (D8).
  const [opened, setOpened] = useState<{ workspaceId: string; cardId: string } | null>(null)
  const openCard =
    opened?.workspaceId === activeId
      ? (active?.cards.find((c) => c.id === opened.cardId) ?? null)
      : null
  const closeCard = useCallback(() => setOpened(null), [setOpened])
  // Opening a card whose shell isn't running starts it first (#5 D7).
  const onOpenCard = useCallback(
    (cardId: string) => {
      if (!activeId) return
      startCard(activeId, cardId)
      setOpened({ workspaceId: activeId, cardId })
    },
    [activeId, setOpened]
  )
  if (opened && opened.workspaceId !== activeId) setOpened(null)
  const darwin = window.drovr?.platform === 'darwin'

  const [dialog, setDialog] = useState<
    { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string } | null
  >(null)
  const onCreateWorkspace = (): void => setDialog({ kind: 'create' })
  const target =
    dialog && dialog.kind !== 'create' ? workspaces.find((w) => w.id === dialog.id) : undefined

  // Settings (#10 D5): from the sidebar, or Cmd+, / Ctrl+, anywhere. Capture phase, so it works
  // wherever focus is, including a terminal (which swallows the key too).
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isSettingsShortcut(event, window.drovr.platform)) return
      // Another dialog (or Settings itself) owns the keyboard: the shortcut does nothing.
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <div className={darwin ? 'app app-darwin' : 'app'} data-testid="app">
      <Sidebar
        workspaces={workspaces}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onSelect={(id) => {
          // Selecting a workspace shows its board, leaving any open card (#4 D8).
          setOpened(null)
          workspaceStore.selectWorkspace(id)
        }}
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
