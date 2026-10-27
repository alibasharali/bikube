import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAgentSetup } from './agent-setup-reader'
import type { AgentSetupSnapshot } from './agent-setup-snapshot'

// The Agent setup reader (#68 D8–D11, D17, D18, D24) on real temporary folders: a fake home and a
// workspace folder holding the files each test names.

let dir: string
let home: string
let folder: string

const write = (path: string, text = ''): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const inFolder = (path: string): string => join(folder, path)
const inHome = (path: string): string => join(home, path)

const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nDo it.\n`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-agent-setup-'))
  home = join(dir, 'home')
  folder = join(dir, 'work', 'proj')
  mkdirSync(home, { recursive: true })
  mkdirSync(folder, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const read = (): Promise<AgentSetupSnapshot> => readAgentSetup({ folder, home })

/** AC4's fixtures: a project and a user skill, an enabled plugin with a skill and an agent, a project agent. */
function ac4Fixtures(): string {
  write(inFolder('.claude/skills/review/SKILL.md'), skill('review', 'Reviews the diff'))
  write(inHome('.claude/skills/notes/SKILL.md'), skill('notes', 'Takes notes'))
  write(inFolder('.claude/agents/tester.md'), skill('tester', 'Runs the tests'))
  const installPath = inHome('.claude/plugins/cache/market/kit/1.0.0')
  write(
    inHome('.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'kit@market': [{ scope: 'user', installPath, version: '1.0.0' }] }
    })
  )
  write(join(installPath, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'kit' }))
  write(join(installPath, 'skills/lint/SKILL.md'), skill('lint', 'Lints the code'))
  write(join(installPath, 'agents/fixer.md'), skill('fixer', 'Fixes lint'))
  write(inHome('.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'kit@market': true } }))
  return installPath
}

describe('readAgentSetup', () => {
  it('AC4: reads project, user and plugin skills and agents with their sources', async () => {
    ac4Fixtures()
    const snapshot = await read()
    expect(snapshot.skills.map((s) => [s.name, s.source])).toEqual([
      ['review', { kind: 'project' }],
      ['notes', { kind: 'user' }],
      ['kit:lint', { kind: 'plugin', plugin: 'kit', key: 'kit@market' }]
    ])
    expect(snapshot.skills[0]!.description).toBe('Reviews the diff')
    expect(snapshot.skills[0]!.file).toBe(inFolder('.claude/skills/review/SKILL.md'))
    expect(snapshot.agents.map((a) => a.name)).toEqual(['tester', 'kit:fixer'])
    expect(snapshot.plugins.map((p) => [p.key, p.name, p.enabled])).toEqual([
      ['kit@market', 'kit', true]
    ])
    expect(snapshot.skills.every((s) => s.warnings.length === 0)).toBe(true)
  })

  it('AC8: warns about an agent without frontmatter, invalid frontmatter and missing fields', async () => {
    write(inFolder('.claude/agents/bare.md'), 'You are a helper.\n')
    write(inFolder('.claude/agents/broken.md'), '---\nname: broken\nthis is not yaml\n---\n')
    write(inFolder('.claude/skills/nameless/SKILL.md'), '---\ndescription: No name here\n---\n')
    write(inFolder('.claude/commands/plain.md'), 'Run the thing.\n')
    const snapshot = await read()
    expect(snapshot.agents.map((a) => [a.name, a.warnings])).toEqual([
      ['bare', ['No frontmatter']],
      ['broken', ['Invalid frontmatter']]
    ])
    expect(snapshot.skills.map((s) => [s.name, s.description, s.warnings])).toEqual([
      ['nameless', 'No name here', ['Missing name']]
    ])
    // A command needs no frontmatter.
    expect(snapshot.commands.map((c) => [c.name, c.warnings])).toEqual([['/plain', []]])
  })

  it('D24: warns about every invalid JSON file with the parser message, and reads nothing from it', async () => {
    write(inFolder('.claude/settings.json'), '{ "model": ')
    write(inFolder('.mcp.json'), '[1,')
    write(inHome('.claude/plugins/installed_plugins.json'), 'nope')
    const snapshot = await read()
    expect(snapshot.settings.map((f) => [f.scope, f.state])).toEqual([
      ['local', 'missing'],
      ['project', 'invalid'],
      ['user', 'missing']
    ])
    expect(snapshot.settings[1]!.error).toMatch(/^Invalid JSON: /)
    expect(snapshot.fileWarnings.map((w) => [w.section, w.entry])).toEqual([
      ['status', '.claude/settings.json'],
      ['mcp', '.mcp.json'],
      ['plugins', '~/.claude/plugins/installed_plugins.json']
    ])
    expect(snapshot.plugins).toEqual([])
  })

  it('reads agent models and tools, nested commands and plugin commands by their names', async () => {
    const installPath = ac4Fixtures()
    write(
      inFolder('.claude/agents/sub/deep.md'),
      '---\nname: deep\ndescription: "Quoted"\nmodel: sonnet\ntools: Read, Grep\n---\n'
    )
    write(
      inFolder('.claude/commands/git/commit.md'),
      '---\ndescription: Commits\nargument-hint: [message]\n---\n'
    )
    write(join(installPath, 'commands/fix.md'), '---\ndescription: >\n  Fixes\n  things\n---\n')
    const snapshot = await read()
    const deep = snapshot.agents.find((a) => a.name === 'deep')!
    expect([deep.description, deep.model, deep.tools]).toEqual([
      'Quoted',
      'sonnet',
      ['Read', 'Grep']
    ])
    expect(snapshot.commands.map((c) => [c.name, c.description, c.argumentHint])).toEqual([
      ['/git:commit', 'Commits', '[message]'],
      ['/kit:fix', 'Fixes things', undefined]
    ])
  })

  it('D10: a plugin is on by the first settings file that sets it; project installs only for their folder', async () => {
    const installPath = ac4Fixtures()
    write(
      inFolder('.claude/settings.local.json'),
      JSON.stringify({ enabledPlugins: { 'kit@market': false } })
    )
    write(
      inHome('.claude/plugins/installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'kit@market': [{ scope: 'user', installPath }],
          'other@market': [{ scope: 'project', projectPath: '/elsewhere', installPath }],
          'gone@market': { installPath: join(dir, 'nowhere') }
        }
      })
    )
    const snapshot = await read()
    expect(snapshot.plugins.map((p) => [p.key, p.enabled, p.warnings])).toEqual([
      ['gone@market', false, ['Install folder missing']],
      ['kit@market', false, []]
    ])
    // The plugin's skill is still listed (dimmed as Plugin off on the page).
    expect(snapshot.skills.map((s) => s.name)).toContain('kit:lint')
  })

  it('AC9: lists memory files in load order with their imports nested', async () => {
    write(inHome('.claude/CLAUDE.md'), '# Me\n')
    write(
      inFolder('CLAUDE.md'),
      'Rules:\n@docs/rules.md\n@missing.md\n```\n@not/an/import.md\n```\nSee `@inline.md` too.\n'
    )
    write(inFolder('docs/rules.md'), 'Be nice.\nAlso @~/extra.md\n')
    write(inHome('extra.md'), 'extra\n')
    write(inFolder('CLAUDE.local.md'), 'mine\n')
    const snapshot = await read()
    const shape = (entries: AgentSetupSnapshot['memory']): unknown =>
      entries.map((e) => [e.label, e.source.kind, e.warnings, shape(e.imports)])
    expect(shape(snapshot.memory)).toEqual([
      ['~/.claude/CLAUDE.md', 'user', [], []],
      [
        'CLAUDE.md',
        'project',
        [],
        [
          ['docs/rules.md', 'project', [], [['~/extra.md', 'project', [], []]]],
          ['missing.md', 'project', ['Imported file not found'], []]
        ]
      ],
      ['CLAUDE.local.md', 'local', [], []]
    ])
    const project = snapshot.memory[1]!
    expect([project.lines, project.size > 0]).toEqual([7, true])
    expect(project.head.split('\n')[0]).toBe('Rules:')
  })

  it('D17: reads CLAUDE.md in ancestor folders, labelled from the home', async () => {
    folder = join(home, 'code', 'proj')
    mkdirSync(folder, { recursive: true })
    write(inHome('code/CLAUDE.md'), 'parent\n')
    const snapshot = await read()
    expect(snapshot.memory.map((e) => e.label)).toEqual(['~/code/CLAUDE.md'])
  })

  it('D11: a file over 1 MB is not parsed, broken symlinks are skipped, a folder lists 500 entries', async () => {
    write(inFolder('.claude/agents/huge.md'), `---\nname: huge\n---\n${'x'.repeat(1024 * 1024)}`)
    symlinkSync(join(dir, 'nowhere.md'), inFolder('.claude/agents/broken.md'))
    write(inHome('.claude.json'), ' '.repeat(1024 * 1024 + 1))
    for (let i = 0; i < 502; i++) write(inHome(`.claude/commands/c${i}.md`), '')
    const snapshot = await read()
    expect(snapshot.agents.map((a) => [a.name, a.warnings])).toEqual([
      ['huge', ['Too large to read (over 1 MB)']]
    ])
    expect(snapshot.claudeJson.state).toBe('invalid')
    expect(snapshot.fileWarnings.map((w) => w.message)).toEqual(['Too large to read (over 1 MB)'])
    expect(snapshot.commands).toHaveLength(500)
    expect(snapshot.more).toEqual({ commands: 2 })
  })

  it('D28: records every file it found, for Open file and Reveal', async () => {
    ac4Fixtures()
    write(inFolder('CLAUDE.md'), 'hi\n')
    const snapshot = await read()
    expect(snapshot.paths).toContain(inFolder('.claude/skills/review/SKILL.md'))
    expect(snapshot.paths).toContain(inHome('.claude/settings.json'))
    expect(snapshot.paths).toContain(inFolder('CLAUDE.md'))
    expect(snapshot.paths).not.toContain(inFolder('.claude/settings.local.json'))
  })

  it("reads ~/.claude.json servers, the folder's local servers and the account", async () => {
    write(
      inHome('.claude.json'),
      JSON.stringify({
        mcpServers: { docs: { type: 'http', url: 'https://x' } },
        projects: { [folder]: { mcpServers: { db: { command: 'db' } } } },
        oauthAccount: { emailAddress: 'a@b.c', organizationName: 'Org' },
        autoUpdates: false,
        theme: 'dark'
      })
    )
    const { claudeJson } = await read()
    expect(Object.keys(claudeJson.mcpServers)).toEqual(['docs'])
    expect(Object.keys(claudeJson.localMcpServers)).toEqual(['db'])
    expect(claudeJson.oauthAccount).toEqual({ emailAddress: 'a@b.c', organizationName: 'Org' })
    expect(claudeJson.preferences).toEqual({ autoUpdates: false })
  })

  it('D17: follows imports at most 5 hops deep', async () => {
    write(inFolder('CLAUDE.md'), '@a1.md\n')
    for (let i = 1; i <= 6; i++) write(inFolder(`a${i}.md`), `@a${i + 1}.md\n`)
    const [top] = (await read()).memory
    const labels: string[] = []
    for (let at = top!.imports[0]; at; at = at.imports[0]) labels.push(at.label)
    expect(labels).toEqual(['a1.md', 'a2.md', 'a3.md', 'a4.md', 'a5.md'])
  })

  it("D17: ancestor folders' CLAUDE.local.md is Project; the workspace folder's own is Local", async () => {
    write(join(dirname(folder), 'CLAUDE.local.md'), 'parent\n')
    write(inFolder('CLAUDE.local.md'), 'mine\n')
    const snapshot = await read()
    expect(snapshot.memory.map((e) => [e.file, e.source.kind])).toEqual([
      [join(dirname(folder), 'CLAUDE.local.md'), 'project'],
      [inFolder('CLAUDE.local.md'), 'local']
    ])
  })

  it('D18: reads a flow list of tools as chips', async () => {
    write(
      inFolder('.claude/agents/flow.md'),
      `---\nname: flow\ndescription: d\ntools: [Read, "Grep"]\n---\n`
    )
    const [agent] = (await read()).agents
    expect(agent!.tools).toEqual(['Read', 'Grep'])
  })
})

describe('readAgentSetup hooks (#68 S3)', () => {
  const hooksOf = (event: string, command: string, more: Record<string, unknown> = {}): string =>
    JSON.stringify({
      hooks: { [event]: [{ ...more, hooks: [{ type: 'command', command, timeout: 10 }] }] }
    })

  it("AC7: reads Bikube's hooks without listing its file, and warns about a missing project hook", async () => {
    const bikube = join(dir, 'bin', 'claude-settings.json')
    write(bikube, hooksOf('Stop', '"$BIKUBE_BIN/board" activity . waiting'))
    write(
      inFolder('.claude/settings.json'),
      hooksOf('PreToolUse', '$CLAUDE_PROJECT_DIR/hooks/check.sh --fast', { matcher: 'Bash' })
    )
    const snapshot = await readAgentSetup({ folder, home, bikubeSettings: bikube })
    expect(snapshot.hooks).toEqual([
      {
        event: 'Stop',
        matcher: null,
        command: '"$BIKUBE_BIN/board" activity . waiting',
        timeout: 10,
        source: { kind: 'bikube' },
        warnings: []
      },
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        command: '$CLAUDE_PROJECT_DIR/hooks/check.sh --fast',
        timeout: 10,
        source: { kind: 'project' },
        file: inFolder('.claude/settings.json'),
        warnings: ['Command not found']
      }
    ])
    expect(snapshot.bikubeSettings).toEqual({
      file: bikube,
      state: 'found',
      value: expect.anything()
    })
    expect(snapshot.paths).not.toContain(bikube)

    // Once the file is there, no warning.
    write(inFolder('hooks/check.sh'), '#!/bin/sh\n')
    expect(
      (await readAgentSetup({ folder, home, bikubeSettings: bikube })).hooks[1]!.warnings
    ).toEqual([])
  })

  it('D19: checks absolute, quoted, ${CLAUDE_PROJECT_DIR} and plugin-root commands; others never', async () => {
    const installPath = ac4Fixtures()
    write(
      inHome('.claude/settings.json'),
      JSON.stringify({
        enabledPlugins: { 'kit@market': true },
        hooks: {
          PostToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                { type: 'command', command: '/nowhere/fmt.sh' },
                { type: 'command', command: '"${CLAUDE_PROJECT_DIR}"/x.sh' },
                { type: 'command', command: 'npx prettier --write' },
                { type: 'command', command: '$HOME/x.sh' }
              ]
            }
          ]
        }
      })
    )
    write(
      join(installPath, 'hooks/hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/start.sh' },
                { type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/gone.sh' }
              ]
            }
          ]
        }
      })
    )
    write(join(installPath, 'start.sh'), '')
    const snapshot = await read()
    expect(snapshot.hooks.map((h) => [h.event, h.command, h.source.kind, h.warnings])).toEqual([
      ['PostToolUse', '/nowhere/fmt.sh', 'user', ['Command not found']],
      ['PostToolUse', '"${CLAUDE_PROJECT_DIR}"/x.sh', 'user', ['Command not found']],
      ['PostToolUse', 'npx prettier --write', 'user', []],
      ['PostToolUse', '$HOME/x.sh', 'user', []],
      ['SessionStart', '${CLAUDE_PLUGIN_ROOT}/start.sh', 'plugin', []],
      ['SessionStart', '${CLAUDE_PLUGIN_ROOT}/gone.sh', 'plugin', ['Command not found']]
    ])
    expect(snapshot.hooks[4]!.file).toBe(join(installPath, 'hooks/hooks.json'))
  })

  it('D16, D28: no environment, header or credential value leaves the reader', async () => {
    const server = {
      command: 'db-server',
      args: ['--port', '5432'],
      env: { TOKEN: 's3cret' },
      headers: { Authorization: 'Bearer abc123' },
      oauth: { clientSecret: 'oauth-hidden' }
    }
    const remote = {
      type: 'http',
      url: 'https://user:url-pass@api.example/mcp?key=query-hidden&v=1',
      headers: { 'X-Api-Key': 'header-hidden' }
    }
    write(inFolder('.mcp.json'), JSON.stringify({ mcpServers: { db: server, api: remote } }))
    write(
      inHome('.claude.json'),
      JSON.stringify({
        mcpServers: { docs: server },
        projects: { [folder]: { mcpServers: { mine: remote } } }
      })
    )
    const installPath = ac4Fixtures()
    write(
      inHome('.claude/settings.json'),
      JSON.stringify({ enabledPlugins: { 'kit@market': true }, env: { API_KEY: 'env-hidden' } })
    )
    write(inFolder('.claude/settings.json'), JSON.stringify({ env: { OTHER: 'env-hidden-2' } }))
    write(join(installPath, '.mcp.json'), JSON.stringify({ mcpServers: { search: server } }))

    const snapshot = await read()
    const text = JSON.stringify(snapshot)
    for (const secret of [
      's3cret',
      'abc123',
      'oauth-hidden',
      'url-pass',
      'query-hidden',
      'header-hidden',
      'env-hidden'
    ]) {
      expect(text).not.toContain(secret)
    }
    // The names and what the page shows stay.
    const mcp = (snapshot.mcpJson.value as { mcpServers: Record<string, unknown> }).mcpServers
    expect(mcp['db']).toEqual({
      command: 'db-server',
      args: ['--port', '5432'],
      env: ['TOKEN'],
      headers: ['Authorization']
    })
    expect(mcp['api']).toEqual({
      type: 'http',
      url: 'https://api.example/mcp?key=…&v=…',
      headers: ['X-Api-Key']
    })
    expect(snapshot.claudeJson.mcpServers['docs']).toEqual(mcp['db'])
    expect(snapshot.claudeJson.localMcpServers['mine']).toEqual(mcp['api'])
    expect(snapshot.plugins[0]!.mcpServers).toEqual({ search: mcp['db'] })
    expect(snapshot.settings.map((f) => f.value?.['env'])).toEqual([
      undefined,
      ['OTHER'],
      ['API_KEY']
    ])
  })
})
