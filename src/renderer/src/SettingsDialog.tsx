import { useId, useRef, useState } from 'react'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  defaultKeymap,
  recordPress,
  resolveKeymap,
  shortcutOverrides,
  type Keymap,
  type ShortcutAction
} from '../../core/keymap'
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
 * The Settings dialog (#10 D5): Theme, Font size, Font family, Sync folder (#13 D10) and
 * Shortcuts (#31 D8). Every
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
      <ShortcutsSection keymap={resolveKeymap(settings.shortcuts, window.drovr.platform)} />
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
  // Only the latest folder request's answer shows: an older one, superseded (e.g. by Turn off),
  // must not bring `Folder not found` back.
  const request = useRef(0)
  const answer = (result: Promise<{ ok: boolean }>): void => {
    const mine = ++request.current
    void result.then((r) => {
      if (mine === request.current) setNotFound(!r.ok)
    })
  }

  const apply = (): void => {
    const typed = text.trim()
    const next = typed === '' ? null : typed
    if (next === folder) {
      setText(folder ?? '')
      setNotFound(false)
      return
    }
    answer(window.drovr.sync.setFolder(next))
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
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            apply()
          }}
        />
        <button
          type="button"
          className="btn"
          data-testid="settings-sync-choose"
          onClick={() => answer(window.drovr.sync.pickFolder())}
        >
          Choose…
        </button>
        {folder !== null && (
          <button
            type="button"
            className="btn"
            data-testid="settings-sync-off"
            // Keeps the field focused, so its blur doesn't apply a typed folder before turning off.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText('')
              setNotFound(false)
              ++request.current
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

/**
 * The Shortcuts section (#31 D8): each configurable action with its shortcut and a Reset button.
 * Clicking a field records the next press with Cmd, Ctrl or Alt; Escape (or leaving the field)
 * stops recording; a press that can't be a shortcut, or is already used, shows why and keeps
 * recording. A new shortcut or a Reset applies and saves at once, like the dialog's other fields.
 */
function ShortcutsSection({ keymap }: { keymap: Keymap }): React.JSX.Element {
  const platform = window.drovr.platform
  const defaults = defaultKeymap(platform)
  const id = useId()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  const stop = (): void => {
    setRecording(null)
    setRefusal(null)
  }
  const apply = (action: ShortcutAction, shortcut: string): void => {
    settingsStore.update({
      shortcuts: shortcutOverrides({ ...keymap, [action]: shortcut }, platform)
    })
  }

  const onKeyDown = (action: ShortcutAction, event: React.KeyboardEvent): void => {
    if (recording !== action) return
    const { key, ctrlKey, altKey, metaKey } = event
    // Tab still moves the focus out of the field, which stops recording.
    if (key === 'Tab' && !ctrlKey && !altKey && !metaKey) return
    // The press is the field's alone: it never closes the dialog or reaches anything else.
    event.preventDefault()
    event.stopPropagation()
    const result = recordPress(event.nativeEvent, action, keymap, platform)
    if (result.kind === 'cancel') stop()
    else if (result.kind === 'refused') setRefusal(result.message)
    else if (result.kind === 'set') {
      apply(action, result.shortcut)
      stop()
    }
  }

  return (
    <fieldset className="field shortcuts" data-testid="settings-shortcuts">
      <legend>Shortcuts</legend>
      {SHORTCUT_ACTIONS.map((action) => {
        const labelId = `${id}-${action}`
        const errorId = `${id}-${action}-error`
        const isRecording = recording === action
        const error = isRecording ? refusal : null
        return (
          <div key={action} className="shortcut-row">
            <span id={labelId} className="shortcut-label">
              {SHORTCUT_LABELS[action]}
            </span>
            <button
              type="button"
              className="shortcut-field"
              data-testid={`settings-shortcut-${action}`}
              data-recording={isRecording}
              aria-labelledby={`${labelId} ${id}-${action}-value`}
              aria-describedby={error !== null ? errorId : undefined}
              aria-pressed={isRecording}
              onClick={() => {
                setRecording(action)
                setRefusal(null)
              }}
              onKeyDown={(event) => onKeyDown(action, event)}
              onBlur={() => {
                if (isRecording) stop()
              }}
            >
              <span id={`${id}-${action}-value`}>
                {isRecording && error === null ? 'Press a shortcut…' : keymap[action]}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-small"
              data-testid={`settings-shortcut-reset-${action}`}
              aria-label={`Reset ${SHORTCUT_LABELS[action]}`}
              disabled={keymap[action] === defaults[action]}
              onClick={() => {
                if (isRecording) stop()
                apply(action, defaults[action])
              }}
            >
              Reset
            </button>
            {error !== null && (
              <p
                className="field-error shortcut-error"
                id={errorId}
                role="alert"
                data-testid={`settings-shortcut-error-${action}`}
              >
                {error}
              </p>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
