import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ResolvedTheme } from '../../core/settings'
import { ANSI_COLOUR_NAMES } from '../../core/terminal-appearance'
import {
  TERMINAL_THEME_NAMES,
  filterThemeNames,
  terminalTheme,
  type ThemeFilter as Filter
} from '../../core/terminal-themes'
import TerminalPreview from './TerminalPreview'

const FILTER_LABELS: Record<Filter, string> = { dark: 'Dark', light: 'Light', all: 'All' }

/**
 * Picks the terminal theme for one app appearance: a searchable list, filtered to that appearance's
 * themes at first, and a preview of the highlighted one. Arrow keys move, Enter or a double click
 * picks; the dialog's own Escape cancels.
 */
function ThemePicker({
  appearance,
  initial,
  fontFamily,
  onPick,
  onCancel
}: {
  appearance: ResolvedTheme
  initial: string
  fontFamily: string
  onPick: (name: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const id = useId()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>(appearance)
  const [highlighted, setHighlighted] = useState(initial)
  const names = useMemo(() => filterThemeNames(query, filter), [query, filter])
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, names])

  const move = (step: number): void => {
    if (names.length === 0) return
    const at = names.indexOf(highlighted)
    const next = at < 0 ? (step > 0 ? 0 : names.length - 1) : at + step
    setHighlighted(names[Math.max(0, Math.min(names.length - 1, next))]!)
  }

  const listId = `${id}-list`
  const palette = terminalTheme(highlighted)!
  return (
    <div className="theme-picker" data-testid="theme-picker">
      <div className="theme-picker-side">
        <input
          className="theme-search"
          data-testid="theme-search"
          placeholder={`Search ${TERMINAL_THEME_NAMES.length} themes`}
          aria-label="Search themes"
          aria-controls={listId}
          aria-activedescendant={
            names.includes(highlighted) ? optionId(id, highlighted) : undefined
          }
          value={query}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              move(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              onPick(highlighted)
            }
          }}
        />
        <div className="theme-filter" role="group" aria-label="Show">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className="theme-filter-btn"
              data-testid={`theme-filter-${f}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
        <ul ref={list} id={listId} className="theme-list" role="listbox" aria-label="Themes">
          {names.map((name) => {
            const theme = terminalTheme(name)!
            return (
              <li
                key={name}
                id={optionId(id, name)}
                role="option"
                aria-selected={name === highlighted}
                className="theme-option"
                data-testid="theme-option"
                data-theme={name}
                onClick={() => setHighlighted(name)}
                onDoubleClick={() => onPick(name)}
              >
                <span className="theme-option-name">{name}</span>
                <span className="theme-chips" style={{ background: theme.background }}>
                  {ANSI_COLOUR_NAMES.slice(1, 7).map((c) => (
                    <span key={c} style={{ background: theme[c] }} />
                  ))}
                </span>
              </li>
            )
          })}
          {names.length === 0 && <li className="theme-empty">No themes match</li>}
        </ul>
      </div>
      <div className="theme-picker-main">
        <div className="theme-picker-name" data-testid="theme-highlighted">
          {highlighted}
        </div>
        <TerminalPreview palette={palette} fontFamily={fontFamily} />
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="theme-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="theme-use"
            onClick={() => onPick(highlighted)}
          >
            Use theme
          </button>
        </div>
      </div>
    </div>
  )
}

function optionId(id: string, name: string): string {
  return `${id}-theme-${TERMINAL_THEME_NAMES.indexOf(name)}`
}

export default ThemePicker
