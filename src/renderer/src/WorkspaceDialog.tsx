import { useState } from 'react'
import {
  applyDirectory,
  applyName,
  validateDraft,
  type DraftErrors,
  type WorkspaceDraft
} from '../../core/workspace-form'
import type { Workspace } from '../../core/workspace-store'
import Modal from './Modal'
import { workspaceStore } from './store'

interface WorkspaceDialogProps {
  /** The workspace being edited, or null to create one. */
  workspace: Workspace | null
  workspaces: Workspace[]
  onClose: () => void
}

function WorkspaceDialog({
  workspace,
  workspaces,
  onClose
}: WorkspaceDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<WorkspaceDraft>(
    workspace
      ? { name: workspace.name, directory: workspace.directory, nameTouched: true }
      : { name: '', directory: '', nameTouched: false }
  )
  const [errors, setErrors] = useState<DraftErrors>({})
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
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      const stored = workspace
        ? workspaceStore.updateWorkspace(workspace.id, result.value)
        : workspaceStore.createWorkspace(result.value)
      if (!stored.ok) {
        const field = stored.error.field === 'name' ? 'name' : 'directory'
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
        <div className="field">
          <label htmlFor="workspace-directory">Working directory</label>
          <div className="field-row">
            <input
              id="workspace-directory"
              data-testid="workspace-directory"
              value={draft.directory}
              placeholder="/path/to/project"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={errors.directory ? true : undefined}
              aria-describedby={errors.directory ? 'workspace-directory-error' : undefined}
              onChange={(e) => {
                setDraft(applyDirectory(draft, e.target.value))
                setErrors({ ...errors, directory: undefined })
              }}
            />
            <button
              type="button"
              className="btn"
              data-testid="workspace-browse"
              onClick={() => void browse()}
            >
              Browse…
            </button>
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
