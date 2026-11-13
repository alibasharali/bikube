import {
  Blocks,
  ChevronDown,
  MessageSquarePlus,
  Pencil,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import { hasOrchestrator } from '../../core/orchestrator'
import type { Workspace } from '../../core/workspace-store'
import { ToolIcon } from './AgentLogo'
import { ICON, SMALL_ICON } from './icons'
import MenuButton from './MenuButton'
import { useOrchestratorStartup } from './orchestrator'
import Tooltip from './Tooltip'

/**
 * The workspace's own buttons above its board (Kanban or Grid), left of the side panel: its
 * Orchestrator with its menu (#81 D5), its Agent setup page (#68 D2), Edit and Delete (which the
 * sidebar doesn't show), and New terminal at the end.
 */
function WorkspaceToolbar({
  workspace,
  onAgentSetup,
  onEdit,
  onDelete,
  onNewShell,
  onOrchestrator,
  onNewConversation
}: {
  workspace: Workspace
  onAgentSetup: () => void
  onEdit: () => void
  onDelete: () => void
  /** The New shell action (#66 D1), as its shortcut runs it. */
  onNewShell: () => void
  /** Open orchestrator (#81 D6), as its shortcut runs it. */
  onOrchestrator: () => void
  /** New conversation… (#81 D11): its question. */
  onNewConversation: () => void
}): React.JSX.Element {
  return (
    <div
      className="workspace-toolbar"
      role="toolbar"
      aria-label={`${workspace.name} actions`}
      data-testid="workspace-toolbar"
    >
      <OrchestratorButton
        workspace={workspace}
        onOpen={onOrchestrator}
        onNewConversation={onNewConversation}
      />
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
          <span className="workspace-toolbar-label">Agent setup</span>
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
          <span className="workspace-toolbar-label">Edit</span>
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
          <span className="workspace-toolbar-label">Delete</span>
        </button>
      </Tooltip>
      <span className="workspace-toolbar-gap" />
      <Tooltip
        label="New terminal"
        description="Opens a new terminal in the workspace"
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

/**
 * The Orchestrator button (#81 D5): opens the workspace's Orchestrator, with its agent's logo, and
 * a chevron menu holding New conversation…. An SSH workspace has none: the button shows disabled,
 * its tooltip saying why (D10), and no menu.
 */
function OrchestratorButton({
  workspace,
  onOpen,
  onNewConversation
}: {
  workspace: Workspace
  onOpen: () => void
  onNewConversation: () => void
}): React.JSX.Element {
  const local = hasOrchestrator(workspace)
  const startup = useOrchestratorStartup()
  return (
    <span
      className={
        local ? 'split-btn toolbar-split-btn' : 'split-btn split-btn-single toolbar-split-btn'
      }
    >
      <Tooltip
        label="Orchestrator"
        description={
          local
            ? "Opens the workspace's orchestrator agent"
            : 'The orchestrator needs a local workspace'
        }
        shortcut="openOrchestrator"
        align="start"
      >
        <button
          type="button"
          className="split-btn-main workspace-toolbar-btn"
          data-testid="toolbar-orchestrator"
          // Not `disabled`: its tooltip still shows on hover and focus (D10).
          aria-disabled={local ? undefined : true}
          onClick={() => {
            if (local) onOpen()
          }}
        >
          <ToolIcon tool={startup.kind} />
          <span className="workspace-toolbar-label">Orchestrator</span>
        </button>
      </Tooltip>
      {local && (
        <MenuButton
          className="split-btn-menu"
          buttonClassName="split-btn-toggle"
          icon={<ChevronDown size={12} aria-hidden="true" />}
          label="Orchestrator menu"
          menuLabel="Orchestrator"
          testId="toolbar-orchestrator-menu"
          fixed
          align="start"
        >
          {(run) => (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              data-testid="orchestrator-new-conversation"
              onClick={run(onNewConversation)}
            >
              <MessageSquarePlus {...SMALL_ICON} />
              New conversation…
            </button>
          )}
        </MenuButton>
      )}
    </span>
  )
}

export default WorkspaceToolbar
