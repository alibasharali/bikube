import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import type { ShortcutAction } from '../../core/keymap'
import { currentKeymap, useSettings } from './settings'
import ShortcutKeys from './ShortcutKeys'

/** How long the pointer rests on a button before its tooltip shows, as native tooltips wait. */
const SHOW_DELAY_MS = 400

/**
 * A button's tooltip: its name, a line saying what it does, and the shortcut that does the same,
 * read from Settings so a recorded one shows at once. Shown on hover after a short wait and on
 * keyboard focus, below the button; `align` keeps it inside the window at the bar's ends.
 */
function Tooltip({
  label,
  description,
  shortcut,
  align = 'center',
  className,
  children
}: {
  label: string
  description: string
  /** The action whose shortcut the tooltip shows, none when it has none. */
  shortcut?: ShortcutAction
  align?: 'start' | 'center' | 'end'
  /** A class for the wrapper, which sits where the button would in its row. */
  className?: string
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>
}): React.JSX.Element {
  useSettings()
  const id = useId()
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const keys = shortcut ? currentKeymap()[shortcut] : ''
  const show = (): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setShown(true), SHOW_DELAY_MS)
  }
  const hide = (): void => {
    clearTimeout(timer.current)
    setShown(false)
  }
  return (
    <span
      className={className ? `tooltip-anchor ${className}` : 'tooltip-anchor'}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => {
        // Keyboard focus only: a click's focus would show it under the pointer that just left.
        if ((event.target as HTMLElement).matches(':focus-visible')) setShown(true)
      }}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide()
      }}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className="tooltip"
        data-align={align}
        data-shown={shown}
        data-testid="tooltip"
      >
        <span className="tooltip-head">
          <span className="tooltip-label">{label}</span>
          {keys && <ShortcutKeys shortcut={keys} platform={window.bikube.platform} />}
        </span>
        <span className="tooltip-description">{description}</span>
      </span>
    </span>
  )
}

export default Tooltip
