import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLAUDE_RETENTION_DAYS, readClaudeRetention, setClaudeRetention } from './claude-retention'
import { retentionDays } from './claude-retention-types'

// Claude Code's `cleanupPeriodDays` in the user's settings (#80 D2, D3, D4), on real temp folders.

let home: string
let file: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bikube-retention-'))
  file = join(home, '.claude', 'settings.json')
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

const put = (text: string): void => {
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(file, text)
}
const text = (): string => readFileSync(file, 'utf8')

describe('readClaudeRetention', () => {
  it('reads low at 30 days with no settings file or no .claude folder', async () => {
    expect(await readClaudeRetention(home)).toEqual({ state: 'low', days: 30 })
    mkdirSync(join(home, '.claude'))
    expect(await readClaudeRetention(home)).toEqual({ state: 'low', days: 30 })
  })

  it('reads low at 30 days when the file sets no cleanupPeriodDays', async () => {
    put('{"model":"opus"}')
    expect(await readClaudeRetention(home)).toEqual({ state: 'low', days: 30 })
  })

  it('reads low with the set value below 3650, ok from 3650', async () => {
    put('{"cleanupPeriodDays":60}')
    expect(await readClaudeRetention(home)).toEqual({ state: 'low', days: 60 })
    put('{"cleanupPeriodDays":3650}')
    expect(await readClaudeRetention(home)).toEqual({ state: 'ok', days: 3650 })
    put('{"cleanupPeriodDays":5000}')
    expect(await readClaudeRetention(home)).toEqual({ state: 'ok', days: 5000 })
  })

  it('reads unknown for a non-number value, invalid JSON or a non-object', async () => {
    put('{"cleanupPeriodDays":"30"}')
    expect(await readClaudeRetention(home)).toEqual({ state: 'unknown' })
    put('{ nope')
    expect(await readClaudeRetention(home)).toEqual({ state: 'unknown' })
    put('[1]')
    expect(await readClaudeRetention(home)).toEqual({ state: 'unknown' })
  })

  it('reads unknown when the file or .claude is a link, or the file not a regular one', async () => {
    const real = join(home, 'real.json')
    writeFileSync(real, '{"cleanupPeriodDays":30}')
    mkdirSync(join(home, '.claude'))
    symlinkSync(real, file)
    expect(await readClaudeRetention(home)).toEqual({ state: 'unknown' })

    rmSync(join(home, '.claude'), { recursive: true })
    const dots = join(home, 'dots')
    mkdirSync(dots)
    writeFileSync(join(dots, 'settings.json'), '{}')
    symlinkSync(dots, join(home, '.claude'))
    expect(await readClaudeRetention(home)).toEqual({ state: 'unknown' })

    rmSync(join(home, '.claude'))
    mkdirSync(file, { recursive: true })
    expect(await readClaudeRetention(home)).toEqual({ state: 'unknown' })
  })
})

describe('setClaudeRetention', () => {
  it('sets cleanupPeriodDays to 3650, keeping every other key and their order', async () => {
    put('{"model":"opus","cleanupPeriodDays":30,"env":{"A":"1"}}')
    expect(await setClaudeRetention(home)).toEqual({ ok: true })
    expect(text()).toBe(
      '{\n  "model": "opus",\n  "cleanupPeriodDays": 3650,\n  "env": {\n    "A": "1"\n  }\n}\n'
    )
    expect(CLAUDE_RETENTION_DAYS).toBe(3650)
  })

  it('adds the key last to a file without it', async () => {
    put('{"model":"opus"}')
    expect(await setClaudeRetention(home)).toEqual({ ok: true })
    expect(text()).toBe('{\n  "model": "opus",\n  "cleanupPeriodDays": 3650\n}\n')
    expect(readdirSync(join(home, '.claude'))).toEqual(['settings.json'])
  })

  it('creates .claude and the file when missing', async () => {
    expect(await setClaudeRetention(home)).toEqual({ ok: true })
    expect(text()).toBe('{\n  "cleanupPeriodDays": 3650\n}\n')
  })

  it('leaves 3650 or more alone', async () => {
    put('{"cleanupPeriodDays":5000}')
    expect(await setClaudeRetention(home)).toEqual({ ok: true })
    expect(text()).toBe('{"cleanupPeriodDays":5000}')
  })

  it('writes nothing for invalid JSON, a non-object or a non-number value', async () => {
    put('{ nope')
    expect(await setClaudeRetention(home)).toEqual({
      ok: false,
      reason: 'invalid-json',
      message: "Couldn't save: settings.json is not valid JSON"
    })
    expect(text()).toBe('{ nope')
    put('[]')
    expect(await setClaudeRetention(home)).toMatchObject({
      ok: false,
      message: "Couldn't save: settings.json is not a JSON object"
    })
    put('{"cleanupPeriodDays":"30"}')
    expect(await setClaudeRetention(home)).toMatchObject({
      ok: false,
      message: "Couldn't save: cleanupPeriodDays in settings.json isn't a number"
    })
    expect(text()).toBe('{"cleanupPeriodDays":"30"}')
  })

  it('writes nothing through a link, the file or .claude', async () => {
    const real = join(home, 'real.json')
    writeFileSync(real, '{"cleanupPeriodDays":30}')
    mkdirSync(join(home, '.claude'))
    symlinkSync(real, file)
    expect(await setClaudeRetention(home)).toMatchObject({
      ok: false,
      reason: 'link',
      message: "Couldn't save: settings.json is a link"
    })
    expect(readFileSync(real, 'utf8')).toBe('{"cleanupPeriodDays":30}')

    rmSync(join(home, '.claude'), { recursive: true })
    const dots = join(home, 'dots')
    mkdirSync(dots)
    symlinkSync(dots, join(home, '.claude'))
    expect(await setClaudeRetention(home)).toMatchObject({
      ok: false,
      message: "Couldn't save: .claude is a link"
    })
    expect(readdirSync(dots)).toEqual([])
  })
})

describe('retentionDays (#80 D12)', () => {
  it('names the set value, low or ok, and 30 when unknown or not read', () => {
    expect(retentionDays({ state: 'low', days: 60 })).toBe(60)
    expect(retentionDays({ state: 'ok', days: 5000 })).toBe(5000)
    expect(retentionDays({ state: 'unknown' })).toBe(30)
    expect(retentionDays(null)).toBe(30)
  })
})
