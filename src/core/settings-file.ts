/**
 * The settings file owned by main (#10 D6, D7), on the state file's pattern: plain TS with an
 * injected fs, so Vitest drives it with a fake directory and fake timers. Unlike the state file,
 * a bad settings file is never renamed aside: its invalid fields take their defaults and the
 * whole file is rewritten on the next change.
 */
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  SETTINGS_FILE_NAME,
  parseSettingsFile,
  serializeSettings,
  validateSettings,
  type Settings
} from './settings'
import type { StateFileFs } from './state-file'

export const SETTINGS_SAVE_INTERVAL_MS = 200

export interface SettingsFileOptions {
  /** The directory holding `drovr-settings.json` (Electron's `userData`). */
  dir: string
  fs: StateFileFs
  log?: (message: string) => void
}

export class SettingsFile {
  private readonly path: string
  private readonly tmpPath: string
  private latest: Settings | null = null
  /** Whether `latest` has changes not yet written; a missing file stays unwritten until one. */
  private pending = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: SettingsFileOptions) {
    this.path = join(options.dir, SETTINGS_FILE_NAME)
    this.tmpPath = `${this.path}.tmp`
  }

  /** Main's latest settings: the last valid save, else the file's (D7), else the defaults. */
  load(): Settings {
    if (this.latest === null) this.latest = this.readFile()
    return { ...this.latest }
  }

  /**
   * Keeps `value` when every field is valid (D1) and writes it within 200 ms; saves in between
   * replace it. Returns the settings kept (family normalized), or null, changing nothing, for an
   * invalid value.
   */
  save(value: unknown): Settings | null {
    const checked = validateSettings(value)
    if (checked === null) return null
    this.load()
    this.latest = checked
    this.pending = true
    if (this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.write()
      }, SETTINGS_SAVE_INTERVAL_MS)
    }
    return { ...checked }
  }

  /** Writes any pending change now, synchronously (before quit). */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.write()
  }

  /** Temp file, fsync, rename: a crash leaves either the old file or the whole new one. */
  private write(): void {
    if (!this.pending || this.latest === null) return
    const fs = this.options.fs
    try {
      const fd = fs.openSync(this.tmpPath, 'w')
      try {
        fs.writeFileSync(fd, serializeSettings(this.latest), 'utf8')
        fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
      fs.renameSync(this.tmpPath, this.path)
      this.pending = false
    } catch (err) {
      // Keep the change pending: the next save or flush tries again.
      this.log(`settings file not written: ${String(err)}`)
    }
  }

  private readFile(): Settings {
    let text: string
    try {
      text = this.options.fs.readFileSync(this.path, 'utf8')
    } catch (err) {
      if (!isMissing(err)) this.log(`settings file not readable (${String(err)}); using defaults`)
      return { ...DEFAULT_SETTINGS }
    }
    const parsed = parseSettingsFile(text)
    if (parsed.rejected) {
      this.log(`settings file ${parsed.rejected}; using defaults`)
    } else if (parsed.replaced.length > 0) {
      this.log(`settings file: invalid ${parsed.replaced.join(', ')} replaced with defaults`)
    }
    return parsed.settings
  }

  private log(message: string): void {
    const log = this.options.log ?? console.error
    log(message)
  }
}

const isMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT'
