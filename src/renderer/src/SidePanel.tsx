import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { MIN_SIDE_PANEL_WIDTH, type SidePanelTab } from '../../core/settings'
import { draggedPanelWidth, PANEL_KEY_STEP, shownPanelWidth } from '../../core/side-panel'
import { shellCards } from '../../core/workspace-shells'
import type { Card, Workspace } from '../../core/workspace-store'
import { useRunningCount } from './card-terminals'
import FilesTab from './FilesTab'
import { SMALL_ICON } from './icons'
import { settingsStore, useSettings } from './settings'
import ShellsTab from './ShellsTab'
import { useWorkspaceState } from './store'
import { useViewWindow } from './view-window'

/** The panel's tabs (#55 D1), in strip order. */
const PANEL_TABS: readonly { id: SidePanelTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'shells', label: 'Shells' }
]

/** `view`'s inner width, followed as it resizes. */
function useWindowWidth(view: Window): number {
  const [width, setWidth] = useState(() => view.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(view.innerWidth)
    view.addEventListener('resize', onResize)
    return () => view.removeEventListener('resize', onResize)
  }, [view])
  return width
}

/**
 * The side panel at the right of an open card or shell (#55 D1), or of the board (#57 D1): a tab
 * strip with a hide button, the selected tab's body, and a left edge that resizes it (D4). Its
 * width is the saved one kept between 200 px and half the window; a drag shows each move and saves
 * when it ends.
 */
function SidePanel({
  folder,
  ssh,
  workspaceId,
  openCard,
  onOpenShell,
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
  onHide: () => void
}): React.JSX.Element {
  const { sidePanelWidth, sidePanelTab: tab } = useSettings()
  const workspace = useWorkspaceState().workspaces.find((w) => w.id === workspaceId)
  // The window the panel is in: the main window, or a card's own (#53 D4, D5).
  const view = useViewWindow()
  const windowWidth = useWindowWidth(view)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const id = useId()
  const width = dragWidth ?? shownPanelWidth(sidePanelWidth, windowWidth)

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
          drag.current = { startX: event.clientX, startWidth: width }
          setDragWidth(width)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start) return
          setDragWidth(
            draggedPanelWidth(start.startWidth, start.startX - event.clientX, view.innerWidth)
          )
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
          setDragWidth(null)
          save(next)
        }}
        onLostPointerCapture={() => {
          // A drag cut short (e.g. the window lost the pointer) keeps the width it reached.
          if (drag.current && dragWidth !== null) save(dragWidth)
          drag.current = null
          setDragWidth(null)
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
      <div className="side-panel-header">
        <div className="side-panel-tabs" role="tablist" aria-label="Panel tabs">
          {PANEL_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="side-panel-tab"
              data-testid={`side-panel-tab-${t.id}`}
              id={`${id}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${id}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => settingsStore.update({ sidePanelTab: t.id })}
            >
              {t.label}
              {t.id === 'shells' && workspace && <RunningShells workspace={workspace} />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn side-panel-hide"
          data-testid="side-panel-hide"
          aria-label="Hide panel"
          title="Hide panel"
          onClick={onHide}
        >
          <X {...SMALL_ICON} />
        </button>
      </div>
      <div
        className="side-panel-body"
        role="tabpanel"
        id={`${id}-panel-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
      >
        {tab === 'files' && (
          <FilesTab
            folder={folder}
            ssh={ssh}
            onOpenFile={(path) => window.drovr.files.open(folder, path)}
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

/** How many of the workspace's shells run, on the Shells tab; nothing when none does. */
function RunningShells({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const running = useRunningCount(shellCards(workspace))
  if (running === 0) return null
  return (
    <span
      className="side-panel-tab-count"
      data-testid="shells-running"
      aria-label={`${running} running`}
    >
      {running}
    </span>
  )
}

export default SidePanel
