import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { findResultText, isValidRegex, type FindResults } from '../../core/find'
import type { FindQuery, XtermScreen } from './card-terminals'
import { findStore } from './find'
import { SMALL_ICON } from './icons'

/**
 * The find bar (#35 D4–D7, D10, D11) in the top-right corner of the pane it searches. It opens
 * with the remembered query selected and searches it at once; every change searches again.
 * Enter goes up (older output), Shift+Enter down; Escape or Close closes it. Unmounting clears
 * its highlights, so it closes with its view or pane. `focusRequest` changing focuses the field
 * again and selects its text. `besideClose`: an extra pane's, kept left of its close button.
 */
function FindBar({
  screen,
  focusRequest,
  onClose,
  besideClose
}: {
  screen: XtermScreen
  focusRequest: number
  onClose: () => void
  besideClose: boolean
}): React.JSX.Element {
  const [find, setFind] = useState<FindQuery>(findStore.get)
  const [results, setResults] = useState<FindResults | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  useEffect(() => {
    const unsubscribe = screen.onFindResults(setResults)
    return () => {
      unsubscribe()
      screen.clearFind()
    }
  }, [screen])

  // The screen clears the find for an empty query or an invalid regex (D5, D7).
  useEffect(() => screen.find(find), [find, screen])
  const invalid = find.regex && find.query !== '' && !isValidRegex(find.query)
  const shown: FindResults | null =
    find.query === '' ? null : invalid ? { count: 0, index: -1, invalid } : results

  const update = (change: Partial<FindQuery>): void => {
    const next = { ...find, ...change }
    findStore.set(next)
    setFind(next)
  }

  const steppable = shown !== null && !shown.invalid && shown.count > 0
  const step = (direction: 'up' | 'down'): void => {
    if (steppable) screen.findStep(find, direction)
  }

  return (
    <div
      className={besideClose ? 'find-bar find-bar-beside-close' : 'find-bar'}
      data-testid="find-bar"
      onKeyDown={(event) => {
        // Escape anywhere in the bar closes it (D10).
        if (event.key !== 'Escape') return
        event.preventDefault()
        onClose()
      }}
      role="search"
      aria-label="Find"
    >
      <input
        ref={inputRef}
        className="find-input"
        data-testid="find-input"
        type="text"
        placeholder="Find"
        aria-label="Find"
        spellCheck={false}
        value={find.query}
        onChange={(event) => update({ query: event.target.value })}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          step(event.shiftKey ? 'down' : 'up')
        }}
      />
      <span className="find-result" data-testid="find-result" aria-live="polite">
        {shown ? findResultText(shown) : ''}
      </span>
      <button
        type="button"
        className="find-button"
        data-testid="find-previous"
        aria-label="Previous match"
        title="Previous match"
        disabled={!steppable}
        onClick={() => step('down')}
      >
        <ChevronDown {...SMALL_ICON} />
      </button>
      <button
        type="button"
        className="find-button"
        data-testid="find-next"
        aria-label="Next match"
        title="Next match"
        disabled={!steppable}
        onClick={() => step('up')}
      >
        <ChevronUp {...SMALL_ICON} />
      </button>
      <button
        type="button"
        className="find-button find-toggle"
        data-testid="find-case"
        aria-label="Case sensitive"
        title="Case sensitive"
        aria-pressed={find.caseSensitive}
        onClick={() => update({ caseSensitive: !find.caseSensitive })}
      >
        <CaseSensitive {...SMALL_ICON} />
      </button>
      <button
        type="button"
        className="find-button find-toggle"
        data-testid="find-regex"
        aria-label="Regex"
        title="Regex"
        aria-pressed={find.regex}
        onClick={() => update({ regex: !find.regex })}
      >
        <Regex {...SMALL_ICON} />
      </button>
      <button
        type="button"
        className="find-button"
        data-testid="find-close"
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <X {...SMALL_ICON} />
      </button>
    </div>
  )
}

export default FindBar
