import { describe, expect, it } from 'vitest'
import { conversationCheckTarget, transcriptBackupTarget } from './transcript-backup-target'
import type { Card } from './workspace-store'

const SESSION = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  columnId: 'todo',
  title: 'c1',
  directory: '/repo',
  startup: { kind: 'claude' },
  agentSessionId: SESSION,
  claudeStarted: true,
  startedAgents: [],
  ...over
})

describe('transcriptBackupTarget (#80 D8)', () => {
  it('names a local Claude Code card’s folder and session', () => {
    expect(transcriptBackupTarget(card())).toEqual({ folder: '/repo', sessionId: SESSION })
  })

  it('takes a worktree card’s folder, where its claude runs', () => {
    const worktree = { path: '/wt/a', branch: 'a', repo: '/repo' }
    expect(transcriptBackupTarget(card({ directory: '/wt/a', worktree }))).toEqual({
      folder: '/wt/a',
      sessionId: SESSION
    })
  })

  it('leaves out SSH cards, plain cards, presets and custom commands', () => {
    expect(transcriptBackupTarget(card({ host: 'dev' }))).toBeNull()
    expect(transcriptBackupTarget(card({ startup: { kind: 'shell' } }))).toBeNull()
    expect(transcriptBackupTarget(card({ startup: { kind: 'codex' } }))).toBeNull()
    expect(
      transcriptBackupTarget(card({ startup: { kind: 'custom', command: 'claude' } }))
    ).toBeNull()
  })
})

describe('conversationCheckTarget (#80 D11, AC12)', () => {
  it('checks a local Claude Code card that started Claude Code', () => {
    expect(conversationCheckTarget(card())).toEqual({ folder: '/repo', sessionId: SESSION })
  })

  it('skips a card that never started Claude Code, SSH cards, plain cards and presets', () => {
    expect(conversationCheckTarget(card({ claudeStarted: false }))).toBeNull()
    expect(conversationCheckTarget(card({ host: 'dev' }))).toBeNull()
    expect(conversationCheckTarget(card({ startup: { kind: 'shell' } }))).toBeNull()
    expect(conversationCheckTarget(card({ startup: { kind: 'codex' } }))).toBeNull()
  })
})
