import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeSettingsFs, writeSettingsLocal, type SettingsFs } from './settings-local-writer'

// The settings.local.json writer (#68 D23) on real temporary folders.

let dir: string
let folder: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-settings-local-'))
  folder = join(dir, 'proj')
  mkdirSync(folder)
  file = join(folder, '.claude', 'settings.local.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const put = (text: string): void => {
  mkdirSync(join(folder, '.claude'), { recursive: true })
  writeFileSync(file, text)
}
const text = (): string => readFileSync(file, 'utf8')

describe('writeSettingsLocal', () => {
  it('AC5: sets one plugin key, keeping every other key and their order, 2-space JSON and a final newline', async () => {
    put('{"model":"opus","enabledPlugins":{"a@m":true},"permissions":{"allow":["Bash(ls)"]}}')
    const result = await writeSettingsLocal(folder, {
      kind: 'plugin',
      key: 'kit@market',
      enabled: false
    })
    expect(result).toEqual({ ok: true })
    expect(text()).toBe(
      JSON.stringify(
        {
          model: 'opus',
          enabledPlugins: { 'a@m': true, 'kit@market': false },
          permissions: { allow: ['Bash(ls)'] }
        },
        null,
        2
      ) + '\n'
    )
    await writeSettingsLocal(folder, { kind: 'plugin', key: 'kit@market', enabled: true })
    expect(JSON.parse(text()).enabledPlugins).toEqual({ 'a@m': true, 'kit@market': true })
    expect(Object.keys(JSON.parse(text()))).toEqual(['model', 'enabledPlugins', 'permissions'])
  })

  it('creates .claude/ and the file when missing, the new key last', async () => {
    expect(await writeSettingsLocal(folder, { kind: 'plugin', key: 'k@m', enabled: true })).toEqual(
      { ok: true }
    )
    expect(text()).toBe('{\n  "enabledPlugins": {\n    "k@m": true\n  }\n}\n')
    put('{"a":1}')
    await writeSettingsLocal(folder, { kind: 'plugin', key: 'k@m', enabled: false })
    expect(Object.keys(JSON.parse(text()))).toEqual(['a', 'enabledPlugins'])
  })

  it('AC12: writes nothing to a file that is not valid JSON', async () => {
    put('{ "model": ')
    const result = await writeSettingsLocal(folder, { kind: 'plugin', key: 'k@m', enabled: true })
    expect(result).toEqual({
      ok: false,
      reason: 'invalid-json',
      message: "Couldn't save: settings.local.json is not valid JSON"
    })
    expect(text()).toBe('{ "model": ')
    expect(readdirSync(join(folder, '.claude'))).toEqual(['settings.local.json'])
  })

  it('writes nothing over a file that is not an object or holds the key in another form', async () => {
    put('[1]')
    expect(
      await writeSettingsLocal(folder, { kind: 'plugin', key: 'k@m', enabled: true })
    ).toMatchObject({ ok: false, reason: 'not-object' })
    expect(text()).toBe('[1]')
    put('{"enabledPlugins":["k@m"]}')
    expect(
      await writeSettingsLocal(folder, { kind: 'plugin', key: 'k@m', enabled: true })
    ).toMatchObject({
      ok: false,
      reason: 'unexpected-value',
      message: "Couldn't save: enabledPlugins in settings.local.json isn't an object"
    })
    put('{"disabledMcpjsonServers":"db"}')
    expect(
      await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: true })
    ).toMatchObject({
      ok: false,
      reason: 'unexpected-value',
      message: "Couldn't save: disabledMcpjsonServers in settings.local.json isn't a list"
    })
    expect(text()).toBe('{"disabledMcpjsonServers":"db"}')
  })

  it('AC6: moves an MCP server between enabledMcpjsonServers and disabledMcpjsonServers', async () => {
    put('{"model":"opus"}')
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: true })
    expect(JSON.parse(text())).toEqual({ model: 'opus', enabledMcpjsonServers: ['db'] })
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'api', enabled: true })
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: false })
    expect(JSON.parse(text())).toEqual({
      model: 'opus',
      enabledMcpjsonServers: ['api'],
      disabledMcpjsonServers: ['db']
    })
    // Once only, wherever it was.
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: false })
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: true })
    expect(JSON.parse(text())).toEqual({
      model: 'opus',
      enabledMcpjsonServers: ['api', 'db'],
      disabledMcpjsonServers: []
    })
  })

  it('sets a top-level key to a boolean or number and removes one (D22)', async () => {
    put('{"a":1,"includeCoAuthoredBy":true,"z":2}')
    await writeSettingsLocal(folder, { kind: 'set', key: 'includeCoAuthoredBy', value: false })
    await writeSettingsLocal(folder, { kind: 'set', key: 'cleanupPeriodDays', value: 7 })
    expect(text()).toBe(
      JSON.stringify({ a: 1, includeCoAuthoredBy: false, z: 2, cleanupPeriodDays: 7 }, null, 2) +
        '\n'
    )
    await writeSettingsLocal(folder, { kind: 'remove', key: 'includeCoAuthoredBy' })
    expect(JSON.parse(text())).toEqual({ a: 1, z: 2, cleanupPeriodDays: 7 })
    // Removing from a missing file creates nothing.
    rmSync(join(folder, '.claude'), { recursive: true })
    expect(await writeSettingsLocal(folder, { kind: 'remove', key: 'a' })).toEqual({ ok: true })
    expect(readdirSync(folder)).toEqual([])
  })

  it('writes a temporary file in the same folder and renames it over the file', async () => {
    put('{"a":1}')
    const calls: string[] = []
    const fs: SettingsFs = {
      ...nodeSettingsFs,
      writeFile: async (path, data) => {
        calls.push(`write ${path}`)
        // The file itself is untouched while the temporary one is written.
        expect(text()).toBe('{"a":1}')
        await writeFile(path, data)
      },
      rename: async (from, to) => {
        calls.push(`rename ${from} ${to}`)
        await rename(from, to)
      }
    }
    await writeSettingsLocal(folder, { kind: 'set', key: 'b', value: true }, fs)
    expect(calls).toHaveLength(2)
    const temp = calls[0]!.slice('write '.length)
    expect(temp.startsWith(join(folder, '.claude') + '/')).toBe(true)
    expect(temp).not.toBe(file)
    expect(calls[1]).toBe(`rename ${temp} ${file}`)
    expect(JSON.parse(text())).toEqual({ a: 1, b: true })
    expect(readdirSync(join(folder, '.claude'))).toEqual(['settings.local.json'])
  })

  it('removes the temporary file when the rename fails, leaving the file as it was', async () => {
    put('{"a":1}')
    const fs: SettingsFs = {
      ...nodeSettingsFs,
      rename: () => Promise.reject(new Error('EXDEV'))
    }
    expect(await writeSettingsLocal(folder, { kind: 'set', key: 'b', value: 1 }, fs)).toEqual({
      ok: false,
      reason: 'failed',
      message: "Couldn't save settings.local.json: EXDEV"
    })
    expect(text()).toBe('{"a":1}')
    expect(readdirSync(join(folder, '.claude'))).toEqual(['settings.local.json'])
  })

  it('writes nothing through a link: settings.local.json or .claude', async () => {
    const elsewhere = join(dir, 'elsewhere.json')
    writeFileSync(elsewhere, '{"a":1}')
    mkdirSync(join(folder, '.claude'))
    symlinkSync(elsewhere, file)
    expect(await writeSettingsLocal(folder, { kind: 'set', key: 'b', value: true })).toEqual({
      ok: false,
      reason: 'link',
      message: "Couldn't save: settings.local.json is a link"
    })
    expect(readFileSync(elsewhere, 'utf8')).toBe('{"a":1}')

    rmSync(join(folder, '.claude'), { recursive: true })
    const other = join(dir, 'other-claude')
    mkdirSync(other)
    symlinkSync(other, join(folder, '.claude'))
    expect(await writeSettingsLocal(folder, { kind: 'set', key: 'b', value: true })).toEqual({
      ok: false,
      reason: 'link',
      message: "Couldn't save: .claude is a link"
    })
    expect(readdirSync(other)).toEqual([])
  })

  it('writes nothing over a settings.local.json that is not a regular file', async () => {
    mkdirSync(file, { recursive: true })
    expect(await writeSettingsLocal(folder, { kind: 'set', key: 'b', value: true })).toEqual({
      ok: false,
      reason: 'link',
      message: "Couldn't save: settings.local.json is not a regular file"
    })
  })

  it('D10: seeds a missing list from the lower files so another server keeps its state', async () => {
    // A lower file approves api; switching db on or off leaves api approved.
    const inherited = { enabledMcpjsonServers: ['api'] }
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: true, inherited })
    expect(JSON.parse(text())).toEqual({ enabledMcpjsonServers: ['api', 'db'] })
    rmSync(file)
    await writeSettingsLocal(folder, { kind: 'mcpServer', name: 'db', enabled: false, inherited })
    expect(JSON.parse(text())).toEqual({
      disabledMcpjsonServers: ['db'],
      enabledMcpjsonServers: ['api']
    })
  })

  it('D10: turning on a server a lower file disables sticks', async () => {
    put('{"model":"opus"}')
    await writeSettingsLocal(folder, {
      kind: 'mcpServer',
      name: 'db',
      enabled: true,
      inherited: { disabledMcpjsonServers: ['db', 'old'] }
    })
    expect(JSON.parse(text())).toEqual({
      model: 'opus',
      enabledMcpjsonServers: ['db'],
      disabledMcpjsonServers: ['old']
    })
    // A list settings.local.json holds is its own: nothing is seeded into it.
    await writeSettingsLocal(folder, {
      kind: 'mcpServer',
      name: 'api',
      enabled: true,
      inherited: { enabledMcpjsonServers: ['x'], disabledMcpjsonServers: ['y'] }
    })
    expect(JSON.parse(text())).toEqual({
      model: 'opus',
      enabledMcpjsonServers: ['db', 'api'],
      disabledMcpjsonServers: ['old']
    })
  })
})
