import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { readdir, realpath, stat } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FOLDER_CAP, insideFolder, listFolder, type FolderListing } from './file-tree'
import { readOnlyGit, spawnRunner } from './git'

// The Files tab's listing (#55 D7, D8, D9, D16) on real temporary folders.

let dir: string
let root: string

const write = (path: string, text = ''): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drovr-tree-'))
  root = join(dir, 'repo')
  mkdirSync(root)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const names = (listing: FolderListing): string[] =>
  listing.ok ? listing.entries.map((e) => e.name) : []

describe('listFolder', () => {
  it('lists folders first, then files, each by name, case-insensitive and natural, without .git', async () => {
    for (const f of [
      'file10',
      'file2',
      'B.md',
      'a.md',
      '.hidden',
      '.git/HEAD',
      'Zeta/x',
      'alpha/x'
    ])
      write(f)
    const listing = await listFolder(root, '')
    expect(listing.ok).toBe(true)
    expect(names(listing)).toEqual(['alpha', 'Zeta', '.hidden', 'a.md', 'B.md', 'file2', 'file10'])
    expect(listing.ok && listing.entries.filter((e) => e.folder).map((e) => e.name)).toEqual([
      'alpha',
      'Zeta'
    ])
  })

  it(`lists the first ${FOLDER_CAP} entries and counts the rest`, async () => {
    for (let i = 0; i < FOLDER_CAP + 5; i++) write(`f${i}`)
    const listing = await listFolder(root, '')
    expect(listing.ok && listing.entries.length).toBe(FOLDER_CAP)
    expect(listing.ok && listing.more).toBe(5)
    expect(names(listing)[FOLDER_CAP - 1]).toBe(`f${FOLDER_CAP - 1}`)
  })

  it('lists symlinks: one to a folder inside expands, one outside or broken is a leaf', async () => {
    write('src/a.ts')
    mkdirSync(join(dir, 'outside'))
    symlinkSync(join(root, 'src'), join(root, 'in-link'))
    symlinkSync(join(dir, 'outside'), join(root, 'out-link'))
    symlinkSync(join(root, 'missing'), join(root, 'broken'))
    symlinkSync(join(root, 'src', 'a.ts'), join(root, 'file-link'))
    const listing = await listFolder(root, '')
    expect(listing.ok && listing.entries).toEqual([
      { name: 'in-link', folder: true, symlink: true },
      { name: 'src', folder: true },
      { name: 'broken', folder: false, symlink: true },
      { name: 'file-link', folder: false, symlink: true },
      { name: 'out-link', folder: false, symlink: true }
    ])
    expect(names(await listFolder(root, 'in-link'))).toEqual(['a.ts'])
  })

  it('#55 AC15: refuses a folder outside, through .. or a symlink, and reads nothing', async () => {
    mkdirSync(join(dir, 'outside'))
    writeFileSync(join(dir, 'outside', 'secret'), '')
    symlinkSync(join(dir, 'outside'), join(root, 'out-link'))
    const reads: string[] = []
    const fs = {
      realpath: (p: string) => realpath(p),
      stat: (p: string) => stat(p),
      readdir: (p: string, o: { withFileTypes: true }) => {
        reads.push(p)
        return readdir(p, o)
      }
    }
    for (const path of [
      '../outside',
      'out-link',
      'out-link/',
      'src/../../outside',
      join(dir, 'outside')
    ])
      expect(await listFolder(root, path, { fs })).toEqual({ ok: false, reason: 'outside' })
    expect(reads).toEqual([])
    expect(await insideFolder(root, '../outside')).toBeNull()
    expect(await insideFolder(root, 'out-link')).toBeNull()
    expect(await insideFolder(root, 'out-link/secret')).toBeNull()
    expect(await insideFolder(root, '')).toBe(await realpath(root))
  })

  it("can't read a file or a missing folder", async () => {
    write('README.md')
    expect(await listFolder(root, 'README.md')).toEqual({ ok: false, reason: 'unreadable' })
    expect((await listFolder(root, 'nope')).ok).toBe(false)
  })
})

describe('ignored entries', () => {
  const git = readOnlyGit(spawnRunner(spawn, process.platform), process.env)
  const gitIn = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })
  }

  it('marks what git ignores, inside an ignored folder too, and through .git/info/exclude', async () => {
    write('README.md')
    write('src/a.ts')
    write('.gitignore', 'dist/\n')
    write('dist/out.js')
    write('dist/sub/x')
    write('local.conf')
    write('we"ird')
    gitIn('init', '-q')
    writeFileSync(join(root, '.git', 'info', 'exclude'), 'local.conf\nwe*\n')
    gitIn('add', 'README.md', 'src', '.gitignore')
    gitIn('commit', '-q', '-m', 'init')
    const top = await listFolder(root, '', { git })
    expect(top.ok && top.entries.filter((e) => e.ignored).map((e) => e.name)).toEqual([
      'dist',
      'local.conf',
      'we"ird'
    ])
    const inDist = await listFolder(root, 'dist', { git })
    expect(inDist.ok && inDist.entries).toEqual([
      { name: 'sub', folder: true, ignored: true },
      { name: 'out.js', folder: false, ignored: true }
    ])
  })

  it('marks nothing outside a repository', async () => {
    write('a.ts')
    write('.gitignore', 'a.ts\n')
    const listing = await listFolder(root, '', { git })
    expect(listing.ok && listing.entries.some((e) => e.ignored)).toBe(false)
  })
})
