import { describe, expect, it } from 'vitest'
import { AGENT_SETUP_GROUPS, AGENT_SETUP_SECTIONS, adjacentSection } from './agent-setup-sections'

describe('Agent setup sections (#68 D7)', () => {
  it('lists the sections in four groups, in order', () => {
    expect(AGENT_SETUP_GROUPS.map((g) => g.map((s) => s.label))).toEqual([
      ['Overview', 'Status', 'Stats'],
      ['Plugins', 'MCP servers'],
      ['Skills', 'Agents', 'Commands', 'Hooks'],
      ['Memory', 'Permissions', 'Sandbox', 'Config']
    ])
    expect(AGENT_SETUP_SECTIONS.map((s) => s.id)).toEqual([
      'overview',
      'status',
      'stats',
      'plugins',
      'mcp',
      'skills',
      'agents',
      'commands',
      'hooks',
      'memory',
      'permissions',
      'sandbox',
      'config'
    ])
  })

  it('steps to the next or previous section across groups, wrapping (AC19)', () => {
    let at = adjacentSection('overview', 1)
    at = adjacentSection(at, 1)
    expect(adjacentSection(at, 1)).toBe('plugins')
    expect(adjacentSection('plugins', -1)).toBe('stats')
    expect(adjacentSection('permissions', 1)).toBe('sandbox')
    expect(adjacentSection('sandbox', 1)).toBe('config')
    expect(adjacentSection('config', 1)).toBe('overview')
    expect(adjacentSection('overview', -1)).toBe('config')
  })
})
