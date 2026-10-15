import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, PREFERENCE_DEFAULTS } from './settings'
import { SETTINGS_SAVE_INTERVAL_MS, SettingsFile } from './settings-file'
import type { StateFileFs } from './state-file'

/** The settings after #10's three, at their defaults. */
const NEW_FIELDS = {
  shell: '',
  terminalThemeDark: 'Drovr Dark',
  terminalThemeLight: 'Drovr Light',
  useGhosttyTheme: false,
  ...PREFERENCE_DEFAULTS
}

/** The same fields as the file holds them: preferences at their defaults are left out. */
const FILE_FIELDS = {
  shell: '',
  terminalThemeDark: 'Drovr Dark',
  terminalThemeLight: 'Drovr Light',
  useGhosttyTheme: false
}

const DIR = '/data'
const FILE = '/data/drovr-settings.json'
const TMP = '/data/drovr-settings.json.tmp'

/** An in-memory directory that records every call that changes it, in order. */
class FakeFs implements StateFileFs {
  files = new Map<string, string>()
  events: string[] = []
  failWrites = false
  readError: string | null = null
  private open = new Map<number, string>()
  private nextFd = 3
  readFileSync(path: string): string {
    if (this.readError) throw Object.assign(new Error(this.readError), { code: this.readError })
    const text = this.files.get(path)
    if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return text
  }
  openSync(path: string): number {
    const fd = this.nextFd++
    this.open.set(fd, path)
    this.files.set(path, '')
    this.events.push(`open ${path}`)
    return fd
  }
  writeFileSync(fd: number, data: string): void {
    if (this.failWrites) throw new Error('EIO')
    const path = this.open.get(fd)!
    this.events.push(`write ${path}`)
    this.files.set(path, data)
  }
  fsyncSync(fd: number): void {
    this.events.push(`fsync ${this.open.get(fd)}`)
  }
  closeSync(fd: number): void {
    this.events.push(`close ${this.open.get(fd)}`)
    this.open.delete(fd)
  }
  renameSync(from: string, to: string): void {
    const text = this.files.get(from)
    if (text === undefined) throw new Error(`ENOENT: ${from}`)
    this.events.push(`rename ${from} -> ${to}`)
    this.files.delete(from)
    this.files.set(to, text)
  }
}

let fs: FakeFs
const log = vi.fn()
const open = (): SettingsFile => new SettingsFile({ dir: DIR, fs, log, platform: 'linux' })

beforeEach(() => {
  fs = new FakeFs()
  log.mockReset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('SettingsFile.load (#10 D6, D7)', () => {
  it('gives defaults and writes nothing when the file is missing', () => {
    const file = open()
    expect(file.load()).toEqual(DEFAULT_SETTINGS)
    file.flush()
    vi.advanceTimersByTime(1000)
    expect(fs.events).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('keeps valid fields, logs the replaced ones and never renames the file (AC8)', () => {
    const text =
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false}}'
    fs.files.set(FILE, text)
    const file = open()
    expect(file.load()).toEqual({
      theme: 'system',
      fontSize: 13,
      fontFamily: 'Courier New',
      ...NEW_FIELDS
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('theme, fontSize'))
    file.flush()
    expect(fs.events).toEqual([])
    expect(fs.files.get(FILE)).toBe(text)
  })

  it('gives all defaults for a file that is not JSON and logs it, leaving it in place', () => {
    fs.files.set(FILE, 'not json')
    expect(open().load()).toEqual(DEFAULT_SETTINGS)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not JSON'))
    expect(fs.files.get(FILE)).toBe('not json')
  })

  it('gives all defaults when the file cannot be read', () => {
    fs.files.set(FILE, '{"version":1,"settings":{"theme":"light"}}')
    fs.readError = 'EACCES'
    expect(open().load()).toEqual(DEFAULT_SETTINGS)
    expect(log).toHaveBeenCalled()
  })
})

describe('SettingsFile.save (#10 D6)', () => {
  it('writes the whole file within 200 ms after a change, via temp, fsync and rename (AC8)', () => {
    fs.files.set(
      FILE,
      '{"version":1,"settings":{"theme":"neon","fontSize":99,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false}}'
    )
    const file = open()
    const loaded = file.load()
    expect(file.save({ ...loaded, theme: 'dark' })).toEqual({
      theme: 'dark',
      fontSize: 13,
      fontFamily: 'Courier New',
      ...NEW_FIELDS
    })
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS - 1)
    expect(fs.events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(fs.events).toEqual([
      `open ${TMP}`,
      `write ${TMP}`,
      `fsync ${TMP}`,
      `close ${TMP}`,
      `rename ${TMP} -> ${FILE}`
    ])
    expect(fs.files.get(FILE)).toBe(
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Courier New","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false}}'
    )
  })

  it('coalesces saves within 200 ms into one write of the last', () => {
    const file = open()
    file.save({ ...DEFAULT_SETTINGS, theme: 'light' })
    file.save({ ...DEFAULT_SETTINGS, theme: 'dark', fontSize: 20 })
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS)
    expect(fs.events.filter((e) => e.startsWith('write'))).toHaveLength(1)
    expect(JSON.parse(fs.files.get(FILE)!)).toEqual({
      version: 1,
      settings: {
        theme: 'dark',
        fontSize: 20,
        fontFamily: 'Menlo, Consolas, monospace',
        ...FILE_FIELDS
      }
    })
  })

  it('ignores an invalid save: returns null, keeps the latest and writes nothing', () => {
    const file = open()
    expect(file.save({ theme: 'dark', fontSize: 7, fontFamily: '', ...NEW_FIELDS })).toBeNull()
    expect(file.save('dark')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(fs.events).toEqual([])
    expect(file.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('stores the family trimmed, and the default for an empty one', () => {
    const file = open()
    expect(
      file.save({
        theme: 'light',
        fontSize: 16,
        fontFamily: '  Courier New, monospace  ',
        ...NEW_FIELDS
      })
    ).toEqual({ theme: 'light', fontSize: 16, fontFamily: 'Courier New, monospace', ...NEW_FIELDS })
    file.flush()
    expect(fs.files.get(FILE)).toBe(
      '{"version":1,"settings":{"theme":"light","fontSize":16,"fontFamily":"Courier New, monospace","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false}}'
    )
    expect(
      file.save({ theme: 'light', fontSize: 16, fontFamily: '   ', ...NEW_FIELDS })?.fontFamily
    ).toBe('Menlo, Consolas, monospace')
  })

  it('flush writes a pending change at once and cancels the timer', () => {
    const file = open()
    file.save({ ...DEFAULT_SETTINGS, theme: 'dark' })
    file.flush()
    expect(JSON.parse(fs.files.get(FILE)!).settings.theme).toBe('dark')
    const writes = fs.events.length
    vi.advanceTimersByTime(1000)
    expect(fs.events).toHaveLength(writes)
  })

  it('keeps a failed write pending and retries it on flush', () => {
    const file = open()
    fs.failWrites = true
    file.save({ ...DEFAULT_SETTINGS, theme: 'dark' })
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS)
    expect(fs.files.has(FILE)).toBe(false)
    expect(log).toHaveBeenCalled()
    fs.failWrites = false
    file.flush()
    expect(JSON.parse(fs.files.get(FILE)!).settings.theme).toBe('dark')
  })
})

describe('SettingsFile sync folder (#13 D10, AC12)', () => {
  it('loads the sync folder from the file, off when missing', () => {
    expect(open().syncFolder()).toBeNull()
    fs.files.set(
      FILE,
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false,"syncFolder":"/sync"}}'
    )
    const file = open()
    expect(file.syncFolder()).toBe('/sync')
    expect(file.load()).toEqual({ theme: 'dark', fontSize: 13, fontFamily: 'Menlo', ...NEW_FIELDS })
  })

  it('writes a new sync folder with the other settings, and leaves it out once off', () => {
    const file = open()
    file.setSyncFolder('/sync')
    expect(file.syncFolder()).toBe('/sync')
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS)
    expect(fs.files.get(FILE)).toBe(
      '{"version":1,"settings":{"theme":"system","fontSize":13,"fontFamily":"Menlo, Consolas, monospace","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false,"syncFolder":"/sync"}}'
    )
    file.setSyncFolder(null)
    file.flush()
    expect(JSON.parse(fs.files.get(FILE)!).settings).not.toHaveProperty('syncFolder')
  })

  it('keeps the sync folder when settings are saved, whatever the payload holds', () => {
    fs.files.set(
      FILE,
      '{"version":1,"settings":{"theme":"dark","fontSize":13,"fontFamily":"Menlo","shell":"","terminalThemeDark":"Drovr Dark","terminalThemeLight":"Drovr Light","useGhosttyTheme":false,"syncFolder":"/sync"}}'
    )
    const file = open()
    file.save({
      theme: 'light',
      fontSize: 13,
      fontFamily: 'Menlo',
      ...NEW_FIELDS,
      syncFolder: '/elsewhere'
    })
    file.flush()
    expect(JSON.parse(fs.files.get(FILE)!).settings).toEqual({
      theme: 'light',
      fontSize: 13,
      fontFamily: 'Menlo',
      ...FILE_FIELDS,
      syncFolder: '/sync'
    })
    expect(file.syncFolder()).toBe('/sync')
  })
})

describe('shortcuts in SettingsFile (#31 D9, AC6)', () => {
  it('writes only the changed shortcut, keeps it across a restart, and drops it on reset', () => {
    const file = open()
    const loaded = file.load()
    expect(file.save({ ...loaded, shortcuts: { splitRight: 'Ctrl+Alt+R' } })).toEqual({
      ...DEFAULT_SETTINGS,
      shortcuts: { splitRight: 'Ctrl+Alt+R' }
    })
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS)
    expect(JSON.parse(fs.files.get(FILE)!).settings.shortcuts).toEqual({ splitRight: 'Ctrl+Alt+R' })

    const restarted = open()
    expect(restarted.load().shortcuts).toEqual({ splitRight: 'Ctrl+Alt+R' })
    restarted.save({ ...restarted.load(), shortcuts: {} })
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS)
    expect(JSON.parse(fs.files.get(FILE)!).settings).not.toHaveProperty('shortcuts')
  })

  it('rejects a save whose shortcuts share one, changing nothing', () => {
    const file = open()
    const bad = { ...DEFAULT_SETTINGS, shortcuts: { splitRight: 'Ctrl+Shift+B' } }
    expect(file.save(bad)).toBeNull()
    vi.advanceTimersByTime(SETTINGS_SAVE_INTERVAL_MS)
    expect(fs.events).toEqual([])
  })

  it('logs shortcuts that fell back when reading', () => {
    fs.files.set(
      FILE,
      JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, shortcuts: { back: 'B' } } })
    )
    expect(open().load()).toEqual(DEFAULT_SETTINGS)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shortcuts'))
  })
})
