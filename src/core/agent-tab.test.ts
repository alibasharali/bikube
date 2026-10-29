import { describe, expect, it } from 'vitest'
import { AGENT_TAB_MESSAGES, agentTabSubject, isSessionId } from './agent-tab'
import { shellCard } from './workspace-shells'
import type { Card, Workspace } from './workspace-store'

const SESSION = '0b6f1c1e-5d2a-4c1b-9a8e-3f1d2c4b5a69'

const card = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  columnId: 'todo',
  title: 'c1',
  directory: '/repo',
  startup: { kind: 'claude' },
  agentSessionId: SESSION,
  claudeStarted: false,
  startedAgents: [],
  ...over
})

const workspace = (cards: Card[], over: Partial<Workspace> = {}): Workspace => ({
  id: 'w1',
  name: 'repo',
  directory: '/repo',
  columns: [{ id: 'todo', name: 'To do' }],
  cards,
  nextCardNumber: 2,
  defaultStartup: { kind: 'claude' },
  shells: [
    { id: 's1', name: 'dev', command: 'npm run dev', autostart: false, type: 'shell' },
    { id: 't1', name: 'Terminal 1', command: '', autostart: false, type: 'shell', temporary: true }
  ],
  worktreeSetup: '',
  ...over
})

describe('what the Agent tab shows (#75 D2, D3)', () => {
  it('asks the board to open a Claude Code card when no card is open', () => {
    expect(agentTabSubject(workspace([]), undefined)).toEqual({
      kind: 'message',
      text: 'Open a Claude Code card to see its agent.'
    })
  })

  it("follows a local Claude Code card's session in its own folder", () => {
    const c = card({ directory: '/data/worktrees/repo-c1' })
    expect(agentTabSubject(workspace([c]), c)).toEqual({
      kind: 'conversation',
      folder: '/data/worktrees/repo-c1',
      sessionId: SESSION
    })
  })

  it('names Claude Code cards for a card with another startup', () => {
    for (const startup of [
      { kind: 'custom', command: ':' },
      { kind: 'codex' },
      { kind: 'gemini' },
      { kind: 'opencode' },
      { kind: 'pi' }
    ] as const) {
      const c = card({ startup })
      expect(agentTabSubject(workspace([c]), c)).toEqual({
        kind: 'message',
        text: 'The Agent tab follows Claude Code cards.'
      })
    }
  })

  it('says SSH cards have no Agent tab', () => {
    const c = card({ host: 'box' })
    expect(agentTabSubject(workspace([c], { host: 'box' }), c)).toEqual({
      kind: 'message',
      text: "The Agent tab isn't available over SSH."
    })
  })

  it('asks to run claude in the Default, a named and a temporary shell', () => {
    const ws = workspace([card()])
    for (const shell of [null, ws.shells[0], ws.shells[1]]) {
      expect(agentTabSubject(ws, shellCard(ws, shell))).toEqual({
        kind: 'message',
        text: 'Run claude in this shell to see its agent here.'
      })
    }
  })

  it('has no conversation for a card without a session id', () => {
    const c = card({ agentSessionId: '' })
    expect(agentTabSubject(workspace([c]), c)).toEqual({
      kind: 'message',
      text: AGENT_TAB_MESSAGES.noConversation
    })
    expect(AGENT_TAB_MESSAGES.noConversation).toBe('No conversation yet.')
  })
})

describe('a session id (#75 D4)', () => {
  it('takes a UUID only', () => {
    expect(isSessionId(SESSION)).toBe(true)
    expect(isSessionId(SESSION.toUpperCase())).toBe(true)
    for (const bad of ['../../etc/passwd', '', `${SESSION}/x`, `${SESSION}\0`, 'abc', 42, null]) {
      expect(isSessionId(bad)).toBe(false)
    }
  })
})
