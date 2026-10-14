import type { Workspace } from '../../core/workspace-store'
import { workspaceInitial } from './workspace-initial'

interface SidebarProps {
  workspaces: Workspace[]
  activeId: string | null
  collapsed: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  /** Opens the Settings dialog (#10 D5). */
  onSettings: () => void
}

function Sidebar({
  workspaces,
  activeId,
  collapsed,
  onToggle,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  onSettings
}: SidebarProps): React.JSX.Element {
  return (
    <nav
      className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'}
      data-testid="sidebar"
      data-collapsed={collapsed}
      aria-label="Workspaces"
    >
      <div className="sidebar-header">
        <button
          type="button"
          className="icon-btn"
          data-testid="sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? '»' : '«'}
        </button>
        {!collapsed && <span className="sidebar-title">Workspaces</span>}
        <button
          type="button"
          className="icon-btn"
          data-testid="workspace-add"
          aria-label="Create workspace"
          title="Create workspace"
          onClick={onAdd}
        >
          +
        </button>
      </div>
      <ul className="workspace-list">
        {workspaces.map((w) => {
          const active = w.id === activeId
          return (
            <li key={w.id} className="workspace-row">
              <button
                type="button"
                className={active ? 'workspace-item active' : 'workspace-item'}
                data-testid="workspace-item"
                aria-current={active ? 'true' : undefined}
                aria-label={collapsed ? w.name : undefined}
                title={
                  collapsed
                    ? w.name
                    : w.host === undefined
                      ? w.directory
                      : `${w.host}:${w.directory}`
                }
                onClick={() => onSelect(w.id)}
              >
                <span className="workspace-badge" aria-hidden="true">
                  {workspaceInitial(w.name)}
                </span>
                {!collapsed && <span className="workspace-name">{w.name}</span>}
              </button>
              {!collapsed && (
                <span className="workspace-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    data-testid="workspace-edit"
                    aria-label={`Edit ${w.name}`}
                    title="Edit workspace"
                    onClick={() => onEdit(w.id)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    data-testid="workspace-delete"
                    aria-label={`Delete ${w.name}`}
                    title="Delete workspace"
                    onClick={() => onDelete(w.id)}
                  >
                    ×
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-settings"
          data-testid="settings-open"
          aria-label={collapsed ? 'Settings' : undefined}
          title={collapsed ? 'Settings' : undefined}
          onClick={onSettings}
        >
          <span className="sidebar-settings-icon" aria-hidden="true">
            ⚙
          </span>
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </nav>
  )
}

export default Sidebar
