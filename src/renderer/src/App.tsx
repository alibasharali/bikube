import { useState } from 'react'
import BoardPlaceholder from './BoardPlaceholder'
import EmptyState from './EmptyState'
import Sidebar from './Sidebar'
import { useWorkspaceState, workspaceStore } from './store'

function App(): React.JSX.Element {
  const { workspaces, activeId } = useWorkspaceState()
  const [collapsed, setCollapsed] = useState(false)
  const active = workspaces.find((w) => w.id === activeId) ?? null
  const darwin = window.drovr?.platform === 'darwin'

  // S4 replaces this with opening the create-workspace dialog.
  const onCreateWorkspace = (): void => {}

  return (
    <div className={darwin ? 'app app-darwin' : 'app'} data-testid="app">
      <Sidebar
        workspaces={workspaces}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onSelect={(id) => workspaceStore.selectWorkspace(id)}
        onAdd={onCreateWorkspace}
      />
      <main className="main">
        {active ? (
          <BoardPlaceholder key={active.id} workspace={active} />
        ) : (
          <EmptyState onCreateWorkspace={onCreateWorkspace} />
        )}
      </main>
    </div>
  )
}

export default App
