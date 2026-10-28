import { Blocks, Pencil, SquareTerminal, Trash2 } from 'lucide-react'
import type { Workspace } from '../../core/workspace-store'
import { ICON, SMALL_ICON } from './icons'
import Tooltip from './Tooltip'

/**
 * The workspace's own buttons above its board (Kanban or Grid), left of the side panel: its Agent
 * setup page (#68 D2), Edit and Delete (which the sidebar doesn't show), and New terminal at the end.
 */
function WorkspaceToolbar({
  workspace,
  onAgentSetup,
  onEdit,
  onDelete,
  onNewShell
}: {
  workspace: Workspace
  onAgentSetup: () => void
  onEdit: () => void
  onDelete: () => void
  /** The New shell action (#66 D1), as its shortcut runs it. */
  onNewShell: () => void
}): React.JSX.Element {
  return (
    <div
      className="workspace-toolbar"
      role="toolbar"
      aria-label={`${workspace.name} actions`}
      data-testid="workspace-toolbar"
    >
      <Tooltip
        label="Agent setup"
        description="The skills, agents, hooks, MCP servers and settings Claude Code gets here"
        align="start"
      >
        <button
          type="button"
          className="btn btn-small workspace-toolbar-btn"
          data-testid="toolbar-agent-setup"
          onClick={onAgentSetup}
        >
          <Blocks {...SMALL_ICON} />
          Agent setup
        </button>
      </Tooltip>
      <Tooltip label="Edit workspace" description="Its name, folder, cards' agent and rules">
        <button
          type="button"
          className="btn btn-small workspace-toolbar-btn"
          data-testid="workspace-edit"
          aria-label={`Edit ${workspace.name}`}
          onClick={onEdit}
        >
          <Pencil {...SMALL_ICON} />
          Edit
        </button>
      </Tooltip>
      <Tooltip
        label="Delete workspace"
        description="Removes its board after you confirm; its folder stays as it is"
      >
        <button
          type="button"
          className="btn btn-small workspace-toolbar-btn workspace-toolbar-danger"
          data-testid="workspace-delete"
          aria-label={`Delete ${workspace.name}`}
          onClick={onDelete}
        >
          <Trash2 {...SMALL_ICON} />
          Delete
        </button>
      </Tooltip>
      <span className="workspace-toolbar-gap" />
      <Tooltip
        label="New terminal"
        description="Opens the workspace's Default shell, or a new shell while that one runs"
        shortcut="openShell"
        align="end"
      >
        <button
          type="button"
          className="icon-btn"
          data-testid="toolbar-new-shell"
          aria-label="New terminal"
          onClick={onNewShell}
        >
          <SquareTerminal {...ICON} />
        </button>
      </Tooltip>
    </div>
  )
}

export default WorkspaceToolbar
