import { describe, expect, it } from 'vitest'
import { agentDuration, agentRows, foldAgentRows } from './agent-rows'
import type { AgentTask } from './agent-summary'

describe("the Agents group's rows (#75 D8)", () => {
  it('starts with the main agent, Running while the activity is working, else Idle', () => {
    expect(agentRows('working')).toEqual([{ kind: 'main', name: 'Main agent', status: 'running' }])
    for (const activity of ['waiting', 'question', undefined] as const) {
      expect(agentRows(activity)).toEqual([{ kind: 'main', name: 'Main agent', status: 'idle' }])
    }
  })
})

const task = (
  id: string,
  kind: AgentTask['kind'],
  status: AgentTask['status'],
  extra: Partial<AgentTask> = {}
): AgentTask => ({
  id,
  kind,
  name: id,
  description: null,
  status,
  startedAt: 1000,
  endedAt: status === 'running' ? null : 4000,
  toolUses: null,
  ...extra
})

describe("the Agents group's subagent and background rows (#75 D8)", () => {
  it('lists them newest first after the main agent, a background command stopped with its shell', () => {
    const agents = [
      task('explore', 'subagent', 'running', { description: 'Find it', toolUses: 3 }),
      task('dev', 'background', 'running')
    ]
    expect(agentRows('waiting', agents, true)).toEqual([
      { kind: 'main', name: 'Main agent', status: 'idle' },
      {
        kind: 'background',
        id: 'dev',
        name: 'dev',
        description: null,
        status: 'running',
        startedAt: 1000,
        endedAt: null,
        toolUses: null
      },
      {
        kind: 'subagent',
        id: 'explore',
        name: 'explore',
        description: 'Find it',
        status: 'running',
        startedAt: 1000,
        endedAt: null,
        toolUses: 3
      }
    ])
    expect(agentRows(undefined, agents, false).map((r) => r.status)).toEqual([
      'idle',
      'stopped',
      'running'
    ])
  })

  it('reads a live duration while running and the ended one after', () => {
    const [, running, done] = agentRows(undefined, [
      task('a', 'subagent', 'done'),
      task('b', 'subagent', 'running')
    ])
    expect(agentDuration(running, 42_000)).toBe(41_000)
    expect(agentDuration(done, 42_000)).toBe(3000)
    expect(agentDuration({ kind: 'main', name: 'Main agent', status: 'idle' }, 1)).toBeNull()
  })

  it('folds finished rows older than the latest 5 into one, keeping running ones', () => {
    const agents = [
      task('old-running', 'subagent', 'running'),
      ...Array.from({ length: 7 }, (_, i) => task(`done${i}`, 'background', 'done'))
    ]
    const { shown, finished } = foldAgentRows(agentRows(undefined, agents))
    expect(shown.map((r) => r.name)).toEqual([
      'Main agent',
      'done6',
      'done5',
      'done4',
      'done3',
      'done2',
      'old-running'
    ])
    expect(finished.map((r) => r.name)).toEqual(['done1', 'done0'])
    expect(foldAgentRows(agentRows(undefined, agents.slice(0, 6))).finished).toEqual([])
  })
})
