import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editorCandidates } from './editor-candidates'
import {
  installedEditorsPlan,
  parseInstalledEditors,
  readInstalledEditors
} from './installed-editors'

describe('installedEditorsPlan (#70 D2)', () => {
  it("checks each editor's D1 candidates as positional arguments, never in the parsed text", () => {
    const plan = installedEditorsPlan('/bin/zsh', 'linux', '/h')
    expect(plan.command).toBe('/bin/zsh')
    expect(plan.args.slice(0, 2)).toEqual(['-l', '-c'])
    expect(plan.args[2]).not.toMatch(/code|cursor|zed|flatpak/)
    const rest = plan.args.slice(4)
    for (const editor of ['vscode', 'cursor', 'zed'] as const) {
      const candidates = editorCandidates(editor, 'linux', '/h')
      const at = rest.indexOf(editor)
      expect(rest.slice(at, at + 2 + candidates.length)).toEqual([
        editor,
        String(candidates.length),
        ...candidates
      ])
    }
  })

  it("uses fish's $argv under fish, and /bin/sh for a shell with neither syntax", () => {
    expect(installedEditorsPlan('/usr/bin/fish', 'linux', '/h').args[2]).toContain('$argv')
    expect(installedEditorsPlan('/usr/bin/nu', 'linux', '/h').command).toBe('/bin/sh')
  })
})

describe('parseInstalledEditors (#70 D2, AC3)', () => {
  it('reads only the marked lines, whatever a profile printed', () => {
    expect(parseInstalledEditors('hello\nbikube-found zed\nvscode\nbikube-found nope\n')).toEqual([
      'zed'
    ])
    expect(parseInstalledEditors('')).toEqual([])
  })
})

describe('readInstalledEditors (#70 D2, AC3)', () => {
  let dir: string
  let bin: string
  let home: string
  const fake = (path: string): void => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '#!/bin/sh\n')
    chmodSync(path, 0o755)
  }
  const read = (shell = '/bin/sh'): ReturnType<typeof readInstalledEditors> =>
    readInstalledEditors({
      spawn,
      shell,
      env: { HOME: home, PATH: '/usr/bin:/bin' },
      platform: 'linux',
      home
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bikube-installed-editors-'))
    bin = join(dir, 'bin')
    home = join(dir, 'home')
    mkdirSync(bin)
    mkdirSync(home)
    writeFileSync(join(home, '.profile'), `PATH='${bin}':/usr/bin:/bin; export PATH\n`)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** A real editor at D1's system paths would read installed whatever the test sets up. */
  const system = (editor: 'vscode' | 'cursor' | 'zed'): boolean =>
    editorCandidates(editor, 'linux', '/nonexistent-home').some(
      (path) => path.startsWith('/') && existsSync(path)
    )

  it.skipIf(system('vscode') || system('cursor'))(
    'finds an editor on the login PATH or at an installer path, the others not',
    async () => {
      fake(join(bin, 'zed'))
      fake(join(home, '.local/share/flatpak/exports/bin/com.visualstudio.code'))
      expect(await read()).toEqual(['vscode', 'zed'])
    }
  )

  it.skipIf(!existsSync('/usr/bin/fish') || system('vscode') || system('cursor'))(
    'finds them under fish too',
    async () => {
      fake(join(home, '.local/bin/zed'))
      fake(join(home, '.local/share/flatpak/exports/bin/com.visualstudio.code'))
      expect(await read('/usr/bin/fish')).toEqual(['vscode', 'zed'])
    }
  )

  it('is null when the check failed, so nothing reads as not installed', async () => {
    expect(await read(join(dir, 'missing', 'sh'))).toBeNull()
  })
})
