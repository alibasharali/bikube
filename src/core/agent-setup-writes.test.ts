import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentSetupWrite, parseSwitchRequest } from './agent-setup-writes'

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
