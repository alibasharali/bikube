import { describe, expect, it } from 'vitest'
import { agentRows } from './agent-rows'

describe("the Agents group's rows (#75 D8)", () => {
  it('starts with the main agent, Running while the activity is working, else Idle', () => {
    expect(agentRows('working')).toEqual([{ kind: 'main', name: 'Main agent', status: 'running' }])
    for (const activity of ['waiting', 'question', undefined] as const) {
      expect(agentRows(activity)).toEqual([{ kind: 'main', name: 'Main agent', status: 'idle' }])
    }
  })
})
