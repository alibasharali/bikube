import { useId, useSyncExternalStore } from 'react'
import {
  APP_THEME_TOKENS,
  APP_THEMES,
  type AppThemeId,
  type AppThemeTokens
} from '../../core/app-themes'
import type { ResolvedTheme } from '../../core/settings'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The version (dark or light) the window shows now: the native theme main sets from Theme. */
function useShownVersion(): ResolvedTheme {
  const dark = useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(DARK_QUERY)
      query.addEventListener('change', listener)
      return () => query.removeEventListener('change', listener)
    },
    () => window.matchMedia(DARK_QUERY).matches
  )
  return dark ? 'dark' : 'light'
}

/** `tokens` as the stylesheet's custom properties, so the preview draws with the theme's colours. */
function tokenStyle(tokens: AppThemeTokens): React.CSSProperties {
  return Object.fromEntries(
    APP_THEME_TOKENS.map((token) => [`--${token}`, tokens[token]])
  ) as React.CSSProperties
}

/**
 * The App theme row (#64 D8): one tile per theme in D2's order, each a small preview of the
 * version the window shows now (a mini sidebar, a column holding a card, the accent and the three
 * activity pills) in that theme's own colours, its name under it. The tiles are real radios of
 * one group, so the arrow keys move and pick and Tab enters and leaves it; picking applies and
 * saves at once through `onPick`.
 */
export default function AppThemePicker({
  value,
  onPick
}: {
  value: AppThemeId
  onPick: (id: AppThemeId) => void
}): React.JSX.Element {
  const id = useId()
  const version = useShownVersion()
  const labelId = `${id}-label`
  return (
    <div className="settings-row">
      <span className="settings-label" id={labelId}>
        App theme
      </span>
      <div
        className="app-theme-grid"
        role="radiogroup"
        aria-labelledby={labelId}
        data-version={version}
      >
        {APP_THEMES.map((theme) => (
          <label key={theme.id} className="app-theme-tile" data-testid={`app-theme-${theme.id}`}>
            <input
              type="radio"
              name={`${id}-app-theme`}
              value={theme.id}
              checked={value === theme.id}
              onChange={() => onPick(theme.id)}
            />
            <span className="app-theme-frame" aria-hidden="true">
              <span className="app-theme-preview" style={tokenStyle(theme[version])}>
                <span className="atp-sidebar">
                  <span className="atp-row atp-row-active">
                    <span className="atp-dot" />
                  </span>
                  <span className="atp-row" />
                  <span className="atp-row" />
                </span>
                <span className="atp-board">
                  <span className="atp-column">
                    <span className="atp-card">
                      <span className="atp-title" />
                      <span className="atp-pills">
                        <span className="atp-pill atp-working" />
                        <span className="atp-pill atp-waiting" />
                        <span className="atp-pill atp-question" />
                      </span>
                    </span>
                  </span>
                </span>
              </span>
            </span>
            <span className="app-theme-name">{theme.name}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
