/**
 * The branch menu's lists as trees: branch names split at `/` into folders (`ali/feature/x` in
 * `ali` > `feature`), a folder holding nothing but one folder merged with it (`ali/feature`), and
 * a folder of a single branch shown as that branch (`feat/aks-web`). At each level branches come
 * first, in git's order, then folders, by name. Plain TS, no DOM: the renderer and Vitest run it.
 */

export interface BranchLeaf {
  kind: 'branch'
  /** The full branch name. */
  branch: string
  /** What the row shows: the name below its folder. */
  label: string
}

export interface BranchFolder {
  kind: 'folder'
  /** The folder's path, its key: `ali/feature`. */
  path: string
  /** What the row shows: the path below its parent folder (`feature`, or `ali/feature` merged). */
  label: string
  children: BranchNode[]
  /** Every branch inside it, at any depth. */
  count: number
}

export type BranchNode = BranchLeaf | BranchFolder

/** How many loose branches a section shows at its top level before its View all. */
export const BRANCH_ROW_LIMIT = 8

export function branchTree(branches: readonly string[]): BranchNode[] {
  return build(
    branches.map((branch) => ({ branch, parts: branch.split('/') })),
    ''
  )
}

function build(entries: { branch: string; parts: string[] }[], prefix: string): BranchNode[] {
  const leaves: BranchLeaf[] = []
  const groups = new Map<string, { branch: string; parts: string[] }[]>()
  for (const entry of entries) {
    const [head, ...rest] = entry.parts
    // A name ending in `/` or with an empty segment stays one branch where it is.
    if (rest.length === 0 || head === '' || rest.some((p) => p === '')) {
      leaves.push({ kind: 'branch', branch: entry.branch, label: entry.parts.join('/') })
      continue
    }
    const group = groups.get(head!) ?? []
    group.push({ branch: entry.branch, parts: rest })
    groups.set(head!, group)
  }
  const folders: BranchFolder[] = []
  for (const [name, group] of groups) {
    if (group.length === 1) {
      leaves.push({
        kind: 'branch',
        branch: group[0]!.branch,
        label: [name, ...group[0]!.parts].join('/')
      })
      continue
    }
    const path = prefix ? `${prefix}/${name}` : name
    let folder: BranchFolder = {
      kind: 'folder',
      path,
      label: name,
      children: build(group, path),
      count: group.length
    }
    // Only one folder inside: one row for both.
    while (folder.children.length === 1 && folder.children[0]!.kind === 'folder') {
      const only = folder.children[0] as BranchFolder
      folder = { ...only, label: `${folder.label}/${only.label}` }
    }
    folders.push(folder)
  }
  // Branches in git's order, wherever a single-branch folder put them.
  const order = new Map(entries.map((e, i) => [e.branch, i]))
  leaves.sort((a, b) => order.get(a.branch)! - order.get(b.branch)!)
  // Folders by name, as git sorts refs: never moved by git putting the current branch first.
  folders.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return [...leaves, ...folders]
}

/** The folder paths holding `branch`, outermost first, as `branchTree` made them. */
export function foldersOf(nodes: readonly BranchNode[], branch: string | null): string[] {
  if (branch === null) return []
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    if (branch.startsWith(`${node.path}/`)) return [node.path, ...foldersOf(node.children, branch)]
  }
  return []
}

/**
 * What a section shows at its top level: its folders always (they fold their branches away), and
 * of its loose branches all when `showAll`, else the first `limit` plus the current branch when it
 * falls past them. `hidden` counts the branches left out, for View all.
 */
export function visibleRows(
  nodes: readonly BranchNode[],
  current: string | null,
  showAll: boolean,
  limit = BRANCH_ROW_LIMIT
): { branches: BranchLeaf[]; folders: BranchFolder[]; hidden: number } {
  const all = nodes.filter((n): n is BranchLeaf => n.kind === 'branch')
  const folders = nodes.filter((n): n is BranchFolder => n.kind === 'folder')
  if (showAll || all.length <= limit) return { branches: all, folders, hidden: 0 }
  const branches = all.slice(0, limit)
  const holding = all.findIndex((n) => n.branch === current)
  if (holding >= limit) branches.push(all[holding]!)
  return { branches, folders, hidden: all.length - branches.length }
}
