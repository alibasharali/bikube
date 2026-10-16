import { describe, expect, it } from 'vitest'
import {
  STARTUP_CHOICES,
  draftStartup,
  parseChoice,
  presetHint,
  sameDraft,
  startupDraft
} from './startup-form'

describe('startup command field (D9, D10, D11)', () => {
  it('shows a Shell or Claude Code command as its choice with an empty Command', () => {
    expect(startupDraft({ kind: 'shell' })).toEqual({ choice: 'shell', command: '' })
    expect(startupDraft({ kind: 'claude' })).toEqual({ choice: 'claude', command: '' })
  })

  it('prefills Command with a Custom command', () => {
    expect(startupDraft({ kind: 'custom', command: 'codex resume --last' })).toEqual({
      choice: 'custom',
      command: 'codex resume --last'
    })
  })

  it('turns the choice back into a startup command, dropping Command unless Custom', () => {
    expect(draftStartup({ choice: 'shell', command: 'ignored' })).toEqual({ kind: 'shell' })
    expect(draftStartup({ choice: 'claude', command: 'ignored' })).toEqual({ kind: 'claude' })
    expect(draftStartup({ choice: 'custom', command: ' ls ' })).toEqual({
      kind: 'custom',
      command: ' ls '
    })
  })

  it('compares drafts by what they would start, so a stray Command does not count', () => {
    const shell = startupDraft({ kind: 'shell' })
    expect(sameDraft(shell, { choice: 'shell', command: 'typed then switched' })).toBe(true)
    expect(sameDraft(shell, { choice: 'claude', command: '' })).toBe(false)
    expect(sameDraft({ choice: 'custom', command: 'a' }, { choice: 'custom', command: 'b' })).toBe(
      false
    )
  })

  it("reads a select's value as a choice, anything unknown as Shell", () => {
    expect(parseChoice('claude')).toBe('claude')
    expect(parseChoice('custom')).toBe('custom')
    expect(parseChoice('shell')).toBe('shell')
    expect(parseChoice('cursor')).toBe('shell')
  })
})

describe('agent presets in the field (#21 D4, D5)', () => {
  it('lists every choice in select order with its label (AC1)', () => {
    // No Shell: a card is an agent session; plain shells are the workspace's Shells.
    expect(STARTUP_CHOICES.map((c) => c.label)).toEqual([
      'Claude Code',
      'Codex',
      'Gemini CLI',
      'OpenCode',
      'Custom…'
    ])
    for (const { choice } of STARTUP_CHOICES) expect(parseChoice(choice)).toBe(choice)
  })

  it('keeps a preset as its own choice, with no Command', () => {
    expect(startupDraft({ kind: 'gemini' })).toEqual({ choice: 'gemini', command: '' })
    expect(draftStartup({ choice: 'opencode', command: 'ignored' })).toEqual({ kind: 'opencode' })
  })

  it('hints that a preset resumes the latest session in the directory, nothing otherwise (AC5)', () => {
    expect(presetHint('gemini')).toBe(
      "Resumes the latest Gemini CLI session in the card's directory."
    )
    expect(presetHint('codex')).toBe("Resumes the latest Codex session in the card's directory.")
    expect(presetHint('opencode')).toBe(
      "Resumes the latest OpenCode session in the card's directory."
    )
    for (const choice of ['shell', 'claude', 'custom'] as const)
      expect(presetHint(choice)).toBeNull()
  })
})
