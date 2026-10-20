import { waitingTooltip } from '../../core/waiting'
import type { Workspace } from '../../core/workspace-store'
import { workspaceInitial } from './workspace-initial'
import { LOGO_ICON, LOGO_ICONS } from './workspace-logo'

/**
 * The row's badge: its logo's icon (#59 D4), else the name's initial; in the collapsed sidebar,
 * with a dot counting its waiting cards and shells on the corner when any wait (#41 D6).
 */
function WorkspaceBadge({
  workspace,
  waiting
}: {
  workspace: Workspace
  waiting: number
}): React.JSX.Element {
  const Icon = workspace.logo && LOGO_ICONS[workspace.logo]
  return (
    <span
      className="workspace-badge"
      data-testid="workspace-badge"
      data-logo={Icon ? workspace.logo : undefined}
      aria-hidden="true"
    >
      {Icon ? <Icon {...LOGO_ICON} /> : workspaceInitial(workspace.name)}
      {waiting > 0 && (
        <span
          className="workspace-waiting-dot"
          data-testid="workspace-waiting-dot"
          title={waitingTooltip(waiting)}
        >
          {waiting}
        </span>
      )}
    </span>
  )
}

export default WorkspaceBadge
