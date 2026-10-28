import { describe, expect, it } from 'vitest'
import { sandboxEntries, sandboxView } from './agent-setup-sandbox'
import type { AgentSetupSnapshot, SettingsFile } from './agent-setup-snapshot'

// The Agent setup page's Sandbox section (#72 D2–D6, D8): facts by precedence, lists merged.

const settingsFile = (
  scope: SettingsFile['scope'],
  value?: Record<string, unknown>
): SettingsFile => ({
  scope,
  file: `/${scope}.json`,
  state: value ? 'found' : 'missing',
  ...(value ? { value } : {})
})

/** A snapshot with only its settings files (Local, Project, User: D10's precedence). */
const withSettings = (
  local?: Record<string, unknown>,
  project?: Record<string, unknown>,
  user?: Record<string, unknown>
): AgentSetupSnapshot =>
  ({
    settings: [
      settingsFile('local', local),
      settingsFile('project', project),
      settingsFile('user', user)
    ]
  }) as AgentSetupSnapshot

/** AC2's and AC3's files. */
const ac3 = withSettings(
  { sandbox: { enabled: false } },
  { sandbox: { network: { allowedDomains: ['registry.npmjs.org'] } } },
  {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: {
        strictAllowlist: true,
        allowLocalBinding: true,
        httpProxyPort: 8080,
        allowedDomains: ['github.com', '*.github.com']
      },
      filesystem: { denyRead: ['~/.ssh'] },
      excludedCommands: ['git push:*']
    }
  }
)

const facts = (snapshot: AgentSetupSnapshot): [string, string, string | undefined][] =>
  sandboxView(snapshot, '').facts.map((f) => [f.label, f.text, f.source?.kind])

const lists = (snapshot: AgentSetupSnapshot, query = ''): Record<string, string[]> =>
  Object.fromEntries(
    sandboxView(snapshot, query).lists.map((l) => [
      l.label,
      l.entries.map((e) => `${e.entry} ${e.source.kind}`)
    ])
  )

describe('sandboxView', () => {
  it('AC2, D4: the known facts by precedence, Not set when unset, other values by dotted path', () => {
    expect(facts(ac3)).toEqual([
      ['Enabled', 'false', 'local'],
      ['Fail if unavailable', 'true', 'user'],
      ['Allow unsandboxed commands', 'false', 'user'],
      ['Auto-allow Bash when sandboxed', 'Not set', undefined],
      ['Strict allowlist', 'true', 'user'],
      ['Allow local binding', 'true', 'user'],
      ['network.httpProxyPort', '8080', 'user']
    ])
    expect(sandboxView(ac3, '').facts[0]).toMatchObject({ key: 'enabled', file: '/local.json' })
  })

  it('AC3, D5: every file’s list entries merged by precedence, with their files', () => {
    expect(lists(ac3)).toEqual({
      'Allowed domains': ['registry.npmjs.org project', 'github.com user', '*.github.com user'],
      'Denied domains': [],
      'Allow write': [],
      'Deny write': [],
      'Allow read': [],
      'Deny read': ['~/.ssh user'],
      'Excluded commands': ['git push:* user']
    })
    expect(sandboxView(ac3, '').lists[0]!.entries[0]).toMatchObject({
      key: 'network.allowedDomains',
      file: '/project.json'
    })
    expect(sandboxEntries(sandboxView(ac3, ''))).toHaveLength(5)
    expect(sandboxView(ac3, '').set).toBe(true)
  })

  it('D5: other string lists by dotted path; non-strings and arrays of objects left out', () => {
    const view = sandboxView(
      withSettings(undefined, undefined, {
        sandbox: {
          network: { allowedDomains: ['a.com', 7, null], allowUnixSockets: ['/tmp/s'] },
          ignoreViolations: [{ path: '/x' }],
          mode: null
        }
      }),
      ''
    )
    expect(view.lists.map((l) => [l.label, l.entries.map((e) => e.entry)])).toEqual([
      ['Allowed domains', ['a.com']],
      ['Denied domains', []],
      ['Allow write', []],
      ['Deny write', []],
      ['Allow read', []],
      ['Deny read', []],
      ['Excluded commands', []],
      ['network.allowUnixSockets', ['/tmp/s']]
    ])
    expect(view.facts.map((f) => f.label)).not.toContain('mode')
  })

  it('D2: a sandbox that is not an object is ignored in that file', () => {
    const view = sandboxView(
      withSettings({ sandbox: true }, { sandbox: ['x'] }, { sandbox: { enabled: true } }),
      ''
    )
    expect(view.facts[0]).toMatchObject({ text: 'true', source: { kind: 'user' } })
  })

  it('AC4, D6: the search keeps matching entries by text, group or source; facts stay', () => {
    expect(lists(ac3, 'github')).toEqual({
      'Allowed domains': ['github.com user', '*.github.com user'],
      'Denied domains': [],
      'Allow write': [],
      'Deny write': [],
      'Allow read': [],
      'Deny read': [],
      'Excluded commands': []
    })
    expect(sandboxView(ac3, 'github').facts).toHaveLength(7)
    expect(sandboxEntries(sandboxView(ac3, 'github'))).toHaveLength(2)
    expect(lists(ac3, 'deny read')['Deny read']).toEqual(['~/.ssh user'])
    expect(lists(ac3, 'project')['Allowed domains']).toEqual(['registry.npmjs.org project'])
  })

  it('AC6, D8: with no sandbox anywhere, Enabled reads Off and every list is empty', () => {
    const view = sandboxView(withSettings({ model: 'opus' }), '')
    expect(view.set).toBe(false)
    expect(view.facts.map((f) => [f.label, f.text])).toEqual([
      ['Enabled', 'Off'],
      ['Fail if unavailable', 'Not set'],
      ['Allow unsandboxed commands', 'Not set'],
      ['Auto-allow Bash when sandboxed', 'Not set'],
      ['Strict allowlist', 'Not set'],
      ['Allow local binding', 'Not set']
    ])
    expect(view.lists.every((l) => l.entries.length === 0)).toBe(true)
    expect(view.lists).toHaveLength(7)
  })
})

describe('the source filter on Sandbox (#71 D2)', () => {
  it("keeps only the filtered source's entries and every fact", () => {
    const view = sandboxView(ac3, '', { kind: 'project' })
    expect(sandboxEntries(view).map((e) => e.entry)).toEqual(['registry.npmjs.org'])
    expect(view.facts.find((f) => f.key === 'enabled')?.text).toBe('false')
    expect(view.facts.find((f) => f.key === 'failIfUnavailable')?.text).toBe('true')
    expect(sandboxEntries(sandboxView(ac3, 'github', { kind: 'project' }))).toEqual([])
    expect(sandboxEntries(sandboxView(ac3, '', { kind: 'plugins' }))).toEqual([])
  })
})
