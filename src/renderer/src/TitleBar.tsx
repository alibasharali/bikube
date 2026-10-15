import { ChevronRight } from 'lucide-react'
import { useEffect } from 'react'
import { windowTitle } from '../../core/window-title'
import type { Card, Workspace } from '../../core/workspace-store'
import { StartupTag } from './CardItem'
import { ICON } from './icons'

/**
 * The app's own title bar, above the sidebar and the main area: it drags the window, leaves room
 * for the macOS window buttons over the sidebar, and names where the user is (the workspace, and
 * the open card with its startup tag). With a card open, the workspace name goes back to its board.
 * The window title follows it.
 */
function TitleBar({
  collapsed,
  workspace,
  card,
  onBack
}: {
  collapsed: boolean
  /** Back to the workspace's board, as the Back shortcut does. */
  onBack: () => void
  workspace: Workspace | null | undefined
  card: Card | null
}): React.JSX.Element {
  const title = windowTitle(workspace, card)
  useEffect(() => {
    document.title = title
  }, [title])

  return (
    <header className="titlebar" data-testid="titlebar">
      <div className={collapsed ? 'titlebar-side titlebar-side-collapsed' : 'titlebar-side'} />
      <div className="titlebar-main" data-testid="titlebar-title">
        {workspace ? (
          <>
            {card ? (
              <button
                type="button"
                className="titlebar-workspace"
                data-testid="titlebar-workspace"
                title={`Back to ${workspace.name}`}
                onClick={onBack}
              >
                {workspace.name}
              </button>
            ) : (
              <span className="titlebar-current">{workspace.name}</span>
            )}
            {card && (
              <>
                <ChevronRight {...ICON} className="titlebar-separator" />
                <span className="titlebar-current" data-testid="titlebar-card">
                  {card.title}
                </span>
                <StartupTag startup={card.startup} />
              </>
            )}
          </>
        ) : (
          <span className="titlebar-current">Drovr</span>
        )}
      </div>
    </header>
  )
}

export default TitleBar
