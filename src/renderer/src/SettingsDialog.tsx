import { useId, useState } from 'react'
import {
  DEFAULT_FONT_FAMILY,
  MAX_FONT_FAMILY_LENGTH,
  THEMES,
  type Theme
} from '../../core/settings'
import { FONT_SIZE_ERROR, fontFamilyField, parseFontSize } from '../../core/settings-form'
import Modal from './Modal'
import { settingsStore, useSettings } from './settings'

const THEME_LABELS: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' }

/**
 * The Settings dialog (#10 D5): Theme, Font size and Font family. Every valid change applies and
 * saves at once; closing applies a typed family, keeps what was applied and drops an invalid
 * font size.
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

export default SettingsDialog
