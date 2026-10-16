import {
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Server,
  Settings,
  Trash2
} from 'lucide-react'
import type { Workspace } from '../../core/workspace-store'
import { useBranch } from './branches'
import { ICON, SMALL_ICON } from './icons'
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
  /** The sync status line (#13 D13), or null when sync is off. */
  syncStatus: string | null
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
  onSettings,
  syncStatus
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
          {collapsed ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
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
          <Plus {...ICON} />
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
                {!collapsed && <WorkspaceName workspace={w} />}
                {!collapsed && w.host !== undefined && (
                  <Server className="workspace-ssh" {...SMALL_ICON} />
                )}
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
                    <Pencil {...SMALL_ICON} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    data-testid="workspace-delete"
                    aria-label={`Delete ${w.name}`}
                    title="Delete workspace"
                    onClick={() => onDelete(w.id)}
                  >
                    <Trash2 {...SMALL_ICON} />
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="sidebar-footer">
        {!collapsed && syncStatus !== null && (
          <p className="sidebar-sync" data-testid="sync-status">
            {syncStatus}
          </p>
        )}
        <button
          type="button"
          className="sidebar-settings"
          data-testid="settings-open"
          aria-label={collapsed ? 'Settings' : undefined}
          title={collapsed ? 'Settings' : undefined}
          onClick={onSettings}
        >
          <Settings className="sidebar-settings-icon" {...ICON} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </nav>
  )
}

/** A workspace's name, and under it the branch its folder is on (local git repositories only). */
function WorkspaceName({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const branch = useBranch(workspace.host === undefined ? workspace.directory : null)
  return (
    <span className="workspace-text">
      <span className="workspace-name">{workspace.name}</span>
      {branch && (
        <span className="workspace-branch" data-testid="workspace-branch">
          <GitBranch {...SMALL_ICON} />
          <span>{branch}</span>
        </span>
      )}
    </span>
  )
}

export default Sidebar
