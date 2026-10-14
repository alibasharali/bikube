import { useId, useState } from 'react'
import {
  DEFAULT_FONT_FAMILY,
  MAX_FONT_FAMILY_LENGTH,
  THEMES,
  type Theme
} from '../../core/settings'
import { FONT_SIZE_ERROR, fontFamilyField, parseFontSize } from '../../core/settings-form'
import { syncFolderOf, syncStatusText } from '../../core/sync-status'
import Modal from './Modal'
import { settingsStore, useSettings } from './settings'
import { useSyncStatus } from './sync'

export const SYNC_FOLDER_ERROR = 'Folder not found'

const THEME_LABELS: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' }

/**
 * The Settings dialog (#10 D5): Theme, Font size, Font family and Sync folder (#13 D10). Every
 * valid change applies and saves at once; closing applies a typed family, keeps what was applied
 * and drops an invalid font size.
 */
function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useSettings()
  const id = useId()
  const [sizeText, setSizeText] = useState(() => String(settingsStore.get().fontSize))
  const [sizeInvalid, setSizeInvalid] = useState(false)
  const [family, setFamily] = useState(() => fontFamilyField(settingsStore.get().fontFamily))

  const changeSize = (text: string): void => {
    setSizeText(text)
    const size = parseFontSize(text)
    setSizeInvalid(size === null)
    if (size !== null) settingsStore.update({ fontSize: size })
  }

  // The family applies as typed, trimmed (empty means the default), on blur or Enter.
  const applyFamily = (): void => {
    if (settingsStore.update({ fontFamily: family })) {
      setFamily(fontFamilyField(settingsStore.get().fontFamily))
    }
  }

  // Closing any way (Done, Escape, a click outside) applies a family typed but not yet applied.
  const close = (): void => {
    settingsStore.update({ fontFamily: family })
    onClose()
  }

  const sizeId = `${id}-size`
  const syncId = `${id}-sync`
  const syncErrorId = `${id}-sync-error`
  const sizeErrorId = `${id}-size-error`
  const familyId = `${id}-family`
  return (
    <Modal
      title="Settings"
      onClose={close}
      testId="settings-dialog"
      initialFocus='input[type="radio"]:checked'
      closeOnOutsideClick
    >
      <fieldset className="field radio-group">
        <legend>Theme</legend>
        {THEMES.map((theme) => (
          <label key={theme} className="radio">
            <input
              type="radio"
              name={`${id}-theme`}
              value={theme}
              data-testid={`settings-theme-${theme}`}
              checked={settings.theme === theme}
              onChange={() => settingsStore.update({ theme })}
            />
            {THEME_LABELS[theme]}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={sizeId}>Font size</label>
        <input
          id={sizeId}
          data-testid="settings-font-size"
          inputMode="numeric"
          value={sizeText}
          autoComplete="off"
          aria-invalid={sizeInvalid ? true : undefined}
          aria-describedby={sizeInvalid ? sizeErrorId : undefined}
          onChange={(e) => changeSize(e.target.value)}
        />
        {sizeInvalid && (
          <p
            className="field-error"
            id={sizeErrorId}
            role="alert"
            data-testid="settings-error-font-size"
          >
            {FONT_SIZE_ERROR}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor={familyId}>Font family</label>
        <input
          id={familyId}
          data-testid="settings-font-family"
          value={family}
          maxLength={MAX_FONT_FAMILY_LENGTH}
          placeholder={DEFAULT_FONT_FAMILY}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setFamily(e.target.value)}
          onBlur={applyFamily}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            applyFamily()
          }}
        />
      </div>
      <SyncFolderField id={syncId} errorId={syncErrorId} />
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="settings-done"
          onClick={close}
        >
          Done
        </button>
      </div>
    </Modal>
  )
}

/**
 * The Sync folder section (#13 D10, D13): a typed path applies on blur or Enter (empty turns sync
 * off), `Choose…` opens the native picker, `Turn off` shows while sync is on; main checks the folder
 * and keeps the previous one when it isn't found. The status line follows main's status.
 */
function SyncFolderField({ id, errorId }: { id: string; errorId: string }): React.JSX.Element {
  const status = useSyncStatus()
  const folder = syncFolderOf(status)
  const [text, setText] = useState(folder ?? '')
  const [shown, setShown] = useState(folder)
  const [notFound, setNotFound] = useState(false)
  // The folder changed in main (picked, turned off, set): the field shows it.
  if (shown !== folder) {
    setShown(folder)
    setText(folder ?? '')
    setNotFound(false)
  }

  const apply = async (): Promise<void> => {
    const typed = text.trim()
    const next = typed === '' ? null : typed
    if (next === folder) {
      setText(folder ?? '')
      setNotFound(false)
      return
    }
    const result = await window.drovr.sync.setFolder(next)
    setNotFound(!result.ok)
  }

  const statusText = syncStatusText(status)
  return (
    <div className="field">
      <label htmlFor={id}>Sync folder</label>
      <div className="field-row">
        <input
          id={id}
          data-testid="settings-sync-folder"
          value={text}
          placeholder="Off"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={notFound ? true : undefined}
          aria-describedby={notFound ? errorId : undefined}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void apply()}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void apply()
          }}
        />
        <button
          type="button"
          className="btn"
          data-testid="settings-sync-choose"
          onClick={() => {
            void window.drovr.sync.pickFolder().then((result) => setNotFound(!result.ok))
          }}
        >
          Choose…
        </button>
        {folder !== null && (
          <button
            type="button"
            className="btn"
            data-testid="settings-sync-off"
            onClick={() => {
              setText('')
              setNotFound(false)
              void window.drovr.sync.setFolder(null)
            }}
          >
            Turn off
          </button>
        )}
      </div>
      {notFound && (
        <p
          className="field-error"
          id={errorId}
          role="alert"
          data-testid="settings-error-sync-folder"
        >
          {SYNC_FOLDER_ERROR}
        </p>
      )}
      {statusText !== null && (
        <p className="field-hint" data-testid="settings-sync-status">
          {statusText}
        </p>
      )}
    </div>
  )
}

export default SettingsDialog
