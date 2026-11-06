import { describe, expect, it } from 'vitest'
import type { OpenTerminal } from './open-terminals'
import { agentGroupOf, isAgentRow, sidebarSections } from './sidebar-sections'

const row = (
  workspaceId: string,
  cardId: string,
  tool: OpenTerminal['tool'],
  extra: Partial<OpenTerminal> = {}
): OpenTerminal => ({
  kind: tool === 'shell' ? 'shell' : 'card',
  workspaceId,
  cardId,
  title: cardId,
  tool,
  ...extra
})

const ids = (rows: readonly OpenTerminal[]): string[] => rows.map((r) => r.cardId)

describe('isAgentRow (#79 D2)', () => {
  it('counts a card whose startup command is Claude Code or an agent preset (rule 1)', () => {
    expect(isAgentRow(row('a', 'fix', 'claude'))).toBe(true)
    for (const tool of ['codex', 'gemini', 'opencode', 'pi'] as const) {
      expect(isAgentRow(row('a', tool, tool))).toBe(true)
    }
  })

  it('leaves plain cards, custom commands and shells plain', () => {
    expect(isAgentRow(row('a', 'logs', 'shell', { kind: 'card' }))).toBe(false)
    expect(isAgentRow(row('a', 'cmd', 'custom'))).toBe(false)
    expect(isAgentRow(row('a', 'default', 'shell'))).toBe(false)
  })

  it('counts any row with an activity set (rule 3), and back once it is cleared', () => {
    for (const activity of ['working', 'waiting', 'question'] as const) {
      expect(isAgentRow(row('a', 'default', 'shell', { activity }))).toBe(true)
      expect(isAgentRow(row('a', 'logs', 'custom', { activity }))).toBe(true)
    }
    expect(isAgentRow(row('a', 'default', 'shell'))).toBe(false)
  })
})

describe('agentGroupOf (#79 D4)', () => {
  it('puts waiting and question in Needs you, working in Working, none in Idle', () => {
    expect(agentGroupOf('waiting')).toBe('needsYou')
    expect(agentGroupOf('question')).toBe('needsYou')
    expect(agentGroupOf('working')).toBe('working')
    expect(agentGroupOf(undefined)).toBe('idle')
  })
})

describe('sidebarSections (#79 D3, D4, D9)', () => {
  // AC3's board: A runs Fix (Claude Code) then Logs (plain); B runs Port (Codex).
  const fix = row('A', 'Fix', 'claude')
  const logs = row('A', 'Logs', 'shell', { kind: 'card' })
  const port = row('B', 'Port', 'codex')
  const terminals = [fix, logs, port]

  it('nests only plain terminals under their workspace and lists the agents apart (AC3)', () => {
    const sections = sidebarSections(terminals, isAgentRow, 'A')
    expect(ids(sections.nested.get('A') ?? [])).toEqual(['Logs'])
    expect(sections.nested.get('B') ?? []).toEqual([])
    expect(sections.agents).toEqual([{ id: 'idle', label: 'Idle', rows: [fix, port] }])
  })

  it('groups in Needs you, Working, Idle order, leaving out empty groups (AC4)', () => {
    const working = { ...fix, activity: 'working' as const }
    const question = { ...port, activity: 'question' as const }
    const first = sidebarSections([working, logs, question], isAgentRow, 'A')
    expect(first.agents.map((g) => [g.label, ids(g.rows)])).toEqual([
      ['Needs you', ['Port']],
      ['Working', ['Fix']]
    ])
    const second = sidebarSections([working, logs, port], isAgentRow, 'A')
    expect(second.agents.map((g) => [g.label, ids(g.rows)])).toEqual([
      ['Working', ['Fix']],
      ['Idle', ['Port']]
    ])
  })

  it("keeps the Nested order within a group, so rows don't jump", () => {
    const a1 = row('A', 'a1', 'claude', { activity: 'waiting' })
    const a2 = row('A', 'a2', 'codex', { activity: 'question' })
    const b1 = row('B', 'b1', 'claude', { activity: 'question' })
    const sections = sidebarSections([a1, a2, b1], isAgentRow, 'A')
    expect(ids(sections.agents[0].rows)).toEqual(['a1', 'a2', 'b1'])
  })

  it('has no groups with no agent rows (AC7)', () => {
    expect(sidebarSections([logs], isAgentRow, 'A').agents).toEqual([])
    expect(sidebarSections([], isAgentRow, null).agents).toEqual([])
  })

  it("numbers the active workspace's rows in Nested order wherever they show (AC11)", () => {
    const sections = sidebarSections(terminals, isAgentRow, 'A')
    expect([...sections.numbers]).toEqual([
      ['Fix', 1],
      ['Logs', 2]
    ])
    expect(sidebarSections(terminals, isAgentRow, null).numbers.size).toBe(0)
  })

  it('numbers at most 9 rows', () => {
    const many = Array.from({ length: 11 }, (_, i) => row('A', `c${i}`, 'shell'))
    const numbers = sidebarSections(many, isAgentRow, 'A').numbers
    expect(numbers.size).toBe(9)
    expect(numbers.get('c8')).toBe(9)
    expect(numbers.has('c9')).toBe(false)
  })
})
