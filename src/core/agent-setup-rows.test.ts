import { describe, expect, it } from 'vitest'
import {
  accountText,
  effectiveSetting,
  fileLabel,
  filterDefinitions,
  filterMemory,
  hookGroups,
  isPluginOff,
  matchesQuery,
  permissionsView,
  sectionSummaries,
  settingsFileStates,
  setupWarnings,
  sourceSplit
} from './agent-setup-rows'
import type {
  AgentSetupSnapshot,
  DefinitionEntry,
  EntrySource,
  HookEntry,
  MemoryEntry,
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
