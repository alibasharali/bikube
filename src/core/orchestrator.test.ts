import { describe, expect, it } from 'vitest'
import {
  ORCHESTRATOR_FIRST_PROMPT,
  findOrchestratorCard,
  findTerminalCard,
  isOrchestratorId,
  orchestratorCard,
  orchestratorId,
  orchestratorWorkspaceId
} from './orchestrator'
import { startLine } from './startup-command'
import type { Workspace } from './workspace-store'

const UUID = '11111111-2222-4333-8444-555555555555'

function workspace(extra: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Proj',
    directory: '/x/proj',
    columns: [{ id: 'c1', name: 'Todo' }],
    cards: [],
    nextCardNumber: 1,
    defaultStartup: { kind: 'claude' },
    shells: [],
    worktreeSetup: '',
    ...extra
  }
}

describe('the Orchestrator id (#81 D4)', () => {
  it('is orchestrator:<workspace id>, read back to its workspace', () => {
    expect(orchestratorId('w1')).toBe('orchestrator:w1')
    expect(isOrchestratorId('orchestrator:w1')).toBe(true)
    expect(isOrchestratorId('w1')).toBe(false)
    expect(orchestratorWorkspaceId('orchestrator:w1')).toBe('w1')
    expect(orchestratorWorkspaceId('w1')).toBeNull()
  })
})

describe('orchestratorCard (#81 D4, D8)', () => {
  it('is a card-shaped terminal titled Orchestrator in the workspace folder', () => {
    const card = orchestratorCard(workspace())!
    expect(card).toMatchObject({
      id: 'orchestrator:w1',
      columnId: '',
      title: 'Orchestrator',
      directory: '/x/proj',
      startup: { kind: 'claude' },
      agentSessionId: '',
      claudeStarted: false,
      startedAgents: []
    })
    expect(card.host).toBeUndefined()
  })

  it('carries the stored conversation', () => {
    const card = orchestratorCard(
      workspace({
        orchestrator: { agentSessionId: UUID, claudeStarted: true, startedAgents: ['codex'] }
      }),
      { kind: 'codex' }
    )!
    expect(card).toMatchObject({
      agentSessionId: UUID,
      claudeStarted: true,
      startedAgents: ['codex'],
      startup: { kind: 'codex' }
    })
  })

  it('is absent for an SSH workspace (D10)', () => {
    expect(orchestratorCard(workspace({ host: 'box', directory: '~' }))).toBeUndefined()
    expect(
      findOrchestratorCard(workspace({ host: 'box', directory: '~' }), 'orchestrator:w1')
    ).toBeUndefined()
  })

  it('is found by its id only', () => {
    expect(findOrchestratorCard(workspace(), 'orchestrator:w1')?.title).toBe('Orchestrator')
    expect(findOrchestratorCard(workspace(), 'orchestrator:w2')).toBeUndefined()
  })
})

describe('findTerminalCard', () => {
  it('finds a card, a shell or the Orchestrator', () => {
    const ws = workspace({
      cards: [
        {
          id: 'k1',
          columnId: 'c1',
          title: 'Card',
          directory: '/x/proj',
          startup: { kind: 'claude' },
          agentSessionId: UUID,
          claudeStarted: false,
          startedAgents: []
        }
      ],
      shells: [{ id: 's1', name: 'Dev', command: '', autostart: false, type: 'shell' }]
    })
    expect(findTerminalCard(ws, 'k1')?.title).toBe('Card')
    expect(findTerminalCard(ws, 's1')?.title).toBe('Dev')
    expect(findTerminalCard(ws, 'orchestrator:w1')?.title).toBe('Orchestrator')
    expect(findTerminalCard(ws, 'nope')).toBeUndefined()
  })
})

describe("the Orchestrator's start line (#81 D8, D15, AC3, AC5)", () => {
  const stored = { agentSessionId: UUID, claudeStarted: false, startedAgents: [] }

  it('runs Claude Code with its session id, no prompt', () => {
    const card = orchestratorCard(workspace({ orchestrator: stored }))!
    expect(startLine(card)).toBe(
      `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --session-id ${UUID} || ` +
        `claude --settings "$BIKUBE_CLAUDE_SETTINGS" --resume ${UUID}`
    )
  })

  it('resumes Claude Code once started', () => {
    const card = orchestratorCard(workspace({ orchestrator: { ...stored, claudeStarted: true } }))!
    expect(
      startLine(card)?.startsWith(`claude --settings "$BIKUBE_CLAUDE_SETTINGS" --resume`)
    ).toBe(true)
  })

  it("passes a preset D15's first prompt, quoted for every shell, on a fresh start only", () => {
    const quoted = `'${ORCHESTRATOR_FIRST_PROMPT.replace(/'/g, `'\\''`)}'`
    expect(ORCHESTRATOR_FIRST_PROMPT).toBe(
      "You are this Bikube workspace's orchestrator. Run: board guide  Read it, then say in one " +
        'line that you are ready.'
    )
    const codex = orchestratorCard(workspace({ orchestrator: stored }), { kind: 'codex' })!
    expect(startLine(codex)).toBe(`codex ${quoted}`)
    const gemini = orchestratorCard(workspace({ orchestrator: stored }), { kind: 'gemini' })!
    expect(startLine(gemini)).toBe(`gemini -i ${quoted}`)
    const resumed = orchestratorCard(
      workspace({ orchestrator: { ...stored, startedAgents: ['codex'] } }),
      { kind: 'codex' }
    )!
    expect(startLine(resumed)).toBe('codex resume --last || codex')
  })

  it('types a Custom command as it is', () => {
    const card = orchestratorCard(workspace({ orchestrator: stored }), {
      kind: 'custom',
      command: 'my-agent'
    })!
    expect(startLine(card)).toBe('my-agent')
  })
})
