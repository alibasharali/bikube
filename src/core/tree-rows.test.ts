import { describe, expect, it } from 'vitest'
import type { FolderListing } from './file-tree'
import type { FileChange } from './git-status'
import { changedRows, treeKey, visibleRows, type TreeRow } from './tree-rows'

// The Files tab's rows (#55 D7, D8): what shows for the expanded folders, and the tree's keys.

const listings = new Map<string, FolderListing>([
  [
    '',
    {
      ok: true,
      entries: [
        { name: 'dist', folder: true, ignored: true },
        { name: 'locked', folder: true },
        { name: 'src', folder: true },
        { name: 'README.md', folder: false }
      ],
      more: 0
    }
  ],
  ['src', { ok: true, entries: [{ name: 'a.ts', folder: false }], more: 3 }],
  ['dist', { ok: true, entries: [{ name: 'out.js', folder: false }], more: 0 }],
  ['locked', { ok: false, reason: 'unreadable' }]
])

const brief = (rows: TreeRow[]): string[] =>
  rows.map((r) => `${'  '.repeat(r.depth)}${r.kind}:${r.name}${r.ignored ? ' (ignored)' : ''}`)

describe('visibleRows', () => {
  it('shows the root, and the contents of each expanded folder under it', () => {
    const rows = visibleRows('repo', listings, new Set(['', 'src', 'dist', 'locked']))
    expect(brief(rows)).toEqual([
      'root:repo',
      '  folder:dist (ignored)',
      '    file:out.js (ignored)',
      '  folder:locked',
      "    error:Can't read this folder",
      '  folder:src',
      '    file:a.ts',
      '    more:… 3 more',
      '  file:README.md'
    ])
    expect(rows.find((r) => r.name === 'a.ts')?.path).toBe('src/a.ts')
    expect(rows.find((r) => r.name === 'src')?.expanded).toBe(true)
  })

  it('hides the contents of a collapsed folder, even when its subfolders are expanded', () => {
    expect(brief(visibleRows('repo', listings, new Set(['src'])))).toEqual(['root:repo'])
    expect(brief(visibleRows('repo', listings, new Set(['']))).length).toBe(5)
  })
})

describe('treeKey', () => {
  const rows = visibleRows('repo', listings, new Set(['', 'src', 'locked']))

  it('moves with Up and Down over the selectable rows', () => {
    expect(treeKey(rows, '', 'ArrowDown')).toEqual({ select: 'dist' })
    expect(treeKey(rows, 'locked', 'ArrowDown')).toEqual({ select: 'src' })
    expect(treeKey(rows, 'src/a.ts', 'ArrowDown')).toEqual({ select: 'README.md' })
    expect(treeKey(rows, 'README.md', 'ArrowDown')).toEqual({})
    expect(treeKey(rows, 'src', 'ArrowUp')).toEqual({ select: 'locked' })
    expect(treeKey(rows, null, 'ArrowDown')).toEqual({ select: '' })
  })

  it('expands and collapses with Right and Left, else moves to the child or the parent', () => {
    expect(treeKey(rows, 'dist', 'ArrowRight')).toEqual({ toggle: 'dist' })
    expect(treeKey(rows, 'src', 'ArrowRight')).toEqual({ select: 'src/a.ts' })
    expect(treeKey(rows, 'src', 'ArrowLeft')).toEqual({ toggle: 'src' })
    expect(treeKey(rows, 'src/a.ts', 'ArrowLeft')).toEqual({ select: 'src' })
    expect(treeKey(rows, 'README.md', 'ArrowRight')).toEqual({})
    expect(treeKey(rows, 'dist', 'ArrowLeft')).toEqual({ select: '' })
  })

  it('toggles a folder and opens a file with Enter', () => {
    expect(treeKey(rows, 'src', 'Enter')).toEqual({ toggle: 'src' })
    expect(treeKey(rows, 'src/a.ts', 'Enter')).toEqual({ open: 'src/a.ts' })
  })
})

// The changes (#55 D10, D11): letters, folder dots, deleted rows, and the Changed only rows.

const changes: FileChange[] = [
  { path: 'src/a.ts', letter: 'M' },
  { path: 'src/new.ts', letter: 'U' },
  { path: 'src/c.ts', letter: 'R', from: 'src/b.ts' },
  { path: 'README.md', letter: 'D' },
  { path: 'gone/deep/x.ts', letter: 'D' }
]

const marked = (rows: TreeRow[]): string[] =>
  rows.map(
    (r) =>
      `${'  '.repeat(r.depth)}${r.name}${r.change ? ` ${r.change}` : ''}${r.from ? ` <${r.from}` : ''}${r.dot ? ' •' : ''}`
  )

describe('changes', () => {
  const tree = new Map<string, FolderListing>([
    [
      '',
      {
        ok: true,
        entries: [
          { name: 'dist', folder: true, ignored: true },
          { name: 'src', folder: true },
          { name: '.gitignore', folder: false }
        ],
        more: 0
      }
    ],
    [
      'src',
      {
        ok: true,
        entries: [
          { name: 'a.ts', folder: false },
          { name: 'c.ts', folder: false },
          { name: 'new.ts', folder: false }
        ],
        more: 0
      }
    ],
    ['gone', { ok: false, reason: 'unreadable' }]
  ])

  it('#55 AC16: marks letters and folder dots, and lists deleted files and their gone folders', () => {
    const rows = visibleRows('repo', tree, new Set(['', 'src', 'gone', 'gone/deep']), changes)
    expect(marked(rows)).toEqual([
      'repo •',
      '  dist',
      '  gone •',
      '    deep •',
      '      x.ts D',
      '  src •',
      '    a.ts M',
      '    c.ts R <src/b.ts',
      '    new.ts U',
      '  .gitignore',
      '  README.md D'
    ])
    expect(rows.find((r) => r.path === 'README.md')?.kind).toBe('file')
    expect(rows.find((r) => r.path === 'gone/deep')?.kind).toBe('folder')
    // A collapsed folder still shows its dot.
    expect(marked(visibleRows('repo', tree, new Set(['']), changes))).toContain('  src •')
  })

  it('#55 AC16: Changed only lists just the changed paths and the folders to them, all expanded', () => {
    const rows = changedRows('repo', changes)
    expect(marked(rows)).toEqual([
      'repo •',
      '  gone •',
      '    deep •',
      '      x.ts D',
      '  src •',
      '    a.ts M',
      '    c.ts R <src/b.ts',
      '    new.ts U',
      '  README.md D'
    ])
    expect(
      rows.filter((r) => r.kind === 'folder' || r.kind === 'root').every((r) => r.expanded)
    ).toBe(true)
    expect(changedRows('repo', [])).toEqual([])
  })
})
