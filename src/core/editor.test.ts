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
import { openErrorLine } from './open-result'

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

  it('gives VS Code, Cursor and Zed the folder and the file as positional arguments', () => {
    for (const [editor, name] of [
      ['vscode', 'code'],
      ['cursor', 'cursor'],
      ['zed', 'zed']
    ] as const) {
      expect(editorPlan(editor, '', '/bin/zsh', folder, file)).toEqual({
        kind: 'run',
        name,
        command: '/bin/zsh',
        args: [
          '-l',
          '-c',
          'command -v "$1" >/dev/null 2>&1 || exit 127; exec "$@"',
          'drovr',
          name,
          folder,
          file
        ]
      })
    }
  })

  it('runs a custom command as the only text the shell parses, the file as "$1"', () => {
    expect(editorPlan('custom', '  subl -n ', '/bin/bash', folder, file)).toEqual({
      kind: 'run',
      name: 'subl',
      command: '/bin/bash',
      args: ['-l', '-c', 'subl -n "$1"', 'drovr', file]
    })
  })

  it("uses fish's own syntax under fish, where the arguments are $argv", () => {
    expect(editorPlan('zed', '', '/opt/homebrew/bin/fish', folder, file)).toEqual({
      kind: 'run',
      name: 'zed',
      command: '/opt/homebrew/bin/fish',
      args: ['-l', '-c', 'command -q $argv[1]; or exit 127; exec $argv', 'zed', folder, file]
    })
    expect(editorPlan('custom', 'subl -n', '/usr/bin/fish', folder, file)).toEqual({
      kind: 'run',
      name: 'subl',
      command: '/usr/bin/fish',
      args: ['-l', '-c', 'subl -n $argv[1]', file]
    })
  })

  it('falls back to /bin/sh as a login shell for a shell with neither syntax', () => {
    const plan = editorPlan('vscode', '', '/usr/local/bin/nu', folder, file)
    expect(plan).toMatchObject({ kind: 'run', command: '/bin/sh' })
  })

  it('opens with the system default, and nothing for an empty custom command', () => {
    expect(editorPlan('system', 'ignored', '/bin/sh', folder, file)).toEqual({ kind: 'system' })
    expect(editorPlan('custom', '   ', '/bin/sh', folder, file)).toEqual({ kind: 'no-command' })
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
  dir = mkdtempSync(join(tmpdir(), 'drovr-editor-'))
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
    expect(await run(editorPlan('vscode', '', '/bin/sh', folder, file))).toEqual({ ok: true })
    expect(logged()).toEqual([join(bin, 'code'), folder, file])
  })

  it('reads `<command> not found` when the editor is not installed', async () => {
    expect(await run(editorPlan('vscode', '', '/bin/sh', dir, join(dir, 'a.ts')))).toEqual({
      ok: false,
      reason: 'code not found'
    })
    expect(await run(editorPlan('custom', 'fake-editor --wait', '/bin/sh', dir, 'x'))).toEqual({
      ok: false,
      reason: 'fake-editor not found'
    })
  })

  it("appends the file to a custom command as one argument, the command's own words kept", async () => {
    fakeCommand('fake-editor')
    const file = join(dir, 'a b; rm -rf "x".md')
    expect(await run(editorPlan('custom', 'fake-editor --wait', '/bin/sh', dir, file))).toEqual({
      ok: true
    })
    expect(logged()).toEqual([join(bin, 'fake-editor'), '--wait', file])
  })

  it("gives a failing editor's last error line, or its exit code", async () => {
    fakeCommand('code', 'echo "warming up" >&2; echo "cannot open display" >&2; exit 3')
    expect(await run(editorPlan('vscode', '', '/bin/sh', dir, 'x'))).toEqual({
      ok: false,
      reason: 'cannot open display'
    })
    fakeCommand('code', 'exit 4')
    expect(await run(editorPlan('vscode', '', '/bin/sh', dir, 'x'))).toEqual({
      ok: false,
      reason: 'exited with code 4'
    })
  })

  it('takes an editor still running after the wait as started', async () => {
    fakeCommand('fake-editor', 'sleep 5')
    const started = Date.now()
    expect(await run(editorPlan('custom', 'fake-editor', '/bin/sh', dir, 'x'), 300)).toEqual({
      ok: true
    })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("reads the shell's own failure when it can't start", async () => {
    const result = await run(editorPlan('vscode', '', join(dir, 'sh'), dir, 'x'))
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
    expect(await openFile(repo, 'src/a.ts', deps({ editor: 'zed' }))).toEqual({
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
