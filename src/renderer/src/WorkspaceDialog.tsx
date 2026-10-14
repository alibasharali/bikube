import { useId, useState } from 'react'
import {
  applyDirectory,
  applyHost,
  applyLocation,
  applyName,
  validateDraft,
  emptyDraft,
  type DraftErrors,
  type WorkspaceDraft,
  type WorkspaceLocation
} from '../../core/workspace-form'
import { SHELL_STARTUP, checkStartup } from '../../core/startup-command'
import { draftStartup, startupDraft, type StartupDraft } from '../../core/startup-form'
import type { Workspace } from '../../core/workspace-store'
import Modal from './Modal'
import StartupField from './StartupField'
import { workspaceStore } from './store'

interface WorkspaceDialogProps {
  /** The workspace being edited, or null to create one. */
  workspace: Workspace | null
  workspaces: Workspace[]
  onClose: () => void
}

/** The Location choice (#12 D4), `This computer` first as the default. */
const LOCATIONS: [WorkspaceLocation, string][] = [
  ['local', 'This computer'],
  ['ssh', 'SSH']
]

function WorkspaceDialog({
  workspace,
  workspaces,
  onClose
}: WorkspaceDialogProps): React.JSX.Element {
  const id = useId()
  const [draft, setDraft] = useState<WorkspaceDraft>(
    workspace
      ? {
          name: workspace.name,
          directory: workspace.directory,
          nameTouched: true,
          location: workspace.host === undefined ? 'local' : 'ssh',
          host: workspace.host ?? ''
        }
      : emptyDraft()
  )
  const ssh = draft.location === 'ssh'
  const [errors, setErrors] = useState<DraftErrors>({})
  // The default startup command for new cards (#5 D10); Shell for a new workspace.
  const [startup, setStartup] = useState<StartupDraft>(() =>
    startupDraft(workspace?.defaultStartup ?? SHELL_STARTUP)
  )
  const [commandError, setCommandError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const browse = async (): Promise<void> => {
    const picked = await window.drovr.dialog.pickDirectory()
    if (picked) {
      setDraft((d) => applyDirectory(d, picked))
      setErrors((e) => ({ ...e, directory: undefined }))
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const result = await validateDraft(draft, {
        existingNames: workspaces.filter((w) => w.id !== workspace?.id).map((w) => w.name),
        isDirectory: (p) => window.drovr.fs.isDirectory(p)
      })
      const command = checkStartup(draftStartup(startup))
      setCommandError(command.ok ? undefined : command.error.message)
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      if (!command.ok) return
      // An explicit null host makes an edited SSH workspace local again (#12 D1).
      const input = {
        ...result.value,
        host: result.value.host ?? null,
        defaultStartup: command.value
      }
      const stored = workspace
        ? workspaceStore.updateWorkspace(workspace.id, input)
        : workspaceStore.createWorkspace(input)
      if (!stored.ok) {
        if (stored.error.field === 'command') {
          setCommandError(stored.error.message)
          return
        }
        const field =
          stored.error.field === 'name' || stored.error.field === 'host'
            ? stored.error.field
            : 'directory'
        setErrors({ [field]: stored.error.message })
        return
      }
      if (!workspace) workspaceStore.selectWorkspace(stored.value.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={workspace ? 'Edit workspace' : 'Create workspace'}
      onClose={onClose}
      testId="workspace-dialog"
      initialFocus='[data-testid="workspace-directory"]'
    >
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="field radio-group">
          <legend>Location</legend>
          {LOCATIONS.map(([location, label]) => (
            <label key={location} className="radio">
              <input
                type="radio"
                name={`${id}-location`}
                value={location}
                data-testid={`workspace-location-${location}`}
                checked={(draft.location ?? 'local') === location}
                onChange={() => {
                  setDraft(applyLocation(draft, location))
                  setErrors({ ...errors, directory: undefined, host: undefined })
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {ssh && (
          <div className="field">
            <label htmlFor="workspace-host">Host</label>
            <input
              id="workspace-host"
              data-testid="workspace-host"
              value={draft.host ?? ''}
              placeholder="me@devbox"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={errors.host ? true : undefined}
              aria-describedby={errors.host ? 'workspace-host-error' : undefined}
              onChange={(e) => {
                setDraft(applyHost(draft, e.target.value))
                setErrors({ ...errors, host: undefined })
              }}
            />
            {errors.host && (
              <p
                className="field-error"
                id="workspace-host-error"
                role="alert"
                data-testid="workspace-error-host"
              >
                {errors.host}
              </p>
            )}
          </div>
        )}
        <div className="field">
          <label htmlFor="workspace-directory">Working directory</label>
          <div className="field-row">
            <input
              id="workspace-directory"
              data-testid="workspace-directory"
              value={draft.directory}
              placeholder={ssh ? '~/project' : '/path/to/project'}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={errors.directory ? true : undefined}
              aria-describedby={errors.directory ? 'workspace-directory-error' : undefined}
              onChange={(e) => {
                setDraft(applyDirectory(draft, e.target.value))
                setErrors({ ...errors, directory: undefined })
              }}
            />
            {/* The picker sees only this computer's folders (#12 D3). */}
            {!ssh && (
              <button
                type="button"
                className="btn"
                data-testid="workspace-browse"
                onClick={() => void browse()}
              >
                Browse…
              </button>
            )}
          </div>
          {errors.directory && (
            <p
              className="field-error"
              id="workspace-directory-error"
              role="alert"
              data-testid="workspace-error-directory"
            >
              {errors.directory}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="workspace-name">Name</label>
          <input
            id="workspace-name"
            data-testid="workspace-name"
            value={draft.name}
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'workspace-name-error' : undefined}
            onChange={(e) => {
              setDraft(applyName(draft, e.target.value))
              setErrors({ ...errors, name: undefined })
            }}
          />
          {errors.name && (
            <p
              className="field-error"
              id="workspace-name-error"
              role="alert"
              data-testid="workspace-error-name"
            >
              {errors.name}
            </p>
          )}
        </div>
        <StartupField
          draft={startup}
          onChange={(next) => {
            setStartup(next)
            setCommandError(undefined)
          }}
          error={commandError}
          testIdPrefix="workspace"
        />
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="workspace-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="workspace-submit"
            disabled={busy}
          >
            {workspace ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default WorkspaceDialog
