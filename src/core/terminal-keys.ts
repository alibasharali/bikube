/** Keys a terminal sends differently from xterm.js, free of Electron and DOM imports. */

import type { KeyLike } from './clipboard'

/**
 * ESC CR for Shift+Enter, as Option+Enter sends with Option as Meta: xterm.js has no kitty keyboard
 * protocol, so a plain CR would reach Claude Code as Enter. Claude Code takes it as a new line.
 */
export const SHIFT_ENTER = '\x1b\r'

/** Whether the event is Shift+Enter with no other modifier, on any of its key events. */
export function isShiftEnter(event: KeyLike): boolean {
  return (
    event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}

/**
 * The OSC Claude Code sends at startup as its program-status query (checked on 2.1.303): a
 * terminal that receives it is running Claude Code (#58 D1). It gets no reply (D3).
 */
export const CLAUDE_CODE_PROBE_OSC = 7501

/**
 * Whether Shift+Enter sends ESC CR rather than xterm's plain CR: only while focus reporting is on
 * (Claude Code turns it on while it runs and off when it exits), in a Claude Code card's main pane
 * (#58 D2) or in any pane that saw Claude Code's probe (`sawProbe`, D1). Anywhere else ESC CR
 * would misfire, e.g. bash beeps and runs nothing.
 */
export function shiftEnterIsNewLine(
  claudeCodePane: boolean,
  focusReporting: boolean,
  sawProbe = false
): boolean {
  return (claudeCodePane || sawProbe) && focusReporting
}
