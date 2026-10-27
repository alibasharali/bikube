import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  agentSetupConfigWrite,
  agentSetupWrite,
  parseConfigEdit,
  parseSwitchRequest
} from './agent-setup-writes'

// Main's check of the Agent setup page's switches (#68 D28) on real temporary folders.

let dir: string
let home: string
let folder: string
const local = (): string => join(folder, '.claude', 'settings.local.json')

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-agent-setup-writes-'))
  home = join(dir, 'home')
  folder = join(dir, 'proj')
  mkdirSync(home)
  mkdirSync(folder)
  write(
    join(home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'kit@market': [{ scope: 'user', installPath: '/x' }] }
    })
  )
  write(join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db' } } }))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseSwitchRequest', () => {
  it('takes a plugin or MCP server switch with a boolean, nothing else', () => {
    expect(parseSwitchRequest({ kind: 'plugin', key: 'k@m', enabled: true })).toEqual({
      kind: 'plugin',
      key: 'k@m',
      enabled: true
    })
    expect(parseSwitchRequest({ kind: 'mcpServer', name: 'db', enabled: false })).toEqual({
      kind: 'mcpServer',
      name: 'db',
      enabled: false
    })
    for (const bad of [
      null,
      'plugin',
      { kind: 'plugin', key: 'k@m', enabled: 'yes' },
      { kind: 'plugin', key: '', enabled: true },
      { kind: 'mcpServer', name: 7, enabled: true },
      // D22's edits are not switches.
      { kind: 'set', key: 'model', value: true },
      { kind: 'remove', key: 'model' }
    ]) {
      expect(parseSwitchRequest(bad)).toBeNull()
    }
  })
})

describe('agentSetupWrite', () => {
  it('D28: writes a plugin key installed_plugins.json lists, and a server .mcp.json lists', async () => {
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'plugin', key: 'kit@market', enabled: false }
      })
    ).toEqual({ ok: true })
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'mcpServer', name: 'db', enabled: true }
      })
    ).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(local(), 'utf8'))).toEqual({
      enabledPlugins: { 'kit@market': false },
      enabledMcpjsonServers: ['db']
    })
  })

  it('D28: refuses a plugin installed_plugins.json does not list, and a server .mcp.json does not', async () => {
    const refused = {
      ok: false,
      reason: 'refused',
      message: "Couldn't save: not listed in this workspace's setup"
    }
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'plugin', key: 'other@market', enabled: true }
      })
    ).toEqual(refused)
    // Inherited object keys are not listed either.
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'plugin', key: 'constructor', enabled: true }
      })
    ).toEqual(refused)
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'mcpServer', name: 'docs', enabled: true }
      })
    ).toEqual(refused)
    rmSync(join(folder, '.mcp.json'))
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'mcpServer', name: 'db', enabled: true }
      })
    ).toEqual(refused)
    expect(existsSync(local())).toBe(false)
  })

  it("D10: seeds settings.local.json's missing lists from the first lower file that sets them", async () => {
    write(join(folder, '.claude/settings.json'), JSON.stringify({ disabledMcpjsonServers: ['db'] }))
    write(
      join(home, '.claude/settings.json'),
      JSON.stringify({ disabledMcpjsonServers: ['user-only'], enabledMcpjsonServers: ['api'] })
    )
    expect(
      await agentSetupWrite({
        folder,
        home,
        edit: { kind: 'mcpServer', name: 'db', enabled: true }
      })
    ).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(local(), 'utf8'))).toEqual({
      enabledMcpjsonServers: ['api', 'db'],
      disabledMcpjsonServers: []
    })
  })
})

describe('parseConfigEdit', () => {
  it('D22: takes a set to a boolean or finite number, or a remove, of a named key', () => {
    expect(parseConfigEdit({ kind: 'set', key: 'verbose', value: true })).toEqual({
      kind: 'set',
      key: 'verbose',
      value: true
    })
    expect(parseConfigEdit({ kind: 'set', key: 'cleanupPeriodDays', value: 7 })).toEqual({
      kind: 'set',
      key: 'cleanupPeriodDays',
      value: 7
    })
    expect(parseConfigEdit({ kind: 'remove', key: 'verbose' })).toEqual({
      kind: 'remove',
      key: 'verbose'
    })
    for (const bad of [
      null,
      { kind: 'set', key: 'model', value: 'opus' },
      { kind: 'set', key: 'env', value: { A: '1' } },
      { kind: 'set', key: 'n', value: Number.NaN },
      { kind: 'set', key: 'n', value: Number.POSITIVE_INFINITY },
      { kind: 'set', key: '', value: true },
      { kind: 'set', key: '__proto__', value: true },
      { kind: 'remove', key: 3 },
      { kind: 'plugin', key: 'k@m', enabled: true }
    ]) {
      expect(parseConfigEdit(bad)).toBeNull()
    }
  })
})

describe('agentSetupConfigWrite', () => {
  const refused = {
    ok: false,
    reason: 'refused',
    message: "Couldn't save: only a boolean or number setting can be changed here"
  }
  const userSettings = (): string => join(home, '.claude/settings.json')

  beforeEach(() => {
    write(
      userSettings(),
      JSON.stringify({
        includeCoAuthoredBy: true,
        cleanupPeriodDays: 30,
        model: 'opus',
        enabledPlugins: { 'kit@market': true },
        enableAllProjectMcpServers: false
      })
    )
  })

  it('AC11: sets a boolean or number setting in settings.local.json, the user file untouched', async () => {
    const before = readFileSync(userSettings(), 'utf8')
    expect(
      await agentSetupConfigWrite({
        folder,
        home,
        edit: { kind: 'set', key: 'includeCoAuthoredBy', value: false }
      })
    ).toEqual({ ok: true })
    expect(
      await agentSetupConfigWrite({
        folder,
        home,
        edit: { kind: 'set', key: 'cleanupPeriodDays', value: 7 }
      })
    ).toEqual({ ok: true })
    expect(readFileSync(local(), 'utf8')).toBe(
      '{\n  "includeCoAuthoredBy": false,\n  "cleanupPeriodDays": 7\n}\n'
    )
    expect(readFileSync(userSettings(), 'utf8')).toBe(before)
  })

  it("D28: refuses a key whose effective value isn't of the new value's kind, or isn't set", async () => {
    for (const edit of [
      { kind: 'set', key: 'model', value: true },
      { kind: 'set', key: 'includeCoAuthoredBy', value: 1 },
      { kind: 'set', key: 'cleanupPeriodDays', value: false },
      // No new keys (D22).
      { kind: 'set', key: 'brandNew', value: true },
      // The keys other sections show.
      { kind: 'set', key: 'enableAllProjectMcpServers', value: true }
    ] as const) {
      expect(await agentSetupConfigWrite({ folder, home, edit })).toEqual(refused)
    }
    expect(existsSync(local())).toBe(false)
  })

  it('D10: checks the effective value, settings.local.json first', async () => {
    write(local(), JSON.stringify({ cleanupPeriodDays: 'soon' }))
    expect(
      await agentSetupConfigWrite({
        folder,
        home,
        edit: { kind: 'set', key: 'cleanupPeriodDays', value: 3 }
      })
    ).toEqual(refused)
    write(join(folder, '.claude/settings.json'), JSON.stringify({ model: false }))
    expect(
      await agentSetupConfigWrite({
        folder,
        home,
        edit: { kind: 'set', key: 'model', value: true }
      })
    ).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(local(), 'utf8'))).toEqual({
      cleanupPeriodDays: 'soon',
      model: true
    })
  })

  it('AC11: Reset removes a key settings.local.json sets, and nothing else', async () => {
    write(local(), '{\n  "verbose": true,\n  "includeCoAuthoredBy": false\n}\n')
    expect(
      await agentSetupConfigWrite({
        folder,
        home,
        edit: { kind: 'remove', key: 'includeCoAuthoredBy' }
      })
    ).toEqual({ ok: true })
    expect(readFileSync(local(), 'utf8')).toBe('{\n  "verbose": true\n}\n')
    // Only a key settings.local.json sets.
    expect(
      await agentSetupConfigWrite({ folder, home, edit: { kind: 'remove', key: 'model' } })
    ).toEqual(refused)
    write(local(), JSON.stringify({ enabledPlugins: {} }))
    expect(
      await agentSetupConfigWrite({ folder, home, edit: { kind: 'remove', key: 'enabledPlugins' } })
    ).toEqual(refused)
    expect(JSON.parse(readFileSync(local(), 'utf8'))).toEqual({ enabledPlugins: {} })
  })

  it('D22, D28: refuses to remove a read-only value settings.local.json sets', async () => {
    const text = '{\n  "model": "opus",\n  "env": {\n    "TOKEN": "x"\n  },\n  "verbose": true\n}\n'
    write(local(), text)
    for (const key of ['env', 'model']) {
      expect(await agentSetupConfigWrite({ folder, home, edit: { kind: 'remove', key } })).toEqual(
        refused
      )
    }
    expect(readFileSync(local(), 'utf8')).toBe(text)
  })

  it("D23: leaves an invalid settings.local.json as it is, with the writer's message", async () => {
    write(local(), '{ "verbose": ')
    expect(
      await agentSetupConfigWrite({
        folder,
        home,
        edit: { kind: 'set', key: 'includeCoAuthoredBy', value: false }
      })
    ).toEqual({
      ok: false,
      reason: 'invalid-json',
      message: "Couldn't save: settings.local.json is not valid JSON"
    })
    expect(readFileSync(local(), 'utf8')).toBe('{ "verbose": ')
  })
})
