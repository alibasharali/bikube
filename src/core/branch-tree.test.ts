import { describe, expect, it } from 'vitest'
import { branchTree, foldersOf, visibleRows, type BranchNode } from './branch-tree'

/** The tree as indented lines: `name` for a branch, `name/ (count)` for a folder. */
function lines(nodes: readonly BranchNode[], depth = 0): string[] {
  return nodes.flatMap((n) =>
    n.kind === 'branch'
      ? [`${'  '.repeat(depth)}${n.label}`]
      : [`${'  '.repeat(depth)}${n.label}/ (${n.count})`, ...lines(n.children, depth + 1)]
  )
}

describe('branchTree', () => {
  it('puts branches in folders by their `/` segments, branches first, a lone one as itself', () => {
    const tree = branchTree([
      'ali/bug/batch-preview',
      'ali/feat/admin-page',
      'ali/feature/llm-benchmark',
      'ali/feature/whitelabel',
      'develop',
      'feat/aks-web',
      'main'
    ])
    expect(lines(tree)).toEqual([
      'develop',
      'feat/aks-web',
      'main',
      'ali/ (4)',
      '  bug/batch-preview',
      '  feat/admin-page',
      '  feature/ (2)',
      '    llm-benchmark',
      '    whitelabel'
    ])
  })

  it('merges a folder that holds only one folder, and keeps the full name on each branch', () => {
    const tree = branchTree(['ali/feature/a', 'ali/feature/b', 'x/y'])
    expect(lines(tree)).toEqual(['x/y', 'ali/feature/ (2)', '  a', '  b'])
    const folder = tree[1]
    expect(folder?.kind === 'folder' && folder.path).toBe('ali/feature')
    expect(folder?.kind === 'folder' && folder.children[1]).toEqual({
      kind: 'branch',
      branch: 'ali/feature/b',
      label: 'b'
    })
  })

  it('sorts folders by name even when git lists the current branch first', () => {
    const tree = branchTree(['ali/feature/b', 'ali/feat/a', 'ali/feat/c', 'ali/feature/d'])
    expect(lines(tree)).toEqual([
      'ali/ (4)',
      '  feat/ (2)',
      '    a',
      '    c',
      '  feature/ (2)',
      '    b',
      '    d'
    ])
  })

  it('keeps a branch and a folder of the same name apart', () => {
    expect(lines(branchTree(['ali', 'ali/a', 'ali/b']))).toEqual(['ali', 'ali/ (2)', '  a', '  b'])
  })

  it('finds the folders holding a branch, merged ones as one', () => {
    const tree = branchTree(['ali/feature/a', 'ali/feature/b', 'ali/bug/c', 'main'])
    expect(foldersOf(tree, 'ali/feature/b')).toEqual(['ali', 'ali/feature'])
    expect(foldersOf(branchTree(['x/y/a', 'x/y/b']), 'x/y/a')).toEqual(['x/y'])
    expect(foldersOf(tree, 'main')).toEqual([])
    expect(foldersOf(tree, null)).toEqual([])
  })
})

describe('visibleRows', () => {
  const names = Array.from({ length: 12 }, (_, i) => `b${String(i).padStart(2, '0')}`)
  const labels = (r: { branches: { label: string }[]; folders: { label: string }[] }): string[] => [
    ...r.branches.map((b) => b.label),
    ...r.folders.map((f) => `${f.label}/`)
  ]

  it('shows the first branches up to the limit, counts the rest, and every folder', () => {
    const shown = visibleRows(branchTree([...names, 'z/a', 'z/b', 'y/a', 'y/b']), null, false, 8)
    expect(labels(shown)).toEqual([...names.slice(0, 8), 'y/', 'z/'])
    expect(shown.hidden).toBe(4)
  })

  it('shows all when asked or under the limit', () => {
    expect(visibleRows(branchTree(names), null, true, 8)).toMatchObject({ hidden: 0 })
    expect(visibleRows(branchTree(names.slice(0, 8)), null, false, 8).hidden).toBe(0)
  })

  it('adds the current branch when it falls past the limit', () => {
    const shown = visibleRows(branchTree(names), 'b10', false, 8)
    expect(labels(shown)).toEqual([...names.slice(0, 8), 'b10'])
    expect(shown.hidden).toBe(3)
  })
})
