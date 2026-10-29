import { describe, expect, it } from 'vitest'
import { AGENT_TAB_GROUPS, collapsedAgentGroups, toggleAgentGroup } from './agent-tab-groups'

describe("the Agent tab's groups (#75 D6)", () => {
  it('lists Agents, What changed and Commands, all open the first time', () => {
    expect(AGENT_TAB_GROUPS.map((g) => g.name)).toEqual(['Agents', 'What changed', 'Commands'])
    expect(collapsedAgentGroups().size).toBe(0)
  })

  it('keeps a collapsed group for every card until it is opened again', () => {
    toggleAgentGroup('commands')
    expect(collapsedAgentGroups().has('commands')).toBe(true)
    toggleAgentGroup('agents')
    expect([...collapsedAgentGroups()].sort()).toEqual(['agents', 'commands'])
    toggleAgentGroup('commands')
    expect([...collapsedAgentGroups()]).toEqual(['agents'])
  })
})
