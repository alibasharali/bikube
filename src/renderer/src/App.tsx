import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import WorkspaceDialog from './WorkspaceDialog'
import BoardPlaceholder from './BoardPlaceholder'
import EmptyState from './EmptyState'
import Sidebar from './Sidebar'
import { useWorkspaceState, workspaceStore } from './store'

function App(): React.JSX.Element {
  const { workspaces, activeId } = useWorkspaceState()
  const [collapsed, setCollapsed] = useState(false)
  const active = workspaces.find((w) => w.id === activeId) ?? null
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
        onSelect={(id) => workspaceStore.selectWorkspace(id)}
        onAdd={onCreateWorkspace}
        onEdit={(id) => setDialog({ kind: 'edit', id })}
        onDelete={(id) => setDialog({ kind: 'delete', id })}
      />
      <main className="main">
        {active ? (
          <BoardPlaceholder key={active.id} workspace={active} />
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
          message={`Delete "${target.name}"? This removes its board.`}
          confirmLabel="Delete"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            workspaceStore.deleteWorkspace(target.id)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

export default App
