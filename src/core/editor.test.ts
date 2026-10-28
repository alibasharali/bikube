import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editorPlan, editorShell, openFile, runEditor, type OpenDeps } from './editor'
import { editorCandidates } from './editor-candidates'
import { isOpenNote, listedFileErrorLine, openErrorLine } from './open-result'

/** Looks for the named editors on the login shell's PATH only (#70 D1 off macOS and Linux). */
const PATH_ONLY = { platform: 'none', home: '/nowhere' }

describe('editorShell (#55 D15)', () => {
  it('is the Shell setting, else $SHELL, else /bin/sh', () => {
    expect(editorShell('/opt/homebrew/bin/fish', { SHELL: '/bin/zsh' })).toBe(
      '/opt/homebrew/bin/fish'
    )
    expect(editorShell('', { SHELL: '/bin/zsh' })).toBe('/bin/zsh')
    expect(editorShell('', {})).toBe('/bin/sh')
  })
})

describe('editorPlan (#55 D13, D14, D15, AC16)', () => {
  const folder = '/work/my repo'
  const file = "/work/my repo/src/it's a.ts"

  it('gives VS Code, Cursor and Zed their candidates (#70 D1), the folder and the file as positional arguments', () => {
    for (const [editor, name] of [
      ['vscode', 'code'],
      ['cursor', 'cursor'],
      ['zed', 'zed']
    ] as const) {
      const candidates = editorCandidates(editor, 'linux', '/h')
      const plan = editorPlan(editor, '', '/bin/zsh', folder, file, {
        platform: 'linux',
        home: '/h'
      })
      expect(plan).toMatchObject({ kind: 'run', name, command: '/bin/zsh' })
      if (plan.kind !== 'run') throw new Error('not run')
      expect(plan.args.slice(0, 2)).toEqual(['-l', '-c'])
      expect(plan.args.slice(3)).toEqual([
        'bikube',
        String(candidates.length),
        ...candidates,
        folder,
        file
      ])
    }
  })

  it('runs a custom command as the only text the shell parses, the file as "$1"', () => {
    expect(editorPlan('custom', '  subl -n ', '/bin/bash', folder, file, PATH_ONLY)).toEqual({
      kind: 'run',
      name: 'subl',
      command: '/bin/bash',
      args: ['-l', '-c', 'subl -n "$1"', 'bikube', file]
    })
  })

  it("uses fish's own syntax under fish, where the arguments are $argv", () => {
    const plan = editorPlan('zed', '', '/opt/homebrew/bin/fish', folder, file, PATH_ONLY)
    expect(plan).toMatchObject({ kind: 'run', name: 'zed', command: '/opt/homebrew/bin/fish' })
    if (plan.kind !== 'run') throw new Error('not run')
    expect(plan.args[2]).toContain('$argv')
    expect(plan.args.slice(3)).toEqual(['2', 'zed', 'zeditor', folder, file])
    expect(editorPlan('custom', 'subl -n', '/usr/bin/fish', folder, file, PATH_ONLY)).toEqual({
      kind: 'run',
      name: 'subl',
      command: '/usr/bin/fish',
      args: ['-l', '-c', 'subl -n $argv[1]', file]
    })
  })

  it('falls back to /bin/sh as a login shell for a shell with neither syntax', () => {
    const plan = editorPlan('vscode', '', '/usr/local/bin/nu', folder, file, PATH_ONLY)
    expect(plan).toMatchObject({ kind: 'run', command: '/bin/sh' })
  })

  it('opens with the system default, and nothing for an empty custom command', () => {
    expect(editorPlan('system', 'ignored', '/bin/sh', folder, file, PATH_ONLY)).toEqual({
      kind: 'system'
    })
    expect(editorPlan('custom', '   ', '/bin/sh', folder, file, PATH_ONLY)).toEqual({
      kind: 'no-command'
    })
  })
})

/** A temp HOME whose login profile puts `bin` on PATH, and a fake command there logging its arguments. */
let dir: string
let bin: string
let env: Record<string, string>
const log = (): string => join(dir, 'log')
const logged = (): string[] =>
  existsSync(log()) ? readFileSync(log(), 'utf8').trimEnd().split('\n') : []

function fakeCommand(
  name: string,
  body = `printf '%s\\n' "$0" "$@" >> '${join(dir, 'log')}'`
): void {
  const path = join(bin, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-editor-'))
  bin = join(dir, 'bin')
  mkdirSync(bin)
  const home = join(dir, 'home')
  mkdirSync(home)
  // Only the login shell's profile puts `bin` on PATH (D15).
  writeFileSync(join(home, '.profile'), `PATH='${bin}':$PATH; export PATH\n`)
  env = { HOME: home, PATH: '/usr/bin:/bin' }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('runEditor (#55 D13, D15, AC16)', () => {
  const run = (plan: ReturnType<typeof editorPlan>, waitMs = 3000): ReturnType<typeof runEditor> =>
    runEditor(plan as Extract<typeof plan, { kind: 'run' }>, { spawn, env, cwd: dir, waitMs })

  it("runs the editor found on the login shell's PATH with the folder and the file", async () => {
    fakeCommand('code')
    const folder = join(dir, 'my repo')
    const file = join(folder, "it's $HOME a.ts")
    expect(await run(editorPlan('vscode', '', '/bin/sh', folder, file, PATH_ONLY))).toEqual({
      ok: true
    })
    expect(logged()).toEqual([join(bin, 'code'), folder, file])
  })

  it('reads `<command> not found` when the editor is not installed', async () => {
    expect(
      await run(editorPlan('vscode', '', '/bin/sh', dir, join(dir, 'a.ts'), PATH_ONLY))
    ).toEqual({
      ok: false,
      reason: 'code not found',
      notFound: true
    })
    expect(
      await run(editorPlan('custom', 'fake-editor --wait', '/bin/sh', dir, 'x', PATH_ONLY))
    ).toEqual({
      ok: false,
      reason: 'fake-editor not found',
      notFound: true
    })
  })

  it("appends the file to a custom command as one argument, the command's own words kept", async () => {
    fakeCommand('fake-editor')
    const file = join(dir, 'a b; rm -rf "x".md')
    expect(
      await run(editorPlan('custom', 'fake-editor --wait', '/bin/sh', dir, file, PATH_ONLY))
    ).toEqual({
      ok: true
    })
    expect(logged()).toEqual([join(bin, 'fake-editor'), '--wait', file])
  })

  it("gives a failing editor's last error line, or its exit code", async () => {
    fakeCommand('code', 'echo "warming up" >&2; echo "cannot open display" >&2; exit 3')
    expect(await run(editorPlan('vscode', '', '/bin/sh', dir, 'x', PATH_ONLY))).toEqual({
      ok: false,
      reason: 'cannot open display'
    })
    fakeCommand('code', 'exit 4')
    expect(await run(editorPlan('vscode', '', '/bin/sh', dir, 'x', PATH_ONLY))).toEqual({
      ok: false,
      reason: 'exited with code 4'
    })
  })

  it('takes an editor still running after the wait as started', async () => {
    fakeCommand('fake-editor', 'sleep 5')
    const started = Date.now()
    expect(
      await run(editorPlan('custom', 'fake-editor', '/bin/sh', dir, 'x', PATH_ONLY), 300)
    ).toEqual({
      ok: true
    })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("reads the shell's own failure when it can't start", async () => {
    const result = await run(editorPlan('vscode', '', join(dir, 'sh'), dir, 'x', PATH_ONLY))
    expect(result).toEqual({ ok: false, reason: `${join(dir, 'sh')} not found` })
  })
})

describe('openFile (#55 D13, D16, AC15)', () => {
  let repo: string
  let spawned: string[][]
  let opened: string[]
  const deps = (over: Partial<OpenDeps> = {}): OpenDeps => ({
    editor: 'vscode',
    editorCommand: '',
    shell: '/bin/sh',
    env,
    ...PATH_ONLY,
    spawn: ((command: string, args: string[], options: object) => {
      spawned.push([command, ...args])
      return spawn(command, args, options)
    }) as unknown as OpenDeps['spawn'],
    openPath: async (path) => {
      opened.push(path)
      return ''
    },
    ...over
  })

  beforeEach(() => {
    repo = join(dir, 'repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    mkdirSync(join(repo, 'sub'))
    writeFileSync(join(repo, 'src', 'a.ts'), '')
    writeFileSync(join(dir, 'outside'), '')
    symlinkSync(join(dir, 'outside'), join(repo, 'escape'))
    spawned = []
    opened = []
    fakeCommand('code')
  })

  it('opens a file inside the folder with the editor, given the folder and the file', async () => {
    expect(await openFile(repo, 'src/a.ts', deps())).toEqual({ ok: true })
    expect(logged()).toEqual([join(bin, 'code'), repo, join(repo, 'src', 'a.ts')])
  })

  it('refuses a path escaping the folder, through `..` or a symlink, and runs nothing', async () => {
    for (const path of ['../outside', 'escape', 'src/../../outside', '/etc/passwd', 'missing']) {
      expect(await openFile(repo, path, deps())).toEqual({ ok: false, reason: 'refused' })
    }
    expect(spawned).toEqual([])
    expect(logged()).toEqual([])
  })

  it('refuses a folder (an untracked nested repository shows as a file row) and runs nothing', async () => {
    for (const path of ['sub', '', 'src']) {
      expect(await openFile(repo, path, deps())).toEqual({ ok: false, reason: 'refused' })
    }
    expect(await openFile(join(repo, 'src', 'a.ts'), '', deps())).toEqual({
      ok: false,
      reason: 'refused'
    })
    expect(await openFile('repo', 'src/a.ts', deps())).toEqual({ ok: false, reason: 'refused' })
    expect(spawned).toEqual([])
  })

  it("opens with the OS's default app through openPath, its error as the reason", async () => {
    expect(await openFile(repo, 'src/a.ts', deps({ editor: 'system' }))).toEqual({ ok: true })
    expect(opened).toEqual([join(repo, 'src', 'a.ts')])
    const failing = deps({ editor: 'system', openPath: async () => 'No application' })
    expect(await openFile(repo, 'src/a.ts', failing)).toEqual({
      ok: false,
      reason: 'failed',
      message: 'No application'
    })
    expect(spawned).toEqual([])
  })

  it('opens nothing for an empty custom command, and gives a failed run its reason', async () => {
    expect(await openFile(repo, 'src/a.ts', deps({ editor: 'custom' }))).toEqual({
      ok: false,
      reason: 'no-command'
    })
    expect(spawned).toEqual([])
    const noDefaultApp = deps({ editor: 'zed', openPath: async () => 'No application' })
    expect(await openFile(repo, 'src/a.ts', noDefaultApp)).toEqual({
      ok: false,
      reason: 'failed',
      message: 'zed not found'
    })
  })
})

describe('openErrorLine (#55 D13, D14)', () => {
  it("names the file and the reason, and asks for a command when there's none", () => {
    expect(
      openErrorLine('src/a.ts', { ok: false, reason: 'failed', message: 'code not found' })
    ).toBe("Couldn't open a.ts: code not found")
    expect(openErrorLine('README.md', { ok: false, reason: 'no-command' })).toBe(
      'Set a command in Settings > Editor'
    )
  })

  it('shows nothing once opened, or for a path main refused (nothing ran)', () => {
    expect(openErrorLine('a.ts', { ok: true })).toBeNull()
    expect(openErrorLine('sub', { ok: false, reason: 'refused' })).toBeNull()
  })
})

describe('listedFileErrorLine (#68 D27)', () => {
  it("reads a refused Open file or Reveal as the file not found, else as the Files tab's line", () => {
    expect(
      listedFileErrorLine('/w/.claude/skills/x/SKILL.md', { ok: false, reason: 'refused' })
    ).toBe("Couldn't open SKILL.md: file not found")
    expect(
      listedFileErrorLine('/w/a.md', { ok: false, reason: 'failed', message: 'code not found' })
    ).toBe("Couldn't open a.md: code not found")
    expect(listedFileErrorLine('/w/a.md', { ok: true })).toBeNull()
  })
})

/** A real VS Code at one of D1's system paths would come before the fake under the temp home. */
const systemCode = editorCandidates('vscode', 'linux', '/nonexistent').some((path) =>
  path.startsWith('/usr') || path.startsWith('/snap') || path.startsWith('/var')
    ? existsSync(path)
    : false
)

describe.skipIf(systemCode)('finding the editor and falling back (#70 D1, D3)', () => {
  let repo: string
  let home: string
  let spawned: string[][]
  let opened: string[]
  let openError: string
  const file = (): string => join(repo, 'a.ts')
  const deps = (over: Partial<OpenDeps> = {}): OpenDeps => ({
    editor: 'vscode',
    editorCommand: '',
    shell: '/bin/sh',
    env,
    platform: 'linux',
    home,
    spawn: ((command: string, args: string[], options: object) => {
      spawned.push([command, ...args])
      return spawn(command, args, options)
    }) as unknown as OpenDeps['spawn'],
    openPath: async (path) => {
      opened.push(path)
      return openError
    },
    waitMs: 3000,
    ...over
  })
  /** A fake at D1's per-user flatpak export for VS Code, logging `flatpak` and its arguments. */
  function flatpakCode(): string {
    const path = join(home, '.local', 'share', 'flatpak', 'exports', 'bin', 'com.visualstudio.code')
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' flatpak "$@" >> '${log()}'\n`)
    chmodSync(path, 0o755)
    return path
  }

  beforeEach(() => {
    repo = join(dir, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'a.ts'), '')
    home = join(dir, 'home')
    spawned = []
    opened = []
    openError = ''
  })

  it('AC1: runs the bundle CLI at an installer path when no command is on the PATH', async () => {
    flatpakCode()
    expect(await openFile(repo, 'a.ts', deps())).toEqual({ ok: true })
    expect(logged()).toEqual(['flatpak', repo, file()])
    expect(opened).toEqual([])
  })

  it('AC1: passes the candidates as positional arguments, never in the parsed text', () => {
    const plan = editorPlan('vscode', '', '/bin/sh', repo, file(), { platform: 'linux', home })
    expect(plan.kind === 'run' && plan.args[2]).not.toMatch(/code|flatpak|visualstudio/)
  })

  it('AC1: skips a candidate that is not an executable regular file', async () => {
    const path = flatpakCode()
    chmodSync(path, 0o644)
    expect(await openFile(repo, 'a.ts', deps({ openPath: async () => 'none' }))).toEqual({
      ok: false,
      reason: 'failed',
      message: 'code not found'
    })
    expect(logged()).toEqual([])
  })

  it("AC2: runs the PATH's command before one at an installer path", async () => {
    flatpakCode()
    fakeCommand('code')
    expect(await openFile(repo, 'a.ts', deps())).toEqual({ ok: true })
    expect(logged()).toEqual([join(bin, 'code'), repo, file()])
  })

  it("finds Zed by Arch's zeditor", async () => {
    fakeCommand('zeditor')
    expect(await openFile(repo, 'a.ts', deps({ editor: 'zed' }))).toEqual({ ok: true })
    expect(logged()).toEqual([join(bin, 'zeditor'), repo, file()])
  })

  it('AC4: opens with the default app when the editor is found nowhere, with a note', async () => {
    expect(await openFile(repo, 'a.ts', deps())).toEqual({
      ok: true,
      reason: 'default-app',
      message: 'code not found'
    })
    expect(opened).toEqual([file()])
  })

  it("AC4: gives the editor's reason when the default app fails too", async () => {
    openError = 'No application knows how to open it'
    expect(await openFile(repo, 'a.ts', deps({ editor: 'cursor' }))).toEqual({
      ok: false,
      reason: 'failed',
      message: 'cursor not found'
    })
    expect(opened).toEqual([file()])
  })

  it('AC5: a custom command that is not found runs nothing else and opens no default app', async () => {
    const result = await openFile(
      repo,
      'a.ts',
      deps({ editor: 'custom', editorCommand: 'fake-missing' })
    )
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'fake-missing not found' })
    expect(opened).toEqual([])
    expect(spawned).toHaveLength(1)
  })

  it.skipIf(!existsSync('/usr/bin/fish') && !existsSync('/bin/fish'))(
    "finds the editor under fish's own syntax too",
    async () => {
      const fish = existsSync('/usr/bin/fish') ? '/usr/bin/fish' : '/bin/fish'
      flatpakCode()
      expect(await openFile(repo, 'a.ts', deps({ shell: fish }))).toEqual({ ok: true })
      expect(logged()).toEqual(['flatpak', repo, file()])
      expect(await openFile(repo, 'a.ts', deps({ shell: fish, editor: 'cursor' }))).toEqual({
        ok: true,
        reason: 'default-app',
        message: 'cursor not found'
      })
    }
  )
})

describe('the fallback note (#70 D3, AC4)', () => {
  it('reads the note for a file opened with the default app', () => {
    const result = { ok: true, reason: 'default-app', message: 'code not found' } as const
    expect(openErrorLine('src/a.ts', result)).toBe(
      'Opened a.ts with the default app: code not found'
    )
    expect(listedFileErrorLine('/w/.claude/settings.json', result)).toBe(
      'Opened settings.json with the default app: code not found'
    )
    expect(isOpenNote(result)).toBe(true)
    expect(isOpenNote({ ok: true })).toBe(false)
    expect(isOpenNote({ ok: false, reason: 'failed', message: 'code not found' })).toBe(false)
  })
})

describe('a found editor exiting 127 (#70 D3)', () => {
  it('is an ordinary failure with its own reason, and opens no default app', async () => {
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    writeFileSync(join(repo, 'a.ts'), '')
    const opened: string[] = []
    const deps = (): OpenDeps => ({
      editor: 'vscode',
      editorCommand: '',
      shell: '/bin/sh',
      env,
      ...PATH_ONLY,
      spawn,
      openPath: async (path) => {
        opened.push(path)
        return ''
      },
      waitMs: 3000
    })
    fakeCommand('code', 'echo "electron: not found" >&2; exit 127')
    expect(await openFile(repo, 'a.ts', deps())).toEqual({
      ok: false,
      reason: 'failed',
      message: 'electron: not found'
    })
    fakeCommand('code', 'exit 127')
    expect(await openFile(repo, 'a.ts', deps())).toEqual({
      ok: false,
      reason: 'failed',
      message: 'exited with code 127'
    })
    expect(opened).toEqual([])
  })
})
