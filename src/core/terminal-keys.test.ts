import { describe, expect, it } from 'vitest'
import type { KeyLike } from './clipboard'
import {
  CLAUDE_CODE_PROBE_OSC,
  isShiftEnter,
  macLineEditKey,
  SHIFT_ENTER,
  shiftEnterIsNewLine,
  isClaudeCodeProgram
} from './terminal-keys'

const key = (over: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  shiftKey: true,
  altKey: false,
  ...over
})

describe('isShiftEnter', () => {
  it('takes Shift+Enter on keydown, keypress and keyup', () => {
    for (const type of ['keydown', 'keypress', 'keyup'])
      expect(isShiftEnter(key({ type }))).toBe(true)
  })

  it('leaves plain Enter and Enter with any other modifier alone', () => {
    expect(isShiftEnter(key({ shiftKey: false }))).toBe(false)
    expect(isShiftEnter(key({ altKey: true }))).toBe(false)
    expect(isShiftEnter(key({ ctrlKey: true }))).toBe(false)
    expect(isShiftEnter(key({ metaKey: true }))).toBe(false)
    expect(isShiftEnter(key({ key: 'a' }))).toBe(false)
  })

  it('sends ESC CR', () => {
    expect(SHIFT_ENTER).toBe('\u001b\r')
  })
})

describe('shiftEnterIsNewLine', () => {
  it("is a new line only in a Claude Code card's main pane while Claude Code runs there", () => {
    expect(shiftEnterIsNewLine(true, true)).toBe(true)
  })

  it('stays Enter at the shell after Claude Code exits, and in every other pane', () => {
    expect(shiftEnterIsNewLine(true, false)).toBe(false)
    expect(shiftEnterIsNewLine(false, true)).toBe(false)
    expect(shiftEnterIsNewLine(false, false)).toBe(false)
  })

  it("is a new line in any pane that saw Claude Code's probe, while focus reporting is on (#58 D1)", () => {
    expect(shiftEnterIsNewLine(false, true, true)).toBe(true)
    expect(shiftEnterIsNewLine(true, true, true)).toBe(true)
  })

  it('stays Enter after the probe once focus reporting is off', () => {
    expect(shiftEnterIsNewLine(false, false, true)).toBe(false)
    expect(shiftEnterIsNewLine(true, false, true)).toBe(false)
  })

  it('keeps the card rule without the probe (#58 D2)', () => {
    expect(shiftEnterIsNewLine(true, true, false)).toBe(true)
    expect(shiftEnterIsNewLine(false, true, false)).toBe(false)
  })

  it("names Claude Code's probe OSC 7501", () => {
    expect(CLAUDE_CODE_PROBE_OSC).toBe(7501)
  })
})

describe('macLineEditKey', () => {
  const press = (k: string, mods: Partial<KeyLike>): KeyLike =>
    key({ key: k, shiftKey: false, ...mods })

  it('sends the line editing keys macOS terminals send for Cmd and Option', () => {
    expect(macLineEditKey(press('Backspace', { metaKey: true }), 'darwin')).toBe('\x15')
    expect(macLineEditKey(press('ArrowLeft', { metaKey: true }), 'darwin')).toBe('\x01')
    expect(macLineEditKey(press('ArrowRight', { metaKey: true }), 'darwin')).toBe('\x05')
    expect(macLineEditKey(press('Backspace', { altKey: true }), 'darwin')).toBe('\x1b\x7f')
    expect(macLineEditKey(press('ArrowLeft', { altKey: true }), 'darwin')).toBe('\x1bb')
    expect(macLineEditKey(press('ArrowRight', { altKey: true }), 'darwin')).toBe('\x1bf')
  })

  it('leaves other keys and combinations to xterm, and every key off macOS', () => {
    expect(macLineEditKey(press('Backspace', {}), 'darwin')).toBeNull()
    expect(macLineEditKey(press('ArrowUp', { metaKey: true }), 'darwin')).toBeNull()
    expect(
      macLineEditKey(press('Backspace', { metaKey: true, shiftKey: true }), 'darwin')
    ).toBeNull()
    expect(macLineEditKey(press('ArrowLeft', { metaKey: true, altKey: true }), 'darwin')).toBeNull()
    expect(macLineEditKey(press('Backspace', { ctrlKey: true }), 'darwin')).toBeNull()
    expect(macLineEditKey(press('Backspace', { metaKey: true }), 'linux')).toBeNull()
  })
})

describe('isClaudeCodeProgram', () => {
  it('is Claude Code by name or path', () => {
    expect(isClaudeCodeProgram('claude')).toBe(true)
    expect(isClaudeCodeProgram('/opt/homebrew/bin/claude')).toBe(true)
  })

  it('is the native install, named after its version file', () => {
    expect(isClaudeCodeProgram('2.1.312')).toBe(true)
    expect(isClaudeCodeProgram('/Users/me/.local/share/claude/versions/2.1.312')).toBe(true)
  })

  it('is nothing else, nor an unknown program', () => {
    expect(isClaudeCodeProgram('zsh')).toBe(false)
    expect(isClaudeCodeProgram('claude-code-router')).toBe(false)
    expect(isClaudeCodeProgram('/usr/bin/node')).toBe(false)
    expect(isClaudeCodeProgram('/opt/tool/versions/2.1.312')).toBe(false)
    expect(isClaudeCodeProgram('2.1')).toBe(false)
    expect(isClaudeCodeProgram('')).toBe(false)
    expect(isClaudeCodeProgram(null)).toBe(false)
  })
})
