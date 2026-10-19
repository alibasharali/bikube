import {
  Bot,
  ChevronRight,
  FilePen,
  FolderSync,
  Info,
  Keyboard,
  Minus,
  Monitor,
  Moon,
  Palette,
  Plus,
  RotateCw,
  SquareTerminal,
  Sun,
  Terminal as TerminalIcon,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  defaultKeymap,
  recordPress,
  resetRefusal,
  resolveKeymap,
  shortcutOverrides,
  type Keymap,
  type ShortcutAction
} from '../../core/keymap'
import {
  DEFAULT_FONT_FAMILY,
  EDITORS,
  MAX_EDITOR_COMMAND_LENGTH,
  MAX_FONT_FAMILY_LENGTH,
  MAX_FONT_SIZE,
  MAX_LETTER_SPACING,
  MIN_FONT_SIZE,
  SCROLLBACK_CHOICES,
  THEMES,
  isShellSetting,
  resolveTheme,
  type Bell,
  type CursorStyle,
  type Editor,
  type ResolvedTheme,
  type Theme
} from '../../core/settings'
import { ANSI_COLOUR_NAMES, terminalPalette, withSymbols } from '../../core/terminal-appearance'
import { terminalTheme } from '../../core/terminal-themes'
import type { ShellChoices } from '../../shared/api'
import { FONT_CHOICES, familyOf, fontChoiceOf } from '../../core/font-choices'
import { FONT_SIZE_ERROR, fontFamilyField, parseFontSize } from '../../core/settings-form'
import { syncFolderOf, syncStatusText } from '../../core/sync-status'
import { ghosttyStore, useGhosttyTheme } from './ghostty'
import { installedFonts } from './installed-fonts'
import { ICON, SMALL_ICON } from './icons'
import Modal from './Modal'
import ShortcutKeys from './ShortcutKeys'
import { settingsStore, useSettings } from './settings'
import TerminalPreview from './TerminalPreview'
import ThemePicker from './ThemePicker'
import { useSyncStatus } from './sync'

export const SYNC_FOLDER_ERROR = 'Folder not found'

const THEME_LABELS: Record<Theme, string> = { system: 'System', dark: 'Dark', light: 'Light' }
const THEME_ICONS: Record<Theme, LucideIcon> = { system: Monitor, dark: Moon, light: Sun }
const CUSTOM_FONT = '__custom__'
/** The font the default family (Menlo, Consolas, monospace) gives on this OS. */
const DEFAULT_FONT_LABEL =
  {
    darwin: 'Default (Menlo)',
    win32: 'Default (Consolas)'
  }[window.drovr?.platform as string] ?? 'Default (monospace)'

export const SHELL_NOT_ABSOLUTE = 'Enter an absolute path, e.g. /opt/homebrew/bin/fish'

type Section =
  'appearance' | 'terminal' | 'shell' | 'editor' | 'agents' | 'shortcuts' | 'sync' | 'about'

const SECTIONS: { key: Section; label: string; icon: LucideIcon }[] = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'terminal', label: 'Terminal', icon: SquareTerminal },
  { key: 'shell', label: 'Shell', icon: TerminalIcon },
  { key: 'editor', label: 'Editor', icon: FilePen },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { key: 'sync', label: 'Sync', icon: FolderSync },
  { key: 'about', label: 'About', icon: Info }
]

/**
 * The Settings dialog (#10 D5): a list of sections (Appearance, Terminal, Shell, Editor, Agents,
 * Shortcuts, Sync, About)
 * beside the chosen one, which scrolls on its own while the title and Done stay put. It opens on
 * Appearance. Every valid change applies and saves at once; closing applies a typed family, keeps
 * what was applied and drops an invalid font size. Picking a terminal theme swaps the dialog's
 * content for the theme picker until a theme is picked or cancelled, then returns to Terminal.
 */
function SettingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const settings = useSettings()
  const id = useId()
  const [section, setSection] = useState<Section>('appearance')
  const [family, setFamily] = useState(() => fontFamilyField(settingsStore.get().fontFamily))
  const [picking, setPicking] = useState<ResolvedTheme | null>(null)
  const tabs = useRef<HTMLDivElement>(null)

  // Closing any way (Done, Escape, a click outside) applies a family typed but not yet applied.
  const close = (): void => {
    settingsStore.update({ fontFamily: family })
    onClose()
  }

  // Up and Down move between sections, as in a vertical tab list.
  const onTabKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const at = SECTIONS.findIndex((s) => s.key === section)
    const next =
      SECTIONS[(at + (e.key === 'ArrowDown' ? 1 : SECTIONS.length - 1)) % SECTIONS.length]!
    setSection(next.key)
    tabs.current?.querySelector<HTMLElement>(`[data-section="${next.key}"]`)?.focus()
  }

  if (picking !== null) {
    const key = picking === 'dark' ? 'terminalThemeDark' : 'terminalThemeLight'
    return (
      <Modal
        key="picker"
        title={picking === 'dark' ? 'Dark terminal theme' : 'Light terminal theme'}
        onClose={() => setPicking(null)}
        testId="settings-dialog"
        className="modal-wide"
        closeOnOutsideClick
      >
        <ThemePicker
          appearance={picking}
          initial={settings[key]}
          fontFamily={withSymbols(settings.fontFamily)}
          onPick={(name) => {
            settingsStore.update(
              picking === 'dark' ? { terminalThemeDark: name } : { terminalThemeLight: name }
            )
            setPicking(null)
          }}
          onCancel={() => setPicking(null)}
        />
      </Modal>
    )
  }
  const panelId = `${id}-panel`
  const current = SECTIONS.find((s) => s.key === section)!
  return (
    <Modal
      key="settings"
      title="Settings"
      onClose={close}
      testId="settings-dialog"
      className="modal-settings"
      initialFocus={section === 'appearance' ? 'input[type="radio"]:checked' : undefined}
      closeOnOutsideClick
    >
      <div className="settings">
        <div
          ref={tabs}
          className="settings-nav"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          onKeyDown={onTabKey}
        >
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${id}-tab-${key}`}
              className="settings-tab"
              data-section={key}
              data-testid={`settings-section-${key}`}
              aria-selected={section === key}
              aria-controls={panelId}
              tabIndex={section === key ? 0 : -1}
              onClick={() => setSection(key)}
            >
              <Icon {...ICON} />
              {label}
            </button>
          ))}
        </div>
        <div
          className="settings-panel"
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${section}`}
          data-testid={`settings-panel-${section}`}
        >
          <h3 className="settings-panel-title">{current.label}</h3>
          {section === 'appearance' && <AppearanceSection family={family} setFamily={setFamily} />}
          {section === 'terminal' && <TerminalColoursField onPick={setPicking} />}
          {section === 'shell' && <ShellField />}
          {section === 'editor' && <EditorField />}
          {section === 'agents' && <AgentsSection />}
          {section === 'shortcuts' && (
            <ShortcutsSection
              keymap={resolveKeymap(settings.shortcuts, window.drovr.platform)}
              globalShortcut={settings.globalShortcut}
            />
          )}
          {section === 'sync' && <SyncFolderField id={`${id}-sync`} errorId={`${id}-sync-error`} />}
          {section === 'about' && <AboutSection onCheck={close} />}
        </div>
      </div>
      <div className="modal-actions settings-footer">
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
 * Appearance: the app theme, and the terminals' font size (typed, or stepped with the buttons and
 * the arrow keys) and family (applied on blur or Enter, empty means the default). The family's
 * draft lives in the dialog, so closing from another section still applies it.
 */
function AppearanceSection({
  family,
  setFamily
}: {
  family: string
  setFamily: (family: string) => void
}): React.JSX.Element {
  const settings = useSettings()
  const id = useId()
  const [sizeText, setSizeText] = useState(() => String(settingsStore.get().fontSize))
  const [sizeInvalid, setSizeInvalid] = useState(false)

  const changeSize = (text: string): void => {
    setSizeText(text)
    const size = parseFontSize(text)
    setSizeInvalid(size === null)
    if (size !== null) settingsStore.update({ fontSize: size })
  }
  const step = (by: number): void => {
    const size = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, settings.fontSize + by))
    changeSize(String(size))
  }
  const applyFamily = (): void => {
    if (settingsStore.update({ fontFamily: family })) {
      setFamily(fontFamilyField(settingsStore.get().fontFamily))
    }
  }

  // The list: installed fonts, plus the saved one when it isn't installed here (e.g. synced).
  const installed = installedFonts()
  const choice = fontChoiceOf(settings.fontFamily)
  // Shown for a custom family, and kept while editing even when it becomes the default.
  const [showCustom, setShowCustom] = useState(() => choice.kind === 'custom')
  const fonts = FONT_CHOICES.filter(
    (name) => installed.has(name) || (choice.kind === 'font' && choice.name === name)
  )
  const fontValue = showCustom ? CUSTOM_FONT : choice.kind === 'font' ? choice.name : ''
  // Picking a font applies it at once; the custom draft follows, so closing doesn't undo it.
  const pickFont = (value: string): void => {
    if (value === CUSTOM_FONT) {
      setShowCustom(true)
      return
    }
    setShowCustom(false)
    const next = value === '' ? DEFAULT_FONT_FAMILY : familyOf(value)
    settingsStore.update({ fontFamily: next })
    setFamily(fontFamilyField(next))
  }

  const sizeId = `${id}-size`
  const sizeErrorId = `${id}-size-error`
  const familyId = `${id}-family`
  return (
    <>
      <fieldset className="settings-row">
        <legend className="settings-label">Theme</legend>
        <div className="segmented">
          {THEMES.map((theme) => {
            const Icon = THEME_ICONS[theme]
            return (
              <label key={theme} className="radio">
                <input
                  type="radio"
                  name={`${id}-theme`}
                  value={theme}
                  data-testid={`settings-theme-${theme}`}
                  checked={settings.theme === theme}
                  onChange={() => settingsStore.update({ theme })}
                />
                <Icon {...SMALL_ICON} />
                {THEME_LABELS[theme]}
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="settings-row">
        <label className="settings-label" htmlFor={sizeId}>
          Font size
        </label>
        <div className="settings-control">
          <div className="stepper">
            <button
              type="button"
              className="stepper-btn"
              aria-label="Smaller font"
              disabled={settings.fontSize <= MIN_FONT_SIZE}
              onClick={() => step(-1)}
            >
              <Minus {...SMALL_ICON} />
            </button>
            <input
              id={sizeId}
              className="stepper-input"
              data-testid="settings-font-size"
              inputMode="numeric"
              value={sizeText}
              autoComplete="off"
              aria-invalid={sizeInvalid ? true : undefined}
              aria-describedby={sizeInvalid ? sizeErrorId : undefined}
              onChange={(e) => changeSize(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                step(e.key === 'ArrowUp' ? 1 : -1)
              }}
            />
            <button
              type="button"
              className="stepper-btn"
              aria-label="Larger font"
              disabled={settings.fontSize >= MAX_FONT_SIZE}
              onClick={() => step(1)}
            >
              <Plus {...SMALL_ICON} />
            </button>
          </div>
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
      </div>
      <div className="settings-row">
        <label className="settings-label" htmlFor={familyId}>
          Font family
        </label>
        <div className="settings-control">
          <select
            id={familyId}
            className="settings-input"
            data-testid="settings-font-choice"
            value={fontValue}
            onChange={(e) => pickFont(e.target.value)}
          >
            <option value="">{DEFAULT_FONT_LABEL}</option>
            {fonts.map((name) => (
              <option key={name} value={name} style={{ fontFamily: familyOf(name) }}>
                {installed.has(name) ? name : `${name} (not installed)`}
              </option>
            ))}
            <option value={CUSTOM_FONT}>Custom…</option>
          </select>
          {showCustom && (
            <input
              className="settings-input"
              data-testid="settings-font-family"
              aria-label="Custom font family"
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
          )}
          <p className="field-hint">
            {showCustom
              ? 'Any CSS font family, e.g. "Comic Mono", monospace. Prompt icons work with any font.'
              : 'Installed coding fonts. Prompt icons (Nerd Font glyphs) work with any font.'}
          </p>
        </div>
      </div>
      <SelectRow
        label="Line height"
        testId="settings-line-height"
        value={String(settings.lineHeight)}
        options={LINE_HEIGHTS.map((h) => [String(h), h === 1 ? '1.0 (default)' : h.toFixed(1)])}
        onChange={(v) => settingsStore.update({ lineHeight: Number(v) })}
      />
      <SelectRow
        label="Letter spacing"
        testId="settings-letter-spacing"
        value={String(settings.letterSpacing)}
        options={LETTER_SPACINGS.map((n) => [String(n), n === 0 ? '0 px (default)' : `${n} px`])}
        onChange={(v) => settingsStore.update({ letterSpacing: Number(v) })}
      />
    </>
  )
}

const OTHER_SHELL = '__other__'

const LINE_HEIGHTS = Array.from({ length: 11 }, (_, i) => Math.round((1 + i / 10) * 10) / 10)
const LETTER_SPACINGS = Array.from({ length: MAX_LETTER_SPACING + 1 }, (_, i) => i)
const CURSOR_LABELS: Record<CursorStyle, string> = {
  block: 'Block',
  bar: 'Bar',
  underline: 'Underline'
}
const BELL_LABELS: Record<Bell, string> = { none: 'None', flash: 'Flash', sound: 'Sound' }

/** A setting with its label on the left and an on/off switch on the right. */
function SwitchRow({
  label,
  hint,
  testId,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint?: string
  testId: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <div className="settings-control">
        <span className="switch">
          <input
            id={id}
            type="checkbox"
            role="switch"
            data-testid={testId}
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
        </span>
        {hint && <p className="field-hint">{hint}</p>}
      </div>
    </div>
  )
}

/** The version running, and Check for Updates, which closes Settings for the update popup. */
function AboutSection({ onCheck }: { onCheck: () => void }): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    let live = true
    void window.drovr.update.state().then(({ current }) => {
      if (live) setVersion(current)
    })
    return () => {
      live = false
    }
  }, [])
  return (
    <div className="settings-row">
      <span className="settings-label">Version</span>
      <div className="settings-control">
        <span data-testid="settings-version">{version}</span>
        <button
          type="button"
          className="btn btn-small"
          data-testid="settings-check-updates"
          onClick={() => {
            onCheck()
            window.drovr.update.check()
          }}
        >
          Check for Updates
        </button>
        <p className="field-hint">
          Drovr checks GitHub for a new version at launch and every few hours.
        </p>
      </div>
    </div>
  )
}

/** A setting chosen from a short list, as a select. */
function SelectRow({
  label,
  hint,
  testId,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  testId: string
  value: string
  options: [value: string, label: string][]
  onChange: (value: string) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        {label}
      </label>
      <div className="settings-control">
        <select
          id={id}
          className="settings-input settings-select-short"
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
        {hint && <p className="field-hint">{hint}</p>}
      </div>
    </div>
  )
}

/** A setting with a few choices side by side, as a segmented control. */
function SegmentedRow<T extends string>({
  label,
  testId,
  value,
  labels,
  onChange
}: {
  label: string
  testId: string
  value: T
  labels: Record<T, string>
  onChange: (value: T) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <fieldset className="settings-row">
      <legend className="settings-label">{label}</legend>
      <div className="segmented">
        {(Object.keys(labels) as T[]).map((key) => (
          <label key={key} className="radio">
            <input
              type="radio"
              name={`${id}-${testId}`}
              data-testid={`${testId}-${key}`}
              checked={value === key}
              onChange={() => onChange(key)}
            />
            {labels[key]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** The terminal's behaviour: cursor, bold colours, scrollback, bell, input and shell integration. */
function TerminalBehaviourRows(): React.JSX.Element {
  const settings = useSettings()
  return (
    <>
      <SegmentedRow
        label="Cursor"
        testId="settings-cursor"
        value={settings.cursorStyle}
        labels={CURSOR_LABELS}
        onChange={(cursorStyle) => settingsStore.update({ cursorStyle })}
      />
      <SwitchRow
        label="Blinking cursor"
        testId="settings-cursor-blink"
        checked={settings.cursorBlink}
        onChange={(cursorBlink) => settingsStore.update({ cursorBlink })}
      />
      <SwitchRow
        label="Bold in bright colours"
        hint="Bold text uses the bright ANSI colours, as most terminals do."
        testId="settings-bold-bright"
        checked={settings.boldBright}
        onChange={(boldBright) => settingsStore.update({ boldBright })}
      />
      <SelectRow
        label="Scrollback"
        hint="Lines each terminal keeps above the screen; more use more memory per card."
        testId="settings-scrollback"
        value={String(settings.scrollback)}
        options={SCROLLBACK_CHOICES.map((n) => [String(n), `${n.toLocaleString('en-US')} lines`])}
        onChange={(v) => settingsStore.update({ scrollback: Number(v) })}
      />
      <SwitchRow
        label="Keep output after a card stops"
        hint="A card's output stays on this machine and is shown above its next start. Turning this off deletes all kept output."
        testId="settings-keep-output"
        checked={settings.keepOutput}
        onChange={(keepOutput) => settingsStore.update({ keepOutput })}
      />
      <SegmentedRow
        label="Bell"
        testId="settings-bell"
        value={settings.bell}
        labels={BELL_LABELS}
        onChange={(bell) => settingsStore.update({ bell })}
      />
      <SwitchRow
        label="Copy on select"
        hint="Selecting text in a terminal copies it."
        testId="settings-copy-on-select"
        checked={settings.copyOnSelect}
        onChange={(copyOnSelect) => settingsStore.update({ copyOnSelect })}
      />
      {window.drovr.platform === 'darwin' && (
        <SwitchRow
          label="Option as Meta"
          hint="Option+B, Option+F and Alt shortcuts reach the shell instead of typing ∫ or ƒ."
          testId="settings-option-meta"
          checked={settings.optionAsMeta}
          onChange={(optionAsMeta) => settingsStore.update({ optionAsMeta })}
        />
      )}
      <SwitchRow
        label="Shell integration"
        hint="Prompt marks and command status in zsh, bash and fish. Applies to new terminals."
        testId="settings-shell-integration"
        checked={settings.shellIntegration}
        onChange={(shellIntegration) => settingsStore.update({ shellIntegration })}
      />
    </>
  )
}

/** Agents: being told when one needs you, and Claude Code's status line. */
function AgentsSection(): React.JSX.Element {
  const settings = useSettings()
  return (
    <>
      <SwitchRow
        label="Notifications"
        hint="When an agent is waiting for you or needs your answer, unless its card is in view, and when a command that ran 10 s or more ends out of sight. The Dock shows how many are waiting."
        testId="settings-notifications"
        checked={settings.notifications}
        onChange={(notifications) => settingsStore.update({ notifications })}
      />
      <SwitchRow
        label="Notification sound"
        testId="settings-notification-sound"
        checked={settings.notificationSound}
        disabled={!settings.notifications}
        onChange={(notificationSound) => settingsStore.update({ notificationSound })}
      />
      <SwitchRow
        label="Claude Code status"
        hint="Claude Code cards write a one-line status after every turn. Applies to cards started from now on."
        testId="settings-claude-status"
        checked={settings.claudeStatus}
        onChange={(claudeStatus) => settingsStore.update({ claudeStatus })}
      />
    </>
  )
}

const EDITOR_LABELS: Record<Editor, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  zed: 'Zed',
  system: 'System default',
  custom: 'Custom command'
}

/**
 * The Editor section (#55 D14): what the side panel's Files tab opens a file with, and the custom
 * command's one-line text, applied as it is typed.
 */
function EditorField(): React.JSX.Element {
  const { editor, editorCommand } = useSettings()
  const id = useId()
  const selectId = `${id}-editor`
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={selectId}>
        Open files with
      </label>
      <div className="settings-control">
        <select
          id={selectId}
          className="settings-input"
          data-testid="settings-editor"
          value={editor}
          onChange={(e) => settingsStore.update({ editor: e.target.value as Editor })}
        >
          {EDITORS.map((choice) => (
            <option key={choice} value={choice}>
              {EDITOR_LABELS[choice]}
            </option>
          ))}
        </select>
        {editor === 'custom' && (
          <input
            className="settings-input"
            data-testid="settings-editor-command"
            aria-label="Custom command"
            value={editorCommand}
            placeholder="subl -n"
            maxLength={MAX_EDITOR_COMMAND_LENGTH}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => settingsStore.update({ editorCommand: e.target.value })}
          />
        )}
        <p className="field-hint">
          {editor === 'custom'
            ? 'Run by your shell with the file’s path added at the end.'
            : editor === 'system'
              ? 'The app your system opens the file with.'
              : 'Opens the card’s folder with the file in it.'}
        </p>
      </div>
    </div>
  )
}

/** A shell's name and where it is: `fish — /opt/homebrew/bin/fish`. */
function shellLabel(path: string): string {
  return `${path.slice(path.lastIndexOf('/') + 1)} — ${path}`
}

/**
 * The Shell section: the login shell, the shells found on this machine, or another absolute path
 * (applied on blur or Enter). New cards and panes start it; running ones keep theirs. SSH cards
 * are unaffected.
 */
function ShellField(): React.JSX.Element {
  const { shell } = useSettings()
  const id = useId()
  const [choices, setChoices] = useState<ShellChoices | null>(null)
  const [other, setOther] = useState(false)
  const [path, setPath] = useState(shell)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    let live = true
    void window.drovr.settings.shells().then((c) => live && setChoices(c))
    return () => {
      live = false
    }
  }, [])

  const listed = shell === '' || (choices?.shells.includes(shell) ?? true)
  const showOther = other || !listed
  const applyPath = (): void => {
    const typed = path.trim()
    const ok = typed !== '' && isShellSetting(typed)
    setInvalid(!ok)
    if (ok) settingsStore.update({ shell: typed })
  }

  const selectId = `${id}-shell`
  const errorId = `${id}-shell-error`
  return (
    <div className="settings-row">
      <label className="settings-label" htmlFor={selectId}>
        Shell
      </label>
      <div className="settings-control">
        <select
          id={selectId}
          className="settings-input"
          data-testid="settings-shell"
          value={showOther ? OTHER_SHELL : shell}
          onChange={(e) => {
            const value = e.target.value
            setInvalid(false)
            if (value === OTHER_SHELL) {
              setOther(true)
              setPath(shell)
              return
            }
            setOther(false)
            settingsStore.update({ shell: value })
          }}
        >
          <option value="">
            {choices ? `Login shell — ${shellLabel(choices.login)}` : 'Login shell'}
          </option>
          {choices?.shells.map((s) => (
            <option key={s} value={s}>
              {shellLabel(s)}
            </option>
          ))}
          <option value={OTHER_SHELL}>Other…</option>
        </select>
        {showOther && (
          <input
            className="settings-input"
            data-testid="settings-shell-path"
            aria-label="Shell path"
            value={path}
            placeholder="/path/to/shell"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? errorId : undefined}
            onChange={(e) => setPath(e.target.value)}
            onBlur={applyPath}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              applyPath()
            }}
          />
        )}
        {invalid && (
          <p className="field-error" id={errorId} role="alert" data-testid="settings-error-shell">
            {SHELL_NOT_ABSOLUTE}
          </p>
        )}
        <p className="field-hint">New cards and panes start it; SSH cards use the remote shell.</p>
      </div>
    </div>
  )
}

/** The last two parts of a config path, the whole of it in the tooltip. */
function shortPath(path: string): string {
  const parts = path.split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path
}

/** The resolved app appearance, following the OS under System. */
function useResolvedTheme(): ResolvedTheme {
  const { theme } = useSettings()
  const osDark = useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  return resolveTheme(theme, osDark)
}

/**
 * The Terminal section: where the colours come from, Drovr's built-in themes (one for the dark
 * app theme, one for the light, each picked in the theme picker) or the user's Ghostty config
 * (with what was read and Reload), then a preview of the terminal in the colours and font in
 * effect now.
 */
function TerminalColoursField({
  onPick
}: {
  onPick: (appearance: ResolvedTheme) => void
}): React.JSX.Element {
  const settings = useSettings()
  const ghostty = useGhosttyTheme()
  const resolved = useResolvedTheme()
  const id = useId()
  const [reading, setReading] = useState(false)
  const reload = (): void => {
    setReading(true)
    void ghosttyStore.reload().finally(() => setReading(false))
  }

  const useGhostty = settings.useGhosttyTheme
  const palette = terminalPalette(settings, resolved, ghosttyStore.palettes())
  return (
    <>
      <fieldset className="settings-row">
        <legend className="settings-label">Colours</legend>
        <div className="segmented">
          {(
            [
              [false, 'Built-in themes', 'settings-colours-builtin'],
              [true, 'From Ghostty', 'settings-use-ghostty']
            ] as const
          ).map(([value, label, testId]) => (
            <label key={label} className="radio">
              <input
                type="radio"
                name={`${id}-colours`}
                data-testid={testId}
                checked={useGhostty === value}
                onChange={() => {
                  settingsStore.update({ useGhosttyTheme: value })
                  if (value) reload()
                }}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {!useGhostty &&
        (['dark', 'light'] as const).map((appearance) => {
          const name =
            appearance === 'dark' ? settings.terminalThemeDark : settings.terminalThemeLight
          const theme = terminalTheme(name)!
          return (
            <div key={appearance} className="settings-row">
              <span className="settings-label" id={`${id}-${appearance}`}>
                {appearance === 'dark' ? 'Dark app theme' : 'Light app theme'}
              </span>
              <div className="settings-control">
                <button
                  type="button"
                  className="btn theme-choice-btn"
                  data-testid={`settings-terminal-theme-${appearance}`}
                  aria-labelledby={`${id}-${appearance} ${id}-${appearance}-name`}
                  onClick={() => onPick(appearance)}
                >
                  <span className="theme-chips" style={{ background: theme.background }}>
                    {ANSI_COLOUR_NAMES.slice(1, 7).map((c) => (
                      <span key={c} style={{ background: theme[c] }} />
                    ))}
                  </span>
                  <span id={`${id}-${appearance}-name`}>{name}</span>
                  <ChevronRight {...SMALL_ICON} className="theme-choice-chevron" />
                </button>
              </div>
            </div>
          )
        })}
      {useGhostty && (
        <div className="settings-row">
          <span className="settings-label">Ghostty</span>
          <div className="settings-control ghostty-status">
            <div className="ghostty-status-line">
              <p className="field-hint" data-testid="settings-ghostty-status">
                {ghostty === null ? (
                  'Reading the Ghostty config…'
                ) : ghostty.files.length === 0 ? (
                  'No Ghostty config found: Ghostty’s default colours.'
                ) : (
                  <>
                    {ghostty.theme === null
                      ? 'No theme set'
                      : `Theme: ${ghostty.theme.replace(/,\s*/g, ', ')}`}
                    {' · from '}
                    <span title={ghostty.files.join('\n')}>
                      {ghostty.files.map(shortPath).join(', ')}
                    </span>
                  </>
                )}
              </p>
              <button
                type="button"
                className="icon-btn"
                data-testid="settings-ghostty-reload"
                aria-label="Reload the Ghostty config"
                title="Reload the Ghostty config"
                disabled={reading}
                onClick={reload}
              >
                <RotateCw {...SMALL_ICON} />
              </button>
            </div>
            {ghostty?.problems.map((problem) => (
              <p key={problem} className="field-error" data-testid="settings-ghostty-problem">
                {problem}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="settings-preview">
        <span className="settings-label">Preview</span>
        <TerminalPreview
          palette={palette}
          fontFamily={withSymbols(settings.fontFamily)}
          fontSize={settings.fontSize}
        />
      </div>
      <TerminalBehaviourRows />
    </>
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
    <div className="settings-row">
      <label className="settings-label" htmlFor={id}>
        Sync folder
      </label>
      <div className="settings-control">
        <div className="field-row">
          <input
            id={id}
            className="settings-input"
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
        <p className="field-hint">
          A folder your own sync tool (iCloud Drive, Dropbox, Syncthing…) carries between machines;
          the board follows you. Empty turns sync off.
        </p>
      </div>
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
function ShortcutsSection({
  keymap,
  globalShortcut
}: {
  keymap: Keymap
  /** Refused to every in-app action (#51 D5). */
  globalShortcut?: string
}): React.JSX.Element {
  const platform = window.drovr.platform
  const defaults = defaultKeymap(platform)
  const id = useId()
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  // A refusal belongs to one action: the field being recorded, or the Reset just pressed.
  const [refusal, setRefusal] = useState<{ action: ShortcutAction; message: string } | null>(null)

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
    const result = recordPress(event.nativeEvent, action, keymap, platform, globalShortcut)
    if (result.kind === 'cancel') stop()
    else if (result.kind === 'refused') setRefusal({ action, message: result.message })
    else if (result.kind === 'set') {
      apply(action, result.shortcut)
      stop()
    }
  }

  return (
    <fieldset className="field shortcuts" data-testid="settings-shortcuts">
      <legend className="visually-hidden">Shortcuts</legend>
      {SHORTCUT_ACTIONS.map((action) => {
        const labelId = `${id}-${action}`
        const errorId = `${id}-${action}-error`
        const isRecording = recording === action
        const error = refusal?.action === action ? refusal.message : null
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
                {isRecording && error === null ? (
                  'Press a shortcut…'
                ) : (
                  <ShortcutKeys shortcut={keymap[action]} platform={platform} />
                )}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-small shortcut-reset"
              data-testid={`settings-shortcut-reset-${action}`}
              aria-label={`Reset ${SHORTCUT_LABELS[action]}`}
              disabled={keymap[action] === defaults[action]}
              onClick={() => {
                if (isRecording) stop()
                // The default may be another action's shortcut now: refused, the value stays.
                const message = resetRefusal(action, keymap, platform, globalShortcut)
                if (message !== null) {
                  setRefusal({ action, message })
                  return
                }
                setRefusal(null)
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
