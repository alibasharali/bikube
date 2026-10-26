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
 * Whether `program`, the name node-pty reads for a terminal's foreground process (a bare name on
 * macOS, maybe a path on Linux), is Claude Code: it sends its probe only once, so a pane that
 * turns focus reporting on again (after Ctrl+Z and `fg`) is told by this instead.
 */
export function isClaudeCodeProgram(program: string | null): boolean {
  return program?.slice(program.lastIndexOf('/') + 1) === 'claude'
}

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

/**
 * The line editing keys macOS terminals (Terminal, iTerm2, Ghostty) send, which xterm.js doesn't:
 * Cmd+Backspace deletes to the line's start (Ctrl+U), Cmd+Left and Cmd+Right go to its start and
 * end (Ctrl+A, Ctrl+E), Option+Left and Option+Right move a word (ESC b, ESC f) and
 * Option+Backspace deletes one (ESC DEL), as readline, zsh's line editor and fish read them. Null
 * for any other key, and off macOS.
 */
export function macLineEditKey(event: KeyLike, platform: string): string | null {
  if (platform !== 'darwin' || event.ctrlKey || event.shiftKey) return null
  if (event.metaKey && !event.altKey) {
    if (event.key === 'Backspace') return '\x15'
    if (event.key === 'ArrowLeft') return '\x01'
    if (event.key === 'ArrowRight') return '\x05'
  }
  if (event.altKey && !event.metaKey) {
    if (event.key === 'Backspace') return '\x1b\x7f'
    if (event.key === 'ArrowLeft') return '\x1bb'
    if (event.key === 'ArrowRight') return '\x1bf'
  }
  return null
}
