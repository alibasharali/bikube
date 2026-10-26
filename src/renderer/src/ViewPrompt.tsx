import { useId, useState } from 'react'
import type { WorkspaceView } from '../../core/workspace-store'
import Modal from './Modal'
import { settingsStore } from './settings'
import { VIEWS } from './workspace-views'

const DESCRIPTIONS: Record<WorkspaceView, string> = {
  kanban: 'Columns for each stage of the work. Drag cards between them as they move along.',
  grid: 'Every card in one grid, latest first. Cards waiting for you come first.'
}

/** A small drawing of the view: three columns of cards, or a grid of them. */
function ViewPreview({ view }: { view: WorkspaceView }): React.JSX.Element {
  if (view === 'kanban') {
    return (
      <span className="view-preview view-preview-kanban" aria-hidden="true">
        {[3, 2, 1].map((cards, column) => (
          <span key={column} className="vp-column">
            {Array.from({ length: cards }, (_, i) => (
              <span key={i} className="vp-card" />
            ))}
          </span>
        ))}
      </span>
    )
  }
  return (
    <span className="view-preview view-preview-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={i === 0 ? 'vp-card vp-card-waiting' : 'vp-card'} />
      ))}
    </span>
  )
}

/**
 * The first launch's question: how workspaces show their cards, Kanban or Grid, each tile with a
 * preview. Continue (or Esc) saves the picked one as the default view, and it never asks again:
 * the app shows it only while none is chosen.
 */
function ViewPrompt(): React.JSX.Element {
  const id = useId()
  const [view, setView] = useState<WorkspaceView>(settingsStore.get().defaultView)
  const choose = (): void => {
    settingsStore.update({ defaultView: view, viewChosen: true })
  }
  return (
    <Modal
      title="How do you want to see your session cards?"
      onClose={choose}
      testId="view-prompt"
      className="modal-view-prompt"
      initialFocus='input[type="radio"]:checked'
    >
      <div className="view-tiles" role="radiogroup" aria-label="View">
        {VIEWS.map(([value, label]) => (
          <label key={value} className="view-tile" data-testid={`view-prompt-${value}`}>
            <input
              type="radio"
              name={`${id}-view`}
              value={value}
              checked={view === value}
              aria-describedby={`${id}-${value}-description`}
              onChange={() => setView(value)}
            />
            <ViewPreview view={value} />
            <span className="view-tile-name">{label}</span>
            <span className="view-tile-description" id={`${id}-${value}-description`}>
              {DESCRIPTIONS[value]}
            </span>
          </label>
        ))}
      </div>
      <p className="field-hint">
        This is the view new workspaces start in. Each workspace can have its own, set in its Edit
        dialog, and you can change the default later in Settings.
      </p>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="view-prompt-continue"
          onClick={choose}
        >
          Continue
        </button>
      </div>
    </Modal>
  )
}

export default ViewPrompt
