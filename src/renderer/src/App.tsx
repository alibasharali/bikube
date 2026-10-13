import { useCallback, useState } from 'react'
import { runningCount, workspaceDeleteMessage } from '../../core/card-deletes'
import { removeWorkspace } from './card-actions'
import { cardTerminals } from './card-terminals'
import CardView from './CardView'
import ConfirmDialog from './ConfirmDialog'
import WorkspaceDialog from './WorkspaceDialog'
import Board from './Board'
import EmptyState from './EmptyState'
import Sidebar from './Sidebar'
import { useWorkspaceState, workspaceStore } from './store'

function App(): React.JSX.Element {
  const { workspaces, activeId } = useWorkspaceState()
  const [collapsed, setCollapsed] = useState(false)
  const active = workspaces.find((w) => w.id === activeId) ?? null
  // One card open at full size at a time, always one of the active workspace's (#4 D7).
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const openCard = active?.cards.find((c) => c.id === openCardId) ?? null
  const closeCard = useCallback(() => setOpenCardId(null), [setOpenCardId])
  const darwin = window.drovr?.platform === 'darwin'

  const [dialog, setDialog] = useState<
    { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string } | null
  >(null)
  const onCreateWorkspace = (): void => setDialog({ kind: 'create' })
  const target =
    dialog && dialog.kind !== 'create' ? workspaces.find((w) => w.id === dialog.id) : undefined

  return (
    <div className={darwin ? 'app app-darwin' : 'app'} data-testid="app">
      <Sidebar
        workspaces={workspaces}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onSelect={(id) => {
          // Selecting a workspace shows its board, leaving any open card (#4 D8).
          setOpenCardId(null)
          workspaceStore.selectWorkspace(id)
        }}
        onAdd={onCreateWorkspace}
        onEdit={(id) => setDialog({ kind: 'edit', id })}
        onDelete={(id) => setDialog({ kind: 'delete', id })}
      />
      <main className="main">
        {active && openCard ? (
          <CardView key={openCard.id} card={openCard} onBack={closeCard} />
        ) : active ? (
          <Board key={active.id} workspace={active} onOpenCard={setOpenCardId} />
        ) : (
          <EmptyState onCreateWorkspace={onCreateWorkspace} />
        )}
      </main>
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
        <ConfirmDialog
          title="Delete workspace"
          message={workspaceDeleteMessage(
            target.name,
            runningCount(target.cards, (id) => cardTerminals().runState(id))
          )}
          confirmLabel="Delete"
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

export default App
