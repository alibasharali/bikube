/**
 * The one-time move from Drovr, the app's old name: at the first launch, the old data folder
 * becomes the new one, its `drovr-*` files become `bikube-*`, saved paths inside it (worktree
 * cards) point at the new folder, git learns where those worktrees went, and Claude Code's
 * conversations for them follow, so the cards still resume.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export const OLD_NAME = 'drovr'
export const NEW_NAME = 'bikube'

export interface DataMigration {
  /** The old data folder, e.g. `<appData>/drovr`. */
  from: string
  /** The new one, e.g. `<appData>/bikube`. */
  to: string
  /** The user's home, holding `.claude/projects`. */
  home: string
  /** Runs `git <args>` in `cwd`; throws on failure. */
  git: (args: string[], cwd: string) => void
  /** Whether a process with this pid runs (the old app still holding its folder). */
  isAlive: (pid: number) => boolean
}

export type MigrationResult = 'moved' | 'nothing' | 'in use'

/** The old data folder for a new one: `bikube` → `drovr`, `bikube-dev` → `drovr-dev`. */
export function oldDataDir(newDir: string): string | null {
  const at = newDir.lastIndexOf('/')
  const base = newDir.slice(at + 1)
  if (base !== NEW_NAME && !base.startsWith(`${NEW_NAME}-`)) return null
  return `${newDir.slice(0, at + 1)}${OLD_NAME}${base.slice(NEW_NAME.length)}`
}

/** Moves `from` to `to` when only `from` exists and no running app holds it. */
export function migrateDataDir(m: DataMigration): MigrationResult {
  if (existsSync(m.to) || !existsSync(m.from)) return 'nothing'
  if (lockedByLiveApp(m.from, m.isAlive)) return 'in use'
  renameSync(m.from, m.to)

  for (const name of readdirSync(m.to)) {
    if (name.startsWith(`${OLD_NAME}-`)) {
      renameSync(join(m.to, name), join(m.to, NEW_NAME + name.slice(OLD_NAME.length)))
    }
  }

  const moved = rewriteFile(join(m.to, `${NEW_NAME}-state.json`), m.from, m.to)
  rewriteFile(join(m.to, `${NEW_NAME}-settings.json`), m.from, m.to)
  for (const { path, repo } of worktrees(moved)) {
    try {
      m.git(['worktree', 'repair', path], repo)
    } catch (err) {
      console.error(`worktree not repaired at ${path}: ${String(err)}`)
    }
  }
  moveClaudeProjects(join(m.home, '.claude', 'projects'), m.from, m.to)
  return 'moved'
}

/** Chromium's `SingletonLock` is a symlink to `<host>-<pid>`; a crashed app leaves a stale one. */
function lockedByLiveApp(dir: string, isAlive: (pid: number) => boolean): boolean {
  let target: string
  try {
    target = readlinkSync(join(dir, 'SingletonLock'))
  } catch {
    return false
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1))
  return Number.isInteger(pid) && pid > 0 && isAlive(pid)
}

/** Rewrites every string at or under `from` in a JSON file; gives the parsed result, else null. */
function rewriteFile(file: string, from: string, to: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // Missing or unreadable: the app's own reader handles that as before.
    return null
  }
  const rewritten = rewritePaths(parsed, from, to)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(rewritten))
  renameSync(tmp, file)
  return rewritten
}

/** `value` with every string equal to `from` or under `from/` moved to `to`. */
export function rewritePaths(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') {
    return value === from || value.startsWith(`${from}/`) ? to + value.slice(from.length) : value
  }
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, from, to))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewritePaths(v, from, to)]))
  }
  return value
}

/** Every card's `worktree` ({ path, repo }) in a saved state, wherever it is nested. */
function worktrees(value: unknown): { path: string; repo: string }[] {
  const found: { path: string; repo: string }[] = []
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v !== null && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        if (k === 'worktree' && child !== null && typeof child === 'object') {
          const { path, repo } = child as Record<string, unknown>
          if (typeof path === 'string' && typeof repo === 'string') found.push({ path, repo })
        }
        walk(child)
      }
    }
  }
  walk(value)
  return found
}

/** Claude Code's folder name for a project: every character but letters and digits as `-`. */
export function claudeProjectName(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Renames Claude Code's project folders for paths under `from` (its worktrees) to `to`'s. */
function moveClaudeProjects(projects: string, from: string, to: string): void {
  const oldPrefix = claudeProjectName(join(from, 'worktrees'))
  const newPrefix = claudeProjectName(join(to, 'worktrees'))
  let names: string[]
  try {
    names = readdirSync(projects)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(`${oldPrefix}-`)) continue
    const target = join(projects, newPrefix + name.slice(oldPrefix.length))
    if (existsSync(target)) continue
    try {
      renameSync(join(projects, name), target)
    } catch (err) {
      console.error(`Claude Code project not moved: ${name}: ${String(err)}`)
    }
  }
}
