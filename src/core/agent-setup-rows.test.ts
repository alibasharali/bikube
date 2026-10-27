import { describe, expect, it } from 'vitest'
import {
  fileLabel,
  filterDefinitions,
  filterMemory,
  isPluginOff,
  matchesQuery,
  sectionSummaries,
  setupWarnings,
  sourceSplit
} from './agent-setup-rows'
import type {
  AgentSetupSnapshot,
  DefinitionEntry,
  EntrySource,
  MemoryEntry
} from './agent-setup-snapshot'

// The Agent setup page's rows (#68 D12, D18, D24, D25): counts by source, search, warnings.

const kit: EntrySource = { kind: 'plugin', plugin: 'kit', key: 'kit@market' }

const def = (
  name: string,
  source: EntrySource,
  more: Partial<DefinitionEntry> = {}
): DefinitionEntry => ({
  name,
  description: null,
  file: `/f/${name}.md`,
  source,
  warnings: [],
  ...more
})

const memory = (label: string, more: Partial<MemoryEntry> = {}): MemoryEntry => ({
  label,
  file: `/f/${label}`,
  source: { kind: 'project' },
  size: 1,
  lines: 1,
  head: '',
  imports: [],
  warnings: [],
  ...more
})

function snapshot(more: Partial<AgentSetupSnapshot> = {}): AgentSetupSnapshot {
  return {
    folder: '/f',
    home: '/h',
    settings: [],
    claudeJson: {
      file: '/h/.claude.json',
      state: 'missing',
      mcpServers: {},
      localMcpServers: {},
      oauthAccount: null,
      preferences: {}
    },
    mcpJson: { file: '/f/.mcp.json', state: 'missing' },
    installedPlugins: { file: '/i', state: 'missing' },
    marketplaces: { file: '/m', state: 'missing' },
    plugins: [],
    skills: [],
    agents: [],
    commands: [],
    memory: [],
    more: {},
    fileWarnings: [],
    paths: [],
    ...more
  }
}

/** AC4's rows. */
const ac4 = snapshot({
  skills: [
    def('review', { kind: 'project' }, { description: 'Reviews the diff' }),
    def('notes', { kind: 'user' }),
    def('kit:lint', kit, { description: 'Lints the code' })
  ],
  agents: [def('tester', { kind: 'project' }), def('kit:fixer', kit)],
  memory: [memory('CLAUDE.md', { imports: [memory('docs/rules.md')] })]
})

describe('matchesQuery', () => {
  it('D25: matches case-insensitively when every space-separated term is found', () => {
    expect(matchesQuery('', ['anything'])).toBe(true)
    expect(matchesQuery('LINT', ['kit:lint'])).toBe(true)
    expect(matchesQuery('kit  code', ['kit:lint', 'Lints the code'])).toBe(true)
    expect(matchesQuery('kit nope', ['kit:lint', 'Lints the code'])).toBe(false)
  })
})

describe('sectionSummaries', () => {
  it('AC4: counts each section and splits it by source', () => {
    const summaries = sectionSummaries(ac4, '')
    expect(summaries.skills?.count).toBe(3)
    expect(summaries.agents?.count).toBe(2)
    expect(summaries.memory?.count).toBe(2)
    expect(summaries.commands?.count).toBe(0)
    expect(sourceSplit(summaries.skills!)).toBe('1 Project · 1 User · 1 Plugin')
  })

  it('AC15: with a query each count reads the matching rows', () => {
    const summaries = sectionSummaries(ac4, 'lint')
    expect(summaries.skills?.count).toBe(1)
    expect(summaries.agents?.count).toBe(0)
    expect(summaries.memory?.count).toBe(0)
    // The source is searched too.
    expect(sectionSummaries(ac4, 'plugin kit').agents?.count).toBe(1)
  })

  it('counts the rows past the folder limit', () => {
    expect(
      sectionSummaries(
        snapshot({ commands: [def('/a', { kind: 'user' })], more: { commands: 4 } }),
        ''
      ).commands?.count
    ).toBe(5)
  })
})

describe('filterDefinitions and filterMemory', () => {
  it('AC15: keeps only matching rows', () => {
    expect(filterDefinitions(ac4.skills, 'lint').map((e) => e.name)).toEqual(['kit:lint'])
    expect(filterDefinitions(ac4.skills, '')).toHaveLength(3)
  })

  it('keeps a memory file whose import matches, with only the matching imports', () => {
    expect(
      filterMemory(ac4.memory, 'rules').map((e) => [e.label, e.imports.map((i) => i.label)])
    ).toEqual([['CLAUDE.md', ['docs/rules.md']]])
    expect(filterMemory(ac4.memory, 'nothing')).toEqual([])
  })
})

describe('setupWarnings', () => {
  it('D24: lists every row warning and file warning with its section', () => {
    const warnings = setupWarnings(
      snapshot({
        agents: [
          def('bare', { kind: 'project' }, { file: '/f/bare.md', warnings: ['No frontmatter'] })
        ],
        memory: [
          memory('CLAUDE.md', {
            imports: [
              memory('missing.md', { missing: true, warnings: ['Imported file not found'] })
            ]
          })
        ],
        plugins: [
          {
            key: 'gone@m',
            name: 'gone',
            marketplace: 'm',
            installPath: '/x',
            enabled: true,
            hooks: null,
            mcpServers: null,
            warnings: ['Install folder missing']
          }
        ],
        fileWarnings: [
          {
            section: 'status',
            entry: '.claude/settings.json',
            file: '/f/.claude/settings.json',
            message: 'Invalid JSON: x'
          }
        ]
      })
    )
    expect(warnings.map((w) => [w.section, w.entry, w.message, w.file])).toEqual([
      ['status', '.claude/settings.json', 'Invalid JSON: x', '/f/.claude/settings.json'],
      ['plugins', 'gone@m', 'Install folder missing', '/x'],
      ['agents', 'bare', 'No frontmatter', '/f/bare.md'],
      ['memory', 'missing.md', 'Imported file not found', '/f/missing.md']
    ])
  })
})

describe('isPluginOff', () => {
  it('D18: a plugin entry is off while its plugin is', () => {
    const plugin = {
      key: 'kit@market',
      name: 'kit',
      marketplace: 'market',
      installPath: '/k',
      hooks: null,
      mcpServers: null,
      warnings: []
    }
    const on = snapshot({ plugins: [{ ...plugin, enabled: true }] })
    const off = snapshot({ plugins: [{ ...plugin, enabled: false }] })
    expect(isPluginOff(on, def('kit:lint', kit))).toBe(false)
    expect(isPluginOff(off, def('kit:lint', kit))).toBe(true)
    expect(isPluginOff(off, def('review', { kind: 'project' }))).toBe(false)
  })
})

describe('fileLabel', () => {
  it('shows a file relative to the folder, else to the home', () => {
    const at = { folder: '/h/proj', home: '/h' }
    expect(fileLabel(at, '/h/proj/.claude/agents/a.md')).toBe('.claude/agents/a.md')
    expect(fileLabel(at, '/h/.claude/CLAUDE.md')).toBe('~/.claude/CLAUDE.md')
    expect(fileLabel(at, '/etc/x')).toBe('/etc/x')
  })
})
