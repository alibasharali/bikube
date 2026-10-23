import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeProjectName,
  migrateDataDir,
  moveOrRefuse,
  oldDataDir,
  rewritePaths,
  runsOldApp
} from './data-migration'

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

let dir: string
let appData: string
let home: string
let from: string
let to: string

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'bikube-migration-')))
  appData = join(dir, 'Application Support')
  home = join(dir, 'home')
  from = join(appData, 'drovr')
  to = join(appData, 'bikube')
  mkdirSync(appData, { recursive: true })
  mkdirSync(home)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const migrate = (
  isOldApp: (host: string, pid: number) => boolean = () => false
): ReturnType<typeof migrateDataDir> => migrateDataDir({ from, to, home, git, isOldApp })

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, JSON.stringify(value, null, 2))
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))

describe('oldDataDir', () => {
  it('maps the new data folder to the old one, the development build’s too', () => {
    expect(oldDataDir('/a/Application Support/bikube')).toBe('/a/Application Support/drovr')
    expect(oldDataDir('/a/.config/bikube-dev')).toBe('/a/.config/drovr-dev')
  })

  it('has none for a folder of another name (a test’s own data folder)', () => {
    expect(oldDataDir('/tmp/e2e-data-123')).toBeNull()
    expect(oldDataDir('/tmp/bikubes')).toBeNull()
  })
})

describe('rewritePaths', () => {
  it('moves strings at or under the old folder, nothing else', () => {
    expect(
      rewritePaths(
        { a: '/x/drovr', b: ['/x/drovr/worktrees/w'], c: '/x/drovr-dev/w', d: 3, e: null },
        '/x/drovr',
        '/x/bikube'
      )
    ).toEqual({ a: '/x/bikube', b: ['/x/bikube/worktrees/w'], c: '/x/drovr-dev/w', d: 3, e: null })
  })
})

describe('migrateDataDir', () => {
  it('does nothing without an old folder, or once the new one exists', () => {
    expect(migrate()).toBe('nothing')
    mkdirSync(from)
    mkdirSync(to)
    writeFileSync(join(from, 'drovr-state.json'), '{}')
    expect(migrate()).toBe('nothing')
    expect(existsSync(join(from, 'drovr-state.json'))).toBe(true)
  })

  it('leaves the folder while the old app still runs, and moves it after a crash', () => {
    mkdirSync(from)
    symlinkSync('my-host.local-4242', join(from, 'SingletonLock'))
    expect(migrate((host, pid) => host === 'my-host.local' && pid === 4242)).toBe('in use')
    expect(existsSync(from)).toBe(true)
    expect(existsSync(to)).toBe(false)
    expect(migrate(() => false)).toBe('moved')
    expect(existsSync(to)).toBe(true)
  })

  it('moves the folder, renames its drovr files and keeps the rest', () => {
    mkdirSync(join(from, 'scrollback'), { recursive: true })
    writeFileSync(join(from, 'scrollback', 'abc'), 'kept output')
    writeJson(join(from, 'drovr-settings.json'), {
      version: 1,
      settings: { fontSize: 14, terminalThemeDark: 'Drovr Dark', terminalThemeLight: 'Drovr Light' }
    })
    writeFileSync(join(from, 'drovr-update.json'), '{"skipped":"0.1.4"}')
    writeFileSync(join(from, 'drovr-state.corrupt-1.json'), 'not json')
    writeJson(join(from, 'drovr-state.json'), { version: 1, state: { workspaces: [] } })

    expect(migrate()).toBe('moved')
    expect(existsSync(from)).toBe(false)
    expect(readFileSync(join(to, 'scrollback', 'abc'), 'utf8')).toBe('kept output')
    expect(readJson(join(to, 'bikube-settings.json'))).toEqual({
      version: 1,
      settings: {
        fontSize: 14,
        terminalThemeDark: 'Bikube Dark',
        terminalThemeLight: 'Bikube Light'
      }
    })
    expect(readJson(join(to, 'bikube-update.json'))).toEqual({ skipped: '0.1.4' })
    expect(readFileSync(join(to, 'bikube-state.corrupt-1.json'), 'utf8')).toBe('not json')
    expect(readJson(join(to, 'bikube-state.json'))).toEqual({
      version: 1,
      state: { workspaces: [] }
    })
  })

  it('points worktree cards and shells at the new folder and repairs git’s links', () => {
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    git(['init', '-q', '-b', 'main'], repo)
    git(
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'one'],
      repo
    )
    const oldTree = join(from, 'worktrees', 'repo-1a2b3c')
    mkdirSync(join(from, 'worktrees'), { recursive: true })
    git(['worktree', 'add', '-q', '-b', 'card', oldTree], repo)
    const newTree = join(to, 'worktrees', 'repo-1a2b3c')
    const state = (tree: string): unknown => ({
      version: 1,
      state: {
        workspaces: [
          {
            id: 'w',
            directory: repo,
            columns: [
              {
                cards: [
                  {
                    id: 'c',
                    directory: join(tree, 'app'),
                    worktree: { path: tree, branch: 'card', repo }
                  },
                  { id: 'plain', directory: repo }
                ]
              }
            ],
            shells: [{ id: 's', directory: join(tree, 'app') }]
          }
        ]
      }
    })
    writeJson(join(from, 'drovr-state.json'), state(oldTree))

    expect(migrate()).toBe('moved')
    expect(readJson(join(to, 'bikube-state.json'))).toEqual(state(newTree))
    // git finds the moved worktree from the repository and the repository from the worktree.
    expect(git(['worktree', 'list', '--porcelain'], repo)).toContain(`worktree ${newTree}`)
    expect(git(['worktree', 'list', '--porcelain'], repo)).not.toContain('prunable')
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], newTree)).toBe('card')
  })

  it('moves Claude Code’s conversations for the worktrees, never another project’s', () => {
    mkdirSync(join(from, 'worktrees'), { recursive: true })
    writeJson(join(from, 'drovr-state.json'), { version: 1, state: { workspaces: [] } })
    const projects = join(home, '.claude', 'projects')
    const old = claudeProjectName(join(from, 'worktrees', 'repo-1a2b3c', 'app'))
    const other = claudeProjectName(join(dir, 'Repos', 'drovr'))
    const taken = claudeProjectName(join(from, 'worktrees', 'taken'))
    for (const name of [old, other, taken]) mkdirSync(join(projects, name), { recursive: true })
    writeFileSync(join(projects, old, 'session.jsonl'), '{}')
    mkdirSync(join(projects, claudeProjectName(join(to, 'worktrees', 'taken'))))

    expect(migrate()).toBe('moved')
    const moved = claudeProjectName(join(to, 'worktrees', 'repo-1a2b3c', 'app'))
    expect(old).toContain('-Application-Support-drovr-worktrees-repo-1a2b3c-app')
    expect(readFileSync(join(projects, moved, 'session.jsonl'), 'utf8')).toBe('{}')
    expect(existsSync(join(projects, old))).toBe(false)
    expect(existsSync(join(projects, other))).toBe(true)
    expect(existsSync(join(projects, taken))).toBe(true)
  })
})

describe('moveOrRefuse', () => {
  it('refuses to start while Drovr runs, creating nothing, then moves once it has quit', () => {
    mkdirSync(from)
    writeFileSync(join(from, 'drovr-state.json'), '{}')
    symlinkSync('my-host.local-4242', join(from, 'SingletonLock'))
    let running = true
    const run = (): ReturnType<typeof moveOrRefuse> =>
      moveOrRefuse({ from, to, home, git, isOldApp: () => running })

    const refused = run()
    expect(refused.start).toBe(false)
    expect(refused.start === false && refused.message).toContain('Quit Drovr')
    expect(existsSync(to)).toBe(false)

    running = false
    expect(run()).toEqual({ start: true })
    expect(existsSync(join(to, 'bikube-state.json'))).toBe(true)
    expect(existsSync(from)).toBe(false)
  })

  it('refuses to start when the folder can’t be moved, and starts once it has been', () => {
    mkdirSync(from)
    // A file where the new folder's parent should be makes the rename fail.
    const blocked = {
      from,
      to: join(dir, 'not-a-folder', 'bikube'),
      home,
      git,
      isOldApp: () => false
    }
    writeFileSync(join(dir, 'not-a-folder'), '')
    const refused = moveOrRefuse(blocked)
    expect(refused.start).toBe(false)
    expect(refused.start === false && refused.message).toContain('couldn’t move')
    expect(existsSync(from)).toBe(true)

    expect(moveOrRefuse({ from, to, home, git, isOldApp: () => false })).toEqual({ start: true })
  })

  it('starts when there is nothing to move', () => {
    expect(moveOrRefuse({ from, to, home, git, isOldApp: () => true })).toEqual({ start: true })
  })
})

describe('runsOldApp', () => {
  it('is Drovr, packaged or the development build, on this machine', () => {
    expect(runsOldApp('mac', 'mac', '/Applications/Drovr.app/Contents/MacOS/Drovr')).toBe(true)
    expect(runsOldApp('box', 'box', 'drovr')).toBe(true)
    expect(
      runsOldApp('mac', 'mac', '/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    ).toBe(true)
  })

  it('is not a pid reused by another process, a dead pid or another machine’s lock', () => {
    expect(runsOldApp('mac', 'mac', '/usr/sbin/cfprefsd')).toBe(false)
    expect(runsOldApp('mac', 'mac', '')).toBe(false)
    expect(runsOldApp('other', 'mac', 'Drovr')).toBe(false)
  })

  it('lets a stale lock whose pid now runs something else be moved', () => {
    mkdirSync(from)
    symlinkSync('mac-4242', join(from, 'SingletonLock'))
    expect(migrate((host) => runsOldApp(host, 'mac', '/usr/sbin/cfprefsd'))).toBe('moved')
  })
})
