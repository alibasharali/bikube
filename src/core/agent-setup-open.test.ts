import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ListedPaths,
  openListedFile,
  revealListedFile,
  type FileActionDeps
} from './agent-setup-open'

// Main's check of the Agent setup page's Open file and Reveal (#68 D27, D28) on real temporary
// folders: only a path the folder's last read listed is opened or revealed.

let dir: string
let folder: string
let skill: string
let opened: string[]
let revealed: string[]

const deps = (listed: ListedPaths): FileActionDeps => ({
  listed,
  open: {
    editor: 'system',
    editorCommand: '',
    shell: '/bin/sh',
    env: {},
    spawn,
    openPath: async (path) => {
      opened.push(path)
      return ''
    }
  },
  reveal: (path) => revealed.push(path)
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-agent-setup-open-'))
  folder = join(dir, 'proj')
  skill = join(folder, '.claude', 'skills', 'deploy', 'SKILL.md')
  mkdirSync(join(folder, '.claude', 'skills', 'deploy'), { recursive: true })
  writeFileSync(skill, '---\nname: deploy\n---\n')
  opened = []
  revealed = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openListedFile', () => {
  it('opens a path the folder’s last read listed, the folder named however it is spelled', async () => {
    const listed = new ListedPaths()
    listed.set(folder, [skill])
    expect(await openListedFile(`${folder}/`, skill, deps(listed))).toEqual({ ok: true })
    expect(opened).toEqual([skill])
  })

  /** The editor's working directory and arguments for opening `path` with VS Code. */
  async function openedWith(
    path: string,
    listedIn = folder
  ): Promise<{ cwd: unknown; args: string[] }> {
    const listed = new ListedPaths()
    listed.set(listedIn, [path])
    let call: { cwd: unknown; args: string[] } | undefined
    const recording: FileActionDeps = {
      ...deps(listed),
      open: {
        ...deps(listed).open,
        editor: 'vscode',
        spawn: ((_command: string, args: string[], options: { cwd?: unknown }) => {
          call = { cwd: options.cwd, args }
          throw new Error('not run')
        }) as unknown as FileActionDeps['open']['spawn']
      }
    }
    await openListedFile(listedIn, path, recording)
    return call!
  }

  it('opens a file inside the workspace with the workspace as the project folder, as the Files tab does', async () => {
    const { cwd, args } = await openedWith(skill)
    expect(cwd).toBe(folder)
    expect(args.slice(-2)).toEqual([folder, skill])
  })

  it('opens a file outside the workspace with its own folder as the project folder', async () => {
    const home = join(dir, 'home', '.claude', 'skills', 'notes')
    mkdirSync(home, { recursive: true })
    const notes = join(home, 'SKILL.md')
    writeFileSync(notes, 'x')
    const { cwd, args } = await openedWith(notes)
    expect(cwd).toBe(home)
    expect(args.slice(-2)).toEqual([home, notes])
  })

  it('opens a file named inside the workspace with the workspace, wherever its symlink points', async () => {
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'CLAUDE.md'), 'x')
    mkdirSync(join(folder, 'docs'))
    const link = join(folder, 'docs', 'CLAUDE.md')
    symlinkSync(join(elsewhere, 'CLAUDE.md'), link)
    const { cwd, args } = await openedWith(link)
    expect(cwd).toBe(folder)
    expect(args.slice(-2)).toEqual([folder, link])
  })

  it('refuses a path the read didn’t list, running nothing', async () => {
    const other = join(folder, 'notes.md')
    writeFileSync(other, 'x')
    const listed = new ListedPaths()
    listed.set(folder, [skill])
    expect(await openListedFile(folder, other, deps(listed))).toEqual({
      ok: false,
      reason: 'refused'
    })
    expect(opened).toEqual([])
  })

  it('refuses a path only another folder’s read listed, and any folder before a read', async () => {
    const elsewhere = join(dir, 'other')
    mkdirSync(elsewhere)
    const listed = new ListedPaths()
    expect((await openListedFile(folder, skill, deps(listed))).ok).toBe(false)
    listed.set(elsewhere, [skill])
    expect((await openListedFile(folder, skill, deps(listed))).ok).toBe(false)
    expect(opened).toEqual([])
  })

  it('refuses a listed path spelled with `..`, relative, or not a string', async () => {
    const listed = new ListedPaths()
    listed.set(folder, [skill])
    const deploy = join(folder, '.claude', 'skills', 'deploy')
    for (const path of [
      `${deploy}/../deploy/SKILL.md`,
      `${deploy}//SKILL.md`,
      '.claude/skills/deploy/SKILL.md',
      ['x'],
      null
    ]) {
      expect(await openListedFile(folder, path, deps(listed))).toEqual({
        ok: false,
        reason: 'refused'
      })
    }
    expect((await openListedFile('proj', skill, deps(listed))).ok).toBe(false)
    expect(opened).toEqual([])
  })

  it('refuses a listed file that is gone or now a folder', async () => {
    const listed = new ListedPaths()
    listed.set(folder, [skill, join(folder, '.claude', 'skills', 'deploy')])
    rmSync(skill)
    expect((await openListedFile(folder, skill, deps(listed))).ok).toBe(false)
    expect(
      (await openListedFile(folder, join(folder, '.claude', 'skills', 'deploy'), deps(listed))).ok
    ).toBe(false)
    expect(opened).toEqual([])
  })

  it('refuses Bikube’s own Claude Code settings, which a read never lists', async () => {
    const bikube = join(dir, 'bin', 'claude-settings.json')
    mkdirSync(join(dir, 'bin'))
    writeFileSync(bikube, '{}')
    const listed = new ListedPaths()
    listed.set(folder, [skill])
    expect((await openListedFile(folder, bikube, deps(listed))).ok).toBe(false)
    expect(await revealListedFile(folder, bikube, deps(listed))).toBe(false)
    expect(opened).toEqual([])
    expect(revealed).toEqual([])
  })

  it('opens a listed file through a symlink as listed, the workspace as the project folder', async () => {
    const real = join(dir, 'shared.md')
    writeFileSync(real, 'x')
    const link = join(folder, 'CLAUDE.md')
    symlinkSync(real, link)
    const listed = new ListedPaths()
    listed.set(folder, [link])
    expect(await openListedFile(folder, link, deps(listed))).toEqual({ ok: true })
    expect(opened).toEqual([link])
  })
})

describe('revealListedFile', () => {
  it('shows a listed file, and nothing for one the read didn’t list', async () => {
    const listed = new ListedPaths()
    listed.set(folder, [skill])
    expect(await revealListedFile(folder, skill, deps(listed))).toBe(true)
    expect(await revealListedFile(folder, join(folder, '.claude'), deps(listed))).toBe(false)
    expect(await revealListedFile(folder, `${skill}/..`, deps(listed))).toBe(false)
    expect(revealed).toEqual([skill])
  })
})
