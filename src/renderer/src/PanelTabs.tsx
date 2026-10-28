import { PanelRight } from 'lucide-react'
import type { SidePanelTab } from '../../core/settings'
import { PANEL_BODY_ID, panelTabId } from '../../core/side-panel'
import { listedShellCards } from '../../core/workspace-shells'
import type { Workspace } from '../../core/workspace-store'
import { useRunningCount } from './card-terminals'
import { ICON } from './icons'
import { settingsStore, useSettings } from './settings'
import Tooltip from './Tooltip'

/** The panel's tabs (#55 D1), in strip order. */
const PANEL_TABS: readonly { id: SidePanelTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'shells', label: 'Shells' }
]

/**
 * The side panel's tab strip: in the title bar above the panel in the main window, in the panel's
 * own header in a card window, which has no title bar.
 */
export function PanelTabs({ workspace }: { workspace: Workspace | undefined }): React.JSX.Element {
  const { sidePanelTab: tab } = useSettings()
  return (
    <div className="side-panel-tabs" role="tablist" aria-label="Panel tabs">
      {PANEL_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className="side-panel-tab"
          data-testid={`side-panel-tab-${t.id}`}
          id={panelTabId(t.id)}
          aria-selected={tab === t.id}
          aria-controls={PANEL_BODY_ID}
          tabIndex={tab === t.id ? 0 : -1}
          onClick={() => settingsStore.update({ sidePanelTab: t.id })}
        >
          {t.label}
          {t.id === 'shells' && workspace && <RunningShells workspace={workspace} />}
        </button>
      ))}
    </div>
  )
}

/** Shows or hides the side panel everywhere (#55 D3); `onToggle` replaces the plain toggle. */
export function PanelToggle({
  testId = 'titlebar-panel',
  onToggle
}: {
  testId?: string
  onToggle?: () => void
}): React.JSX.Element {
  const { sidePanelOpen } = useSettings()
  return (
    <Tooltip
      label={sidePanelOpen ? 'Hide panel' : 'Show panel'}
      description="The workspace's files and shells, beside the board and every card"
      shortcut="togglePanel"
      align="end"
      className="titlebar-panel-anchor"
    >
      <button
        type="button"
        className="icon-btn titlebar-panel"
        data-testid={testId}
        aria-label="Side panel"
        aria-pressed={sidePanelOpen}
        onClick={onToggle ?? (() => settingsStore.update({ sidePanelOpen: !sidePanelOpen }))}
      >
        <PanelRight {...ICON} />
      </button>
    </Tooltip>
  )
}

/** How many of the workspace's shells run, on the Shells tab; nothing when none does. */
function RunningShells({ workspace }: { workspace: Workspace }): React.JSX.Element | null {
  const running = useRunningCount(listedShellCards(workspace))
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
