import { describe, expect, it } from 'vitest'
import {
  accountText,
  configRows,
  parseConfigNumber,
  preferenceRows,
  effectiveSetting,
  fileLabel,
  filterDefinitions,
  filterMemory,
  hookGroups,
  filterPlugins,
  isPluginOff,
  marketplaceRows,
  matchesQuery,
  mcpServerRows,
  mcpStateLabel,
  permissionsView,
  pluginProvides,
  pluginSource,
  sectionSummaries,
  settingsFileStates,
  setupWarnings,
  sourceSplit,
  sourceChips,
  sourceSplitParts,
  ALL_SOURCES,
  type SourceFilter,
  filterLabel,
  matchesSource,
  sameFilter,
  noMatchText
} from './agent-setup-rows'
import type {
  AgentSetupSnapshot,
  DefinitionEntry,
  EntrySource,
  HookEntry,
  MemoryEntry,
  PluginEntry,
  SettingsFile
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
    hooks: [],
    bikubeSettings: null,
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

const hook = (event: string, command: string, more: Partial<HookEntry> = {}): HookEntry => ({
  event,
  matcher: null,
  command,
  source: { kind: 'project' },
  file: '/f/.claude/settings.json',
  warnings: [],
  ...more
})

describe('hookGroups', () => {
  it("D19: groups hooks by event in Claude Code's order, unknown events last by name", () => {
    const groups = hookGroups(
      [
        hook('Stop', 'b-stop', { source: { kind: 'bikube' } }),
        hook('Zeta', 'z'),
        hook('SessionStart', 'start'),
        hook('PreToolUse', 'pre', { matcher: 'Bash' }),
        hook('Alpha', 'a'),
        hook('Stop', 'p-stop')
      ],
      ''
    )
    expect(groups.map((g) => [g.event, g.hooks.map((h) => h.command)])).toEqual([
      ['PreToolUse', ['pre']],
      ['Stop', ['b-stop', 'p-stop']],
      ['SessionStart', ['start']],
      ['Alpha', ['a']],
      ['Zeta', ['z']]
    ])
  })

  it('D25: filters by command, matcher, event and source', () => {
    const hooks = [
      hook('PreToolUse', 'check.sh', { matcher: 'Bash' }),
      hook('Stop', 'board', { source: { kind: 'bikube' } })
    ]
    expect(hookGroups(hooks, 'bash').map((g) => g.event)).toEqual(['PreToolUse'])
    expect(hookGroups(hooks, 'bikube').map((g) => g.event)).toEqual(['Stop'])
    expect(hookGroups(hooks, 'stop board').map((g) => g.event)).toEqual(['Stop'])
    expect(hookGroups(hooks, 'nothing')).toEqual([])
  })
})

const settingsFile = (
  scope: SettingsFile['scope'],
  value?: Record<string, unknown>
): SettingsFile => ({
  scope,
  file: `/${scope}.json`,
  state: value ? 'found' : 'missing',
  ...(value ? { value } : {})
})

describe('permissionsView', () => {
  it('AC10: merges every settings file’s rules with their sources; defaultMode by precedence', () => {
    const view = permissionsView(
      snapshot({
        settings: [
          settingsFile('local', { permissions: { deny: ['Read(./secrets/**)'] } }),
          settingsFile('project', {
            permissions: { allow: ['Bash(npm test)'], defaultMode: 'acceptEdits' }
          }),
          settingsFile('user', {
            permissions: {
              allow: ['WebFetch', 7],
              defaultMode: 'plan',
              additionalDirectories: ['../docs']
            }
          })
        ]
      }),
      ''
    )
    expect(view.defaultMode).toEqual({
      value: 'acceptEdits',
      source: { kind: 'project' },
      file: '/project.json'
    })
    expect(view.allow.map((r) => [r.rule, r.source.kind])).toEqual([
      ['Bash(npm test)', 'project'],
      ['WebFetch', 'user']
    ])
    expect(view.ask).toEqual([])
    expect(view.deny.map((r) => [r.rule, r.source.kind, r.file])).toEqual([
      ['Read(./secrets/**)', 'local', '/local.json']
    ])
    expect(view.additionalDirectories.map((r) => r.rule)).toEqual(['../docs'])
    expect(permissionsView(snapshot(), '').defaultMode).toBeNull()
  })

  it('D25: keeps only rules matching the search, by rule or source', () => {
    const s = snapshot({
      settings: [
        settingsFile('local', { permissions: { deny: ['Read(./secrets/**)'] } }),
        settingsFile('project', { permissions: { allow: ['Bash(npm test)'] } })
      ]
    })
    expect(permissionsView(s, 'npm').allow.map((r) => r.rule)).toEqual(['Bash(npm test)'])
    expect(permissionsView(s, 'npm').deny).toEqual([])
    expect(permissionsView(s, 'local').deny.map((r) => r.rule)).toEqual(['Read(./secrets/**)'])
  })
})

describe('hooks and permissions in counts and warnings', () => {
  const s = snapshot({
    hooks: [
      hook('Stop', 'board', { source: { kind: 'bikube' }, file: undefined }),
      hook('PreToolUse', '$CLAUDE_PROJECT_DIR/hooks/check.sh', {
        warnings: ['Command not found']
      })
    ],
    settings: [
      settingsFile('local', { permissions: { deny: ['Read(./secrets/**)'] } }),
      settingsFile('project', { permissions: { allow: ['Bash(npm test)'] } })
    ]
  })

  it('AC7, AC10: counts hooks and permission rules by source', () => {
    const summaries = sectionSummaries(s, '')
    expect(summaries.hooks).toEqual({ count: 2, bySource: { Bikube: 1, Project: 1 } })
    expect(sourceSplit(summaries.hooks!)).toBe('1 Project · 1 Bikube')
    expect(summaries.permissions).toEqual({ count: 2, bySource: { Local: 1, Project: 1 } })
    expect(sectionSummaries(s, 'npm').permissions!.count).toBe(1)
    expect(sectionSummaries(s, 'npm').hooks!.count).toBe(0)
  })

  it("AC7: lists a hook's warning in the Hooks section", () => {
    expect(setupWarnings(s).map((w) => [w.section, w.entry, w.message, w.file])).toEqual([
      [
        'hooks',
        'PreToolUse · $CLAUDE_PROJECT_DIR/hooks/check.sh',
        'Command not found',
        '/f/.claude/settings.json'
      ]
    ])
  })
})

describe('Status', () => {
  it('D13: the account, or Not signed in', () => {
    const base = snapshot()
    expect(accountText(base)).toBe('Not signed in')
    const signedIn = (oauthAccount: AgentSetupSnapshot['claudeJson']['oauthAccount']): string =>
      accountText({ ...base, claudeJson: { ...base.claudeJson, oauthAccount } })
    expect(signedIn({ emailAddress: 'a@b.c', organizationName: 'Org' })).toBe('a@b.c · Org')
    expect(signedIn({ emailAddress: 'a@b.c' })).toBe('a@b.c')
    expect(signedIn({})).toBe('Not signed in')
  })

  it('D10: the effective value is the first settings file that sets it', () => {
    const settings = [
      settingsFile('local'),
      settingsFile('project', { model: 'opus' }),
      settingsFile('user', { model: 'sonnet', outputStyle: 'Explanatory' })
    ]
    expect(effectiveSetting(settings, 'model')).toEqual({ value: 'opus', file: settings[1] })
    expect(effectiveSetting(settings, 'outputStyle')?.value).toBe('Explanatory')
    expect(effectiveSetting(settings, 'nope')).toBeNull()
  })

  it("D13: every settings file's state, Bikube's first, then ~/.claude.json and .mcp.json", () => {
    const states = settingsFileStates(
      snapshot({
        bikubeSettings: { file: '/app/bin/claude-settings.json', state: 'found' },
        settings: [
          settingsFile('local'),
          {
            scope: 'project',
            file: '/f/.claude/settings.json',
            state: 'invalid',
            error: 'Invalid JSON: Unexpected end of JSON input'
          },
          settingsFile('user', {})
        ]
      })
    )
    expect(states.map((f) => [f.file, f.source.kind, f.state, f.error])).toEqual([
      ['/app/bin/claude-settings.json', 'bikube', 'found', undefined],
      ['/local.json', 'local', 'missing', undefined],
      [
        '/f/.claude/settings.json',
        'project',
        'invalid',
        'Invalid JSON: Unexpected end of JSON input'
      ],
      ['/user.json', 'user', 'found', undefined],
      ['/h/.claude.json', 'user', 'missing', undefined],
      ['/f/.mcp.json', 'project', 'missing', undefined]
    ])
  })
})

const plugin = (key: string, more: Partial<PluginEntry> = {}): PluginEntry => ({
  key,
  name: key.slice(0, key.indexOf('@')),
  marketplace: key.slice(key.indexOf('@') + 1),
  installPath: `/p/${key}`,
  enabled: true,
  hooks: null,
  mcpServers: null,
  warnings: [],
  ...more
})

describe('Plugins', () => {
  const s = snapshot({
    plugins: [
      plugin('kit@market', {
        scope: 'user',
        description: 'A kit of tools',
        mcpServers: { search: { command: 'search' } }
      }),
      plugin('local@market', { scope: 'project', enabled: false })
    ],
    skills: [def('kit:lint', kit), def('kit:fmt', kit), def('review', { kind: 'project' })],
    agents: [def('kit:fixer', kit)],
    hooks: [hook('Stop', 'x', { source: kit }), hook('Stop', 'y', { source: kit })]
  })

  it('D15: what a plugin provides, each count with its section', () => {
    expect(pluginProvides(s, s.plugins[0]!)).toEqual([
      { section: 'skills', label: '2 skills' },
      { section: 'agents', label: '1 agent' },
      { section: 'hooks', label: 'hooks' },
      { section: 'mcp', label: '1 MCP server' }
    ])
    expect(pluginProvides(s, s.plugins[1]!)).toEqual([])
    // The link's filter shows only that plugin's entries (#71 D8).
    const own: SourceFilter = { kind: 'plugin', key: s.plugins[0]!.key }
    expect(filterDefinitions(s.skills, '', own).map((e) => e.name)).toEqual(['kit:lint', 'kit:fmt'])
  })

  it('D15, D25: filters plugins by name, key, description and source, counted by scope', () => {
    expect(filterPlugins(s.plugins, 'tools').map((p) => p.key)).toEqual(['kit@market'])
    expect(filterPlugins(s.plugins, 'project').map((p) => p.key)).toEqual(['local@market'])
    expect(sectionSummaries(s, '').plugins).toEqual({
      count: 2,
      bySource: { User: 1, Project: 1 }
    })
    expect(pluginSource(plugin('a@m'))).toEqual({ kind: 'user' })
    expect(pluginSource(plugin('a@m', { scope: 'local' }))).toEqual({ kind: 'local' })
  })

  it('D15: marketplaces with their source and last update, read-only', () => {
    const rows = marketplaceRows(
      snapshot({
        marketplaces: {
          file: '/h/.claude/plugins/known_marketplaces.json',
          state: 'found',
          value: {
            official: {
              source: { source: 'github', repo: 'anthropics/plugins' },
              lastUpdated: '2026-01-02T03:04:05.000Z'
            },
            team: { source: { source: 'git', url: 'https://git.example/team.git' } },
            mine: { source: { source: 'directory', path: '/src/market' } },
            odd: 7
          }
        }
      }),
      ''
    )
    expect(rows).toEqual([
      {
        name: 'official',
        source: 'github: anthropics/plugins',
        lastUpdated: '2026-01-02T03:04:05.000Z'
      },
      { name: 'team', source: 'https://git.example/team.git' },
      { name: 'mine', source: '/src/market' }
    ])
    expect(marketplaceRows(snapshot(), '')).toEqual([])
  })
})

describe('MCP servers', () => {
  const mcp = snapshot({
    mcpJson: {
      file: '/f/.mcp.json',
      state: 'found',
      value: {
        mcpServers: {
          db: { command: 'npx', args: ['db-server', '--dir', 'a b'], env: { TOKEN: 's3cret' } },
          api: { type: 'http', url: 'https://api.example/mcp', headers: { Authorization: 'x' } }
        }
      }
    },
    claudeJson: {
      file: '/h/.claude.json',
      state: 'found',
      mcpServers: { docs: { type: 'sse', url: 'https://docs.example/sse' } },
      localMcpServers: { mine: { command: 'mine' } },
      oauthAccount: null,
      preferences: {}
    },
    plugins: [plugin('kit@market', { enabled: false, mcpServers: { search: { command: 's' } } })]
  })

  it('AC6: each server with its type, command or URL, variable names only, source and state', () => {
    const rows = mcpServerRows(mcp, '')
    expect(
      rows.map((r) => [r.name, r.type, r.target, r.envNames, r.headerNames, r.source, r.state])
    ).toEqual([
      [
        'db',
        'stdio',
        "npx db-server --dir 'a b'",
        ['TOKEN'],
        [],
        { kind: 'project' },
        'not-approved'
      ],
      [
        'api',
        'http',
        'https://api.example/mcp',
        [],
        ['Authorization'],
        { kind: 'project' },
        'not-approved'
      ],
      ['mine', 'stdio', 'mine', [], [], { kind: 'local' }, 'enabled'],
      ['docs', 'sse', 'https://docs.example/sse', [], [], { kind: 'user' }, 'enabled'],
      ['search', 'stdio', 's', [], [], kit, 'plugin-off']
    ])
    expect(JSON.stringify(rows)).not.toContain('s3cret')
    expect(rows.map((r) => r.file)).toEqual([
      '/f/.mcp.json',
      '/f/.mcp.json',
      '/h/.claude.json',
      '/h/.claude.json',
      '/p/kit@market/.mcp.json'
    ])
    expect(rows.map((r) => mcpStateLabel(r.state))).toEqual([
      'Not approved yet',
      'Not approved yet',
      'Enabled',
      'Enabled',
      'Plugin off'
    ])
    expect(sectionSummaries(mcp, '').mcp).toEqual({
      count: 5,
      bySource: { Project: 2, Local: 1, User: 1, Plugin: 1 }
    })
  })

  it('D16: a project server is off when disabled, on when enabled or all are, by precedence', () => {
    const state = (settings: SettingsFile[]): string[] =>
      mcpServerRows({ ...mcp, settings }, '')
        .filter((r) => r.source.kind === 'project')
        .map((r) => r.state)
    expect(state([settingsFile('local', { enabledMcpjsonServers: ['db'] })])).toEqual([
      'on',
      'not-approved'
    ])
    expect(state([settingsFile('project', { enableAllProjectMcpServers: true })])).toEqual([
      'on',
      'on'
    ])
    expect(
      state([
        settingsFile('local', { disabledMcpjsonServers: ['db'] }),
        settingsFile('project', { enableAllProjectMcpServers: true })
      ])
    ).toEqual(['off', 'on'])
    // The first file that sets a list wins (D10).
    expect(
      state([
        settingsFile('local', { enabledMcpjsonServers: [] }),
        settingsFile('user', { enabledMcpjsonServers: ['db', 'api'] })
      ])
    ).toEqual(['not-approved', 'not-approved'])
  })

  it('D25: filters by name, command, URL and source', () => {
    expect(mcpServerRows(mcp, 'db-server').map((r) => r.name)).toEqual(['db'])
    expect(mcpServerRows(mcp, 'docs.example').map((r) => r.name)).toEqual(['docs'])
    expect(mcpServerRows(mcp, 'plugin kit').map((r) => r.name)).toEqual(['search'])
    expect(mcpServerRows(mcp, 's3cret')).toEqual([])
  })
})

describe('configRows', () => {
  it('D21: one row per key, the first file by precedence winning, the others overridden', () => {
    const rows = configRows(
      snapshot({
        settings: [
          settingsFile('local', { includeCoAuthoredBy: false }),
          settingsFile('project', { model: 'sonnet' }),
          settingsFile('user', { includeCoAuthoredBy: true, cleanupPeriodDays: 30, model: 'opus' })
        ]
      }),
      ''
    )
    expect(rows.map((r) => r.key)).toEqual(['cleanupPeriodDays', 'includeCoAuthoredBy', 'model'])
    const [days, coAuthored, model] = rows
    expect(days).toMatchObject({
      text: '30',
      source: { kind: 'user' },
      file: '/user.json',
      overridden: [],
      control: 'number',
      resettable: false
    })
    expect(coAuthored).toMatchObject({
      value: false,
      text: 'false',
      source: { kind: 'local' },
      file: '/local.json',
      overridden: [{ source: { kind: 'user' }, file: '/user.json', text: 'true' }],
      control: 'switch',
      resettable: true
    })
    expect(model).toMatchObject({
      text: 'sonnet',
      source: { kind: 'project' },
      overridden: [{ source: { kind: 'user' }, text: 'opus' }],
      control: null,
      resettable: false
    })
  })

  it("D21: leaves out the keys other sections show, and shows env's names only", () => {
    const rows = configRows(
      snapshot({
        settings: [
          settingsFile('project', {
            hooks: {},
            permissions: { allow: [] },
            enabledPlugins: {},
            enabledMcpjsonServers: [],
            disabledMcpjsonServers: [],
            enableAllProjectMcpServers: true,
            // The reader keeps the variables' names only (D28).
            env: ['TOKEN', 'DEBUG']
          })
        ]
      }),
      ''
    )
    expect(rows.map((r) => [r.key, r.text, r.control])).toEqual([['env', 'TOKEN, DEBUG', null]])
  })

  it('D22: only a boolean or a finite number gets a control; objects and lists read as JSON', () => {
    const rows = configRows(
      snapshot({
        settings: [settingsFile('user', { a: 1.5, b: [1, 'x'], c: { d: true }, e: null })]
      }),
      ''
    )
    expect(rows.map((r) => [r.key, r.text, r.control])).toEqual([
      ['a', '1.5', 'number'],
      ['b', '[1,"x"]', null],
      ['c', '{"d":true}', null],
      ['e', 'null', null]
    ])
  })

  it('D22, D28: Reset only for a local boolean or finite number, never a read-only value', () => {
    const rows = configRows(
      snapshot({
        settings: [
          settingsFile('local', {
            model: 'opus',
            env: ['TOKEN'],
            verbose: true,
            cleanupPeriodDays: 3
          })
        ]
      }),
      ''
    )
    expect(rows.map((r) => [r.key, r.resettable])).toEqual([
      ['cleanupPeriodDays', true],
      ['env', false],
      ['model', false],
      ['verbose', true]
    ])
  })

  it('D25: matches the key, the value and the source', () => {
    const s = snapshot({
      settings: [
        settingsFile('local', { verbose: true }),
        settingsFile('user', { model: 'opus', cleanupPeriodDays: 30 })
      ]
    })
    expect(configRows(s, 'MODEL').map((r) => r.key)).toEqual(['model'])
    expect(configRows(s, '30').map((r) => r.key)).toEqual(['cleanupPeriodDays'])
    expect(configRows(s, 'local').map((r) => r.key)).toEqual(['verbose'])
  })
})

describe('preferenceRows', () => {
  it("D21: ~/.claude.json's booleans and numbers but runtime counters and caches, read-only", () => {
    const s = snapshot({
      claudeJson: {
        ...snapshot().claudeJson,
        state: 'found',
        preferences: {
          autoUpdates: true,
          verbose: false,
          editorWidth: 80,
          numStartups: 12,
          hasCompletedOnboarding: true,
          lastReleaseNotesSeen: 3,
          cachedThing: 1,
          firstStartTime: 9,
          tipsShownAt: 5,
          sessionId: 1,
          orgID: 2,
          promptCount: 4,
          statsigCache: 6
        }
      }
    })
    expect(preferenceRows(s, '').map((r) => [r.key, r.text])).toEqual([
      ['autoUpdates', 'true'],
      ['editorWidth', '80'],
      ['verbose', 'false']
    ])
    expect(preferenceRows(s, 'width').map((r) => r.key)).toEqual(['editorWidth'])
  })

  it('counts the Config rows and the preferences as the Config section', () => {
    const s = snapshot({
      settings: [settingsFile('user', { model: 'opus', verbose: true })],
      claudeJson: { ...snapshot().claudeJson, preferences: { autoUpdates: true } }
    })
    expect(sectionSummaries(s, '').config?.count).toBe(3)
    expect(sectionSummaries(s, 'opus').config?.count).toBe(1)
  })
})

describe('parseConfigNumber', () => {
  it('D22: a finite decimal number, else null (`Enter a number`)', () => {
    expect(parseConfigNumber('30')).toBe(30)
    expect(parseConfigNumber(' -1.5 ')).toBe(-1.5)
    expect(parseConfigNumber('2e3')).toBe(2000)
    for (const bad of ['', ' ', 'abc', '1e400', 'Infinity', 'NaN', '0x10', '1,5', '3 4']) {
      expect(parseConfigNumber(bad)).toBeNull()
    }
  })
})

// The source filter (#71 D1–D6): every section's rows, counts and chips follow it.

/** #71's fixture: 2 Project, 3 User and 1 kit skill; only User agents; a Project command. */
const ac71 = snapshot({
  plugins: [plugin('kit@market', { scope: 'user' }), plugin('tools@market', { scope: 'project' })],
  skills: [
    def('review', { kind: 'project' }),
    def('publish', { kind: 'project' }),
    def('notes', { kind: 'user' }),
    def('blog', { kind: 'user' }),
    def('draft', { kind: 'user' }),
    def('kit:lint', kit)
  ],
  agents: [def('helper', { kind: 'user' })],
  commands: [def('deploy', { kind: 'project' })],
  hooks: [
    hook('PreToolUse', 'board activity . working', { source: { kind: 'bikube' }, file: undefined }),
    hook('PreToolUse', 'check-user', { source: { kind: 'user' } }),
    hook('SessionStart', 'board instruction', { source: { kind: 'bikube' }, file: undefined }),
    hook('SessionStart', 'hello', { source: { kind: 'user' } })
  ],
  memory: [memory('~/.claude/CLAUDE.md', { source: { kind: 'user' } })],
  settings: [
    settingsFile('local', { verbose: true, permissions: { deny: ['Read(./x)'] } }),
    settingsFile('user', { cleanupPeriodDays: 30, permissions: { allow: ['Bash(ls)'] } })
  ],
  marketplaces: { file: '/m', state: 'found', value: { market: { source: 'x' } } },
  claudeJson: { ...snapshot().claudeJson, preferences: { autoUpdates: true } }
})

const userFilter: SourceFilter = { kind: 'user' }
const kitFilter: SourceFilter = { kind: 'plugin', key: 'kit@market' }

describe('sourceChips', () => {
  it('AC1: All, then the sources with rows, each counted; none for a one-source section', () => {
    expect(sourceChips(ac71, 'skills', '', ALL_SOURCES)).toEqual({
      all: 6,
      sources: [
        { kind: 'project', label: 'Project', count: 2 },
        { kind: 'user', label: 'User', count: 3 }
      ],
      plugin: { count: 1, plugins: [{ key: 'kit@market', name: 'kit', count: 1 }] }
    })
    expect(sourceChips(ac71, 'agents', '', ALL_SOURCES)).toBeNull()
  })

  it('AC5: an active filter keeps its chip, counted 0 where the section has no row from it', () => {
    expect(sourceChips(ac71, 'memory', '', { kind: 'project' })).toEqual({
      all: 1,
      sources: [
        { kind: 'project', label: 'Project', count: 0 },
        { kind: 'user', label: 'User', count: 1 }
      ],
      plugin: null
    })
    // A plugin filter keeps the Plugin chip, its menu listing the plugins with rows here.
    expect(sourceChips(ac71, 'agents', '', kitFilter)?.plugin).toEqual({ count: 0, plugins: [] })
  })

  it('AC4: counts read the rows matching the search, the chips staying', () => {
    const chips = sourceChips(ac71, 'skills', 'bl', userFilter)!
    expect(chips.all).toBe(2)
    expect(chips.sources.map((c) => [c.label, c.count])).toEqual([
      ['Project', 1],
      ['User', 1]
    ])
    expect(chips.plugin).toEqual({
      count: 0,
      plugins: [{ key: 'kit@market', name: 'kit', count: 0 }]
    })
  })

  it("AC7: Plugins' chips read the installs' scopes and Plugin; the menu lists each plugin", () => {
    // Every installed plugin's row is a plugin's row too (#71 D2, D4): the Plugin chip shows at All.
    expect(sourceChips(ac71, 'plugins', '', ALL_SOURCES)).toEqual({
      all: 2,
      sources: [
        { kind: 'project', label: 'Project', count: 1 },
        { kind: 'user', label: 'User', count: 1 }
      ],
      plugin: {
        count: 2,
        plugins: [
          { key: 'kit@market', name: 'kit', count: 1 },
          { key: 'tools@market', name: 'tools', count: 1 }
        ]
      }
    })
    expect(sourceChips(ac71, 'plugins', '', kitFilter)?.plugin).toEqual({
      count: 2,
      plugins: [
        { key: 'kit@market', name: 'kit', count: 1 },
        { key: 'tools@market', name: 'tools', count: 1 }
      ]
    })
  })
})

describe("Overview's chips and splits (#71 D3, D7)", () => {
  it("D3: Overview's chips are the sources across its cards' sections", () => {
    // Plugins 1P 1U (2 plugin rows), Skills 2P 3U 1 kit, Agents 1U, Commands 1P, Hooks 2 Bikube
    // 2U, Memory 1U, Permissions 1 Local 1U; Config and Status have no card.
    expect(sourceChips(ac71, 'overview', '', ALL_SOURCES)).toEqual({
      all: 17,
      sources: [
        { kind: 'project', label: 'Project', count: 4 },
        { kind: 'local', label: 'Local', count: 1 },
        { kind: 'user', label: 'User', count: 9 },
        { kind: 'bikube', label: 'Bikube', count: 2 }
      ],
      plugin: {
        count: 3,
        plugins: [
          { key: 'kit@market', name: 'kit', count: 2 },
          { key: 'tools@market', name: 'tools', count: 1 }
        ]
      }
    })
    expect(sourceChips(ac71, 'overview', 'bl', ALL_SOURCES)?.all).toBe(2)
  })

  it('D7: each part of a split is its count, label and the filter it sets', () => {
    expect(sourceSplitParts(sectionSummaries(ac71, '').skills!)).toEqual([
      { label: '2 Project', filter: { kind: 'project' } },
      { label: '3 User', filter: { kind: 'user' } },
      { label: '1 Plugin', filter: { kind: 'plugins' } }
    ])
    expect(sourceSplitParts(sectionSummaries(ac71, '').hooks!)).toEqual([
      { label: '2 User', filter: { kind: 'user' } },
      { label: '2 Bikube', filter: { kind: 'bikube' } }
    ])
    // AC9: under User, the Skills card reads 3 and its split `3 User`.
    const user = sectionSummaries(ac71, '', userFilter).skills!
    expect(user.count).toBe(3)
    expect(sourceSplitParts(user).map((p) => p.label)).toEqual(['3 User'])
    expect(sourceSplitParts(sectionSummaries(ac71, '', userFilter).commands!)).toEqual([])
  })
})

describe('the source filter', () => {
  it('AC2: a source shows only its rows and counts them', () => {
    expect(filterDefinitions(ac71.skills, '', userFilter).map((e) => e.name)).toEqual([
      'notes',
      'blog',
      'draft'
    ])
    expect(sectionSummaries(ac71, '', userFilter).skills?.count).toBe(3)
    expect(sectionSummaries(ac71, '', ALL_SOURCES).skills?.count).toBe(6)
  })

  it('AC3: every section follows it; one with no row from it counts 0', () => {
    const summaries = sectionSummaries(ac71, '', userFilter)
    expect(summaries.hooks?.count).toBe(2)
    expect(
      hookGroups(ac71.hooks, '', userFilter).map((g) => g.hooks.map((h) => h.command))
    ).toEqual([['check-user'], ['hello']])
    expect(summaries.commands?.count).toBe(0)
    expect(summaries.agents?.count).toBe(1)
    expect(summaries.memory?.count).toBe(1)
    expect(summaries.permissions?.count).toBe(1)
    expect(summaries.mcp?.count).toBe(0)
    // Config: the User key and the preference (User's), not the Local key.
    expect(summaries.config?.count).toBe(2)
    expect(configRows(ac71, '', userFilter).map((r) => r.key)).toEqual(['cleanupPeriodDays'])
    expect(preferenceRows(ac71, '', { kind: 'local' })).toEqual([])
    expect(permissionsView(ac71, '', { kind: 'local' }).deny.map((r) => r.rule)).toEqual([
      'Read(./x)'
    ])
    expect(permissionsView(ac71, '', { kind: 'local' }).allow).toEqual([])
  })

  it('AC4: combines with the search', () => {
    expect(filterDefinitions(ac71.skills, 'bl', userFilter).map((e) => e.name)).toEqual(['blog'])
    expect(sectionSummaries(ac71, 'bl', userFilter).skills?.count).toBe(1)
  })

  it('AC6: every plugin, or one plugin by its key; a plugin no longer listed matches nothing', () => {
    expect(filterDefinitions(ac71.skills, '', kitFilter).map((e) => e.name)).toEqual(['kit:lint'])
    expect(filterDefinitions(ac71.skills, '', { kind: 'plugins' }).map((e) => e.name)).toEqual([
      'kit:lint'
    ])
    const gone: SourceFilter = { kind: 'plugin', key: 'gone@market' }
    expect(filterDefinitions(ac71.skills, '', gone)).toEqual([])
    expect(filterLabel(ac71, gone)).toBe('Plugin gone@market')
    expect(filterLabel(ac71, kitFilter)).toBe('Plugin kit')
    expect(filterLabel(ac71, { kind: 'plugins' })).toBe('Plugin')
    expect(filterLabel(ac71, userFilter)).toBe('User')
    expect(filterLabel(ac71, ALL_SOURCES)).toBe('All')
  })

  it('AC7: a plugin filter shows its plugin in Plugins, and no marketplace', () => {
    expect(filterPlugins(ac71.plugins, '', kitFilter).map((p) => p.key)).toEqual(['kit@market'])
    expect(filterPlugins(ac71.plugins, '', { kind: 'plugins' })).toHaveLength(2)
    expect(filterPlugins(ac71.plugins, '', userFilter).map((p) => p.key)).toEqual(['kit@market'])
    expect(marketplaceRows(ac71, '', kitFilter)).toEqual([])
    expect(marketplaceRows(ac71, '', userFilter)).toEqual([])
    expect(marketplaceRows(ac71, '', ALL_SOURCES).map((m) => m.name)).toEqual(['market'])
  })

  it('D2: a memory file is kept with its imports, or for its matching imports only', () => {
    const tree = [
      memory('CLAUDE.md', {
        imports: [memory('a.md'), memory('mine.md', { source: { kind: 'user' } })]
      })
    ]
    expect(filterMemory(tree, '', userFilter)).toEqual([
      { ...tree[0], imports: [tree[0]!.imports[1]] }
    ])
    expect(filterMemory(tree, '', { kind: 'project' })).toEqual(tree)
  })

  it("D2: rows past a folder's limit count only with no search and the filter at All", () => {
    const s = snapshot({ skills: [def('a', { kind: 'user' })], more: { skills: 4 } })
    expect(sectionSummaries(s, '').skills?.count).toBe(5)
    expect(sectionSummaries(s, '', userFilter).skills?.count).toBe(1)
  })

  it('matchesSource and sameFilter', () => {
    expect(matchesSource(userFilter, { kind: 'user' })).toBe(true)
    expect(matchesSource(userFilter, kit)).toBe(false)
    expect(matchesSource({ kind: 'plugins' }, kit)).toBe(true)
    expect(sameFilter(kitFilter, { kind: 'plugin', key: 'kit@market' })).toBe(true)
    expect(sameFilter(kitFilter, { kind: 'plugins' })).toBe(false)
    expect(sameFilter(userFilter, { kind: 'user' })).toBe(true)
  })
})

describe('noMatchText', () => {
  it('D6: names the filter and the search when they leave no row', () => {
    expect(noMatchText('skills', 'bl', ac71, ALL_SOURCES)).toBe('No skills match “bl”.')
    expect(noMatchText('memory files', '', ac71, { kind: 'project' })).toBe(
      'No memory files from Project.'
    )
    expect(noMatchText('skills', ' bl ', ac71, userFilter)).toBe('No skills from User match “bl”.')
    expect(noMatchText('skills', '', ac71, kitFilter)).toBe('No skills from Plugin kit.')
  })
})
