import { useRef } from 'react'
import { MIN_SIDE_PANEL_WIDTH } from '../../core/settings'
import {
  draggedPanelWidth,
  PANEL_BODY_ID,
  PANEL_KEY_STEP,
  panelTabId,
  shownPanelWidth
} from '../../core/side-panel'
import type { Card } from '../../core/workspace-store'
import FilesTab from './FilesTab'
import { PanelTabs, PanelToggle } from './PanelTabs'
import { setPanelDragWidth, usePanelWidth, useWindowWidth } from './panel-width'
import { settingsStore, useSettings } from './settings'
import ShellsTab from './ShellsTab'
import { useWorkspaceState } from './store'
import { useViewWindow } from './view-window'

/**
 * The side panel at the right of an open card or shell (#55 D1), or of the board (#57 D1), from the
 * top of the window down: the selected tab's body and a left edge that resizes it (D4). Its tabs
 * and its show/hide button are in the title bar above it (`TitleBar`); a card window, which has
 * none, shows them in the panel's own header (`header`). Its width is the saved one kept between
 * 200 px and half the window; a drag shows each move, in the title bar too, and saves when it ends.
 */
function SidePanel({
  folder,
  ssh,
  workspaceId,
  openCard,
  onOpenShell,
  header = false,
  onHide
}: {
  /** The folder the Files tab shows (D5). */
  folder: string
  /** The card runs over SSH: the Files tab lists nothing (D6). */
  ssh: boolean
  /** The workspace whose shells the Shells tab lists. */
  workspaceId: string
  /** The card or shell open beside the panel: a worktree card offers its shells Run in this worktree. */
  openCard?: Card
  /** Opens a shell from the Shells tab. */
  onOpenShell: (shellId: string) => void
  /** Shows the tabs and the show/hide button in the panel (a card window, with no title bar). */
  header?: boolean
  /** Hides the panel from its own header's button. */
  onHide?: () => void
}): React.JSX.Element {
  const { sidePanelTab: tab } = useSettings()
  const workspace = useWorkspaceState().workspaces.find((w) => w.id === workspaceId)
  // The window the panel is in: the main window, or a card's own (#53 D4, D5).
  const view = useViewWindow()
  const windowWidth = useWindowWidth(view)
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null)
  const width = usePanelWidth(view)

  const save = (next: number): void => {
    settingsStore.update({ sidePanelWidth: next })
  }

  return (
    <aside
      className="side-panel"
      data-testid="side-panel"
      aria-label="Side panel"
      style={{ width }}
    >
      <div
        className="side-panel-resize"
        data-testid="side-panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={MIN_SIDE_PANEL_WIDTH}
        aria-valuemax={shownPanelWidth(Infinity, windowWidth)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { startX: event.clientX, startWidth: width, last: width }
          setPanelDragWidth(width)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start) return
          start.last = draggedPanelWidth(
            start.startWidth,
            start.startX - event.clientX,
            view.innerWidth
          )
          setPanelDragWidth(start.last)
        }}
        onPointerUp={(event) => {
          const start = drag.current
          if (!start) return
          drag.current = null
          const next = draggedPanelWidth(
            start.startWidth,
            start.startX - event.clientX,
            view.innerWidth
          )
          save(next)
          setPanelDragWidth(null)
        }}
        onLostPointerCapture={() => {
          // A drag cut short (e.g. the window lost the pointer) keeps the width it reached.
          if (drag.current) save(drag.current.last)
          drag.current = null
          setPanelDragWidth(null)
        }}
        onKeyDown={(event) => {
          const step =
            event.key === 'ArrowLeft'
              ? PANEL_KEY_STEP
              : event.key === 'ArrowRight'
                ? -PANEL_KEY_STEP
                : 0
          if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return
          event.preventDefault()
          save(draggedPanelWidth(width, step, view.innerWidth))
        }}
      />
      {header && (
        <div className="side-panel-header">
          <PanelTabs workspace={workspace} />
          <PanelToggle testId="side-panel-hide" onToggle={onHide} />
        </div>
      )}
      <div
        className="side-panel-body"
        role="tabpanel"
        id={PANEL_BODY_ID}
        aria-labelledby={panelTabId(tab)}
      >
        {tab === 'files' && (
          <FilesTab
            folder={folder}
            ssh={ssh}
            onOpenFile={(path) => window.bikube.files.open(folder, path)}
          />
        )}
        {tab === 'shells' && workspace && (
          <ShellsTab
            workspace={workspace}
            worktreeCard={openCard?.worktree ? openCard : undefined}
            onOpen={onOpenShell}
          />
        )}
      </div>
    </aside>
  )
}

export default SidePanel
