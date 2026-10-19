import { Laptop, Server, type LucideIcon } from 'lucide-react'
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
import { CLAUDE_STARTUP, checkCardStartup } from '../../core/startup-command'
import { keepKnownRules, type AutoMove, type AutoMoveTrigger } from '../../core/auto-move'
import { draftStartup, startupDraft, type StartupDraft } from '../../core/startup-form'
import { WORKSPACE_LOGOS, type WorkspaceLogoId } from '../../core/workspace-logos'
import {
  checkWorktreeSetup,
  defaultWorkspaceName,
  type Workspace
} from '../../core/workspace-store'
import { SMALL_ICON } from './icons'
import Modal from './Modal'
import StartupField from './StartupField'
import { workspaceStore } from './store'
import { workspaceInitial } from './workspace-initial'
import { LOGO_ICON, LOGO_ICONS } from './workspace-logo'

interface WorkspaceDialogProps {
  /** The workspace being edited, or null to create one. */
  workspace: Workspace | null
  workspaces: Workspace[]
  onClose: () => void
}

/** The automatic move rules' selects (#42 D6), in the fieldset's order. */
const AUTO_MOVE_RULES: [AutoMoveTrigger, string][] = [
  ['working', 'When working'],
  ['waiting', 'When waiting for you'],
  ['stopped', 'When stopped']
]

/** The Location choice (#12 D4), `This computer` first as the default. */
const LOCATIONS: [WorkspaceLocation, string, LucideIcon][] = [
  ['local', 'This computer', Laptop],
  ['ssh', 'SSH', Server]
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
    startupDraft(workspace?.defaultStartup ?? CLAUDE_STARTUP)
  )
  const [commandError, setCommandError] = useState<string | undefined>(undefined)
  // Typed in each new worktree card before its startup command; local workspaces only (#39 D1).
  const [setup, setSetup] = useState(workspace?.worktreeSetup ?? '')
  const [setupError, setSetupError] = useState<string | undefined>(undefined)
  // The sidebar badge's icon (#59 D3); null is None, the name's initial.
  const [logo, setLogo] = useState<WorkspaceLogoId | null>(workspace?.logo ?? null)
  // The automatic move rules (#42 D6): edited here, stored only on Save.
  const [autoMove, setAutoMove] = useState<AutoMove>(workspace?.autoMove ?? {})
  // The board's columns as they are now, so a rename or delete while the dialog is open shows.
  const columns =
    workspaces.find((w) => w.id === workspace?.id)?.columns ?? workspace?.columns ?? []
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
      const command = checkCardStartup(draftStartup(startup))
      setCommandError(command.ok ? undefined : command.error.message)
      // An SSH workspace keeps whatever setup it has, unseen and unchecked (#39 D1).
      const checkedSetup = ssh ? null : checkWorktreeSetup(setup)
      setSetupError(checkedSetup && !checkedSetup.ok ? checkedSetup.error.message : undefined)
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      if (!command.ok || (checkedSetup && !checkedSetup.ok)) return
      // An explicit null host makes an edited SSH workspace local again (#12 D1).
      const input = {
        ...result.value,
        host: result.value.host ?? null,
        defaultStartup: command.value,
        ...(checkedSetup && { worktreeSetup: checkedSetup.value }),
        logo,
        // A rule whose column went while the dialog was open is off (#42 D2).
        ...(workspace && {
          autoMove:
            keepKnownRules(
              autoMove,
              columns.map((c) => c.id)
            ) ?? {}
        })
      }
      const stored = workspace
        ? workspaceStore.updateWorkspace(workspace.id, input)
        : workspaceStore.createWorkspace(input)
      if (!stored.ok) {
        if (stored.error.field === 'command') {
          setCommandError(stored.error.message)
          return
        }
        if (stored.error.field === 'setup') {
          setSetupError(stored.error.message)
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
          <div className="segmented">
            {LOCATIONS.map(([location, label, Icon]) => (
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
                <Icon {...SMALL_ICON} />
                {label}
              </label>
            ))}
          </div>
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
        <fieldset className="field radio-group">
          <legend>Logo</legend>
          <div className="logo-grid">
            <label className="logo-choice" title="None">
              <input
                type="radio"
                name={`${id}-logo`}
                value=""
                aria-label="None"
                title="None"
                data-testid="workspace-logo-none"
                checked={logo === null}
                onChange={() => setLogo(null)}
              />
              {/* The Name field's initial as it reads now; empty, the name it would default to. */}
              {workspaceInitial(
                draft.name.trim() ||
                  defaultWorkspaceName(draft.directory, ssh ? (draft.host ?? '') : null)
              )}
            </label>
            {WORKSPACE_LOGOS.map(({ id: logoId, label }) => {
              const Icon = LOGO_ICONS[logoId]
              return (
                <label key={logoId} className="logo-choice" title={label}>
                  <input
                    type="radio"
                    name={`${id}-logo`}
                    value={logoId}
                    aria-label={label}
                    title={label}
                    data-testid={`workspace-logo-${logoId}`}
                    checked={logo === logoId}
                    onChange={() => setLogo(logoId)}
                  />
                  <Icon {...LOGO_ICON} />
                </label>
              )
            })}
          </div>
        </fieldset>
        <StartupField
          draft={startup}
          onChange={(next) => {
            setStartup(next)
            setCommandError(undefined)
          }}
          error={commandError}
          testIdPrefix="workspace"
        />
        {!ssh && (
          <div className="field">
            <label htmlFor={`${id}-setup`}>Worktree setup</label>
            <input
              id={`${id}-setup`}
              data-testid="workspace-worktree-setup"
              value={setup}
              placeholder="npm ci"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={setupError ? true : undefined}
              aria-describedby={setupError ? `${id}-setup-error` : `${id}-setup-hint`}
              onChange={(e) => {
                setSetup(e.target.value)
                setSetupError(undefined)
              }}
              onPaste={(e) => {
                // An input drops a pasted newline, joining the lines silently; keep them, so
                // saving says the command must be one line instead (#39 AC2).
                const text = e.clipboardData.getData('text/plain')
                if (!/[\r\n]/.test(text)) return
                e.preventDefault()
                const { value, selectionStart, selectionEnd } = e.currentTarget
                const start = selectionStart ?? value.length
                setSetup(value.slice(0, start) + text + value.slice(selectionEnd ?? start))
                setSetupError(undefined)
              }}
            />
            {setupError ? (
              <p
                className="field-error"
                id={`${id}-setup-error`}
                role="alert"
                data-testid="workspace-error-setup"
              >
                {setupError}
              </p>
            ) : (
              <p className="field-hint" id={`${id}-setup-hint`}>
                Run in each new Own worktree card before its startup command. Leave empty for none.
              </p>
            )}
          </div>
        )}
        {workspace && (
          <fieldset className="field radio-group auto-move">
            <legend>Move cards automatically</legend>
            {AUTO_MOVE_RULES.map(([trigger, label]) => (
              <div key={trigger} className="auto-move-rule">
                <label htmlFor={`${id}-auto-move-${trigger}`}>{label}</label>
                <select
                  id={`${id}-auto-move-${trigger}`}
                  data-testid={`workspace-auto-move-${trigger}`}
                  value={columns.some((c) => c.id === autoMove[trigger]) ? autoMove[trigger] : ''}
                  onChange={(e) => {
                    const next = { ...autoMove }
                    if (e.target.value) next[trigger] = e.target.value
                    else delete next[trigger]
                    setAutoMove(next)
                  }}
                >
                  <option value="">Don&apos;t move</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </fieldset>
        )}
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
