/**
 * The Agent tab's What changed group (#75 D9): the summary's file changes for one view (the last
 * prompt, the whole session or one earlier prompt) merged into one badge per file, with sizes,
 * grouped by folder relative to the card's folder. No Node or DOM
 * imports: the renderer runs it.
 */
import { joinPath, normalizePath } from './agent-file-changes'
import type { AgentSummary, FileChange } from './agent-summary'
import { SUMMARY_LIMITS } from './agent-summary'
import { compareNames } from './tree-rows'

/** Which changes the group shows. */
export type ChangeView = { kind: 'last' } | { kind: 'session' } | { kind: 'prompt'; number: number }

export type ChangeBadge = 'New' | 'Edited' | 'Deleted' | 'Renamed'

export interface ChangedFile {
  /** The file's name, `old → new` for a rename. */
  name: string
  badge: ChangeBadge
  added: number
  removed: number
  /** Whether its size shows: New and Edited files only. */
  sized: boolean
  /** Its path relative to the card's folder for `files:open`; null when deleted or outside it. */
  open: string | null
}

export interface ChangeGroup {
  /** Relative to the card's folder (`./` for the folder itself), or absolute outside it. */
  folder: string
  files: ChangedFile[]
}

export interface ChangesShown {
  groups: ChangeGroup[]
  /** `<n> files · +<added> −<removed>`. */
  heading: string
  /** The files shown. */
  count: number
  /** The largest file's lines added and removed, for the size bars. */
  largest: number
  /** The empty line when no file changed in the view, else null. */
  empty: string | null
}

export interface ViewOption {
  value: string
  label: string
}

/** The select's options: Last prompt, Whole session, then the earlier prompts newest first. */
export function viewOptions(summary: AgentSummary): ViewOption[] {
  const prompts = summary.prompts ?? []
  const earlier = prompts.slice(0, -1).reverse()
  return [
    { value: 'last', label: 'Last prompt' },
    { value: 'session', label: 'Whole session' },
    ...earlier.map((p) => ({
      value: String(p.number),
      label: `#${p.number} ${p.text.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_LIMITS.promptLabel)}`
    }))
  ]
}

/** The view an option's value names. */
export function viewOfValue(value: string): ChangeView {
  if (value === 'last' || value === 'session') return { kind: value }
  return { kind: 'prompt', number: Number(value) }
}

/** The view's value in the select. */
export const valueOfView = (view: ChangeView): string =>
  view.kind === 'prompt' ? String(view.number) : view.kind

interface Merged {
  path: string
  /** A renamed file's path before the view's first rename. */
  from: string | null
  badge: ChangeBadge
  added: number
  removed: number
}

/** The view's changes merged per file (D9): the last badge that tells, the sizes summed. */
function merge(changes: FileChange[], folder: string): Map<string, Merged> {
  const files = new Map<string, Merged>()
  for (const change of changes) {
    const path = joinPath(folder, change.path)
    const found = files.get(path)
    if (change.kind === 'new' || change.kind === 'edit') {
      if (!found || found.badge === 'Deleted') {
        files.set(path, {
          path,
          from: null,
          badge: change.kind === 'new' && !found ? 'New' : 'Edited',
          added: change.added,
          removed: change.removed
        })
      } else {
        found.added += change.added
        found.removed += change.removed
      }
    } else if (change.kind === 'delete') {
      files.delete(path)
      if (found?.badge === 'New') continue
      const original = found?.from ?? path
      files.set(original, { path: original, from: null, badge: 'Deleted', added: 0, removed: 0 })
    } else if (change.to !== undefined) {
      const to = joinPath(folder, change.to)
      files.delete(path)
      if (found?.badge === 'New') {
        files.set(to, { ...found, path: to })
        continue
      }
      const from = found?.badge === 'Renamed' ? found.from : path
      const sizes = { added: found?.added ?? 0, removed: found?.removed ?? 0 }
      if (from === to) {
        if (sizes.added + sizes.removed > 0) {
          files.set(to, { path: to, from: null, badge: 'Edited', ...sizes })
        }
      } else files.set(to, { path: to, from, badge: 'Renamed', ...sizes })
    }
  }
  return files
}

const dirOf = (path: string): string => {
  const at = path.lastIndexOf('/')
  return at <= 0 ? (path.startsWith('/') ? '/' : '') : path.slice(0, at)
}
const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The view's files merged, grouped and summed, and its summary (D9). */
export function changesView(summary: AgentSummary, folder: string, view: ChangeView): ChangesShown {
  const root = normalizePath(folder)
  const prompts = summary.prompts ?? []
  const number =
    view.kind === 'last'
      ? prompts[prompts.length - 1]?.number
      : view.kind === 'prompt'
        ? view.number
        : null
  const all = summary.changes ?? []
  const changes = view.kind === 'session' ? all : all.filter((c) => c.prompt === number)
  const relative = (path: string): string | null =>
    path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null

  const groups = new Map<string, { inside: boolean; files: ChangedFile[] }>()
  let added = 0
  let removed = 0
  let largest = 0
  let count = 0
  for (const file of merge(changes, root).values()) {
    const rel = relative(file.path)
    const folderName = rel === null ? dirOf(file.path) : dirOf(rel) || './'
    const sized = file.badge === 'New' || file.badge === 'Edited'
    let name = nameOf(file.path)
    if (file.from !== null) {
      const from =
        dirOf(file.from) === dirOf(file.path)
          ? nameOf(file.from)
          : (relative(file.from) ?? file.from)
      name = `${from} → ${name}`
    }
    if (sized) {
      added += file.added
      removed += file.removed
      largest = Math.max(largest, file.added + file.removed)
    }
    count++
    const group = groups.get(folderName) ?? { inside: rel !== null, files: [] }
    group.files.push({
      name,
      badge: file.badge,
      added: file.added,
      removed: file.removed,
      sized,
      open: rel !== null && file.badge !== 'Deleted' ? rel : null
    })
    groups.set(folderName, group)
  }
  const ordered = [...groups.entries()].sort(
    ([a, ga], [b, gb]) => Number(gb.inside) - Number(ga.inside) || compareNames(a, b)
  )
  return {
    groups: ordered.map(([name, group]) => ({
      folder: name,
      files: group.files.sort((a, b) => compareNames(a.name, b.name))
    })),
    heading: `${count} ${count === 1 ? 'file' : 'files'} · +${added} −${removed}`,
    count,
    largest,
    empty:
      count > 0
        ? null
        : view.kind === 'session'
          ? 'No file changes in this session.'
          : 'No file changes in this prompt.'
  }
}
