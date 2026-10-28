import { ChevronDown, ChevronRight, CornerDownRight, FileDiff, RotateCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeLetter } from '../../core/git-status'
import { isOpenNote, openErrorLine, type OpenResult } from '../../core/open-result'
import FileIcon from './FileIcon'
import { changedRows, onDisk, treeKey, visibleRows, type TreeRow } from '../../core/tree-rows'
import { refreshTree, setChangedOnly, toggleFolder, useFolderTree } from './file-tree'
import { SMALL_ICON } from './icons'
import { anyWindowFocused, onAnyWindowFocus } from './window-focus'

/** How often the shown folder is read again while the tab shows and the window is focused (D12). */
const REFRESH_MS = 3000

/** The folder's name: its path's last segment (D5). */
const folderName = (folder: string): string =>
  folder
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() || folder

/**
 * Reads `folder`'s tree at once, every 3 seconds while a Bikube window is focused, and when one
 * gains the focus (D12, #53 D10: a card's own window counts); nothing once the tab is gone (panel
 * hidden, card or shell closed).
 */
function useRefresh(folder: string): void {
  useEffect(() => {
    void refreshTree(folder)
    const timer = setInterval(() => {
      if (anyWindowFocused()) void refreshTree(folder)
    }, REFRESH_MS)
    const stopFocus = onAnyWindowFocus(() => void refreshTree(folder))
    return () => {
      clearInterval(timer)
      stopFocus()
    }
  }, [folder])
}

/** Each letter's meaning (D10), read out with it. */
const CHANGE_NAMES: Record<ChangeLetter, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked',
  R: 'Renamed',
  C: 'Conflicted'
}

/** One row of the tree (D7, D8, D9, D10). */
function Row({
  row,
  selected,
  focusable,
  folder,
  onSelect,
  onActivate
}: {
  row: TreeRow
  selected: boolean
  focusable: boolean
  folder: string
  onSelect: () => void
  onActivate: () => void
}): React.JSX.Element {
  const expandable = row.kind === 'root' || row.kind === 'folder'
  const item = expandable || row.kind === 'file'
  return (
    <div
      className="files-row"
      data-testid="files-row"
      data-path={row.path}
      data-kind={row.kind}
      data-ignored={row.ignored}
      data-change={row.change}
      data-dot={expandable ? row.dot === true : undefined}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={item ? selected : undefined}
      aria-expanded={expandable ? row.expanded === true : undefined}
      aria-disabled={item ? undefined : true}
      tabIndex={item ? (focusable ? 0 : -1) : undefined}
      title={row.kind === 'root' ? folder : undefined}
      style={{ paddingLeft: `calc(var(--space-2) + ${row.depth * 12}px)` }}
      onClick={item ? onSelect : undefined}
      onDoubleClick={item ? onActivate : undefined}
    >
      <span
        className="files-chevron"
        aria-hidden="true"
        onClick={
          expandable
            ? (event) => {
                event.stopPropagation()
                onSelect()
                onActivate()
              }
            : undefined
        }
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {expandable &&
          (row.expanded ? <ChevronDown {...SMALL_ICON} /> : <ChevronRight {...SMALL_ICON} />)}
      </span>
      {(row.kind === 'root' || row.kind === 'folder' || row.kind === 'file') && (
        <FileIcon name={row.name} kind={row.kind} open={row.expanded === true} />
      )}
      <span className="files-name">{row.name}</span>
      {row.entry?.symlink && (
        <span className="files-link" aria-label="Symbolic link" title="Symbolic link">
          <CornerDownRight {...SMALL_ICON} />
        </span>
      )}
      {row.dot && !row.change && <span className="files-dot" aria-label="Has changes" />}
      {row.change && (
        <span
          className="files-change"
          data-testid="files-change"
          aria-label={CHANGE_NAMES[row.change]}
          title={row.from !== undefined ? `Renamed from ${row.from}` : CHANGE_NAMES[row.change]}
        >
          {row.change}
        </span>
      )}
    </div>
  )
}

/**
 * The side panel's Files tab (#55 D5–D12): the open card's folder (`folder`, its directory,
 * or the workspace's folder for a shell) as a `tree`, read lazily one expanded folder at a time,
 * ignored entries dimmed, git's changes marked, Changed only on request, kept up to date while
 * it shows. Over SSH it only says files aren't
 * available (D6): nothing is listed and no git runs. `onOpenFile` opens a file's path (relative to
 * `folder`) on double-click or Enter (D13), never a deleted one; when it fails, an error line
 * shows until the next open or its dismiss button.
 */
function FilesTab({
  folder,
  ssh,
  onOpenFile = async () => ({ ok: true })
}: {
  folder: string
  ssh: boolean
  onOpenFile?: (path: string) => Promise<OpenResult>
}): React.JSX.Element {
  if (ssh) {
    return (
      <div className="files-tab files-tab-message" data-testid="files-tab">
        Files aren&apos;t available over SSH yet
      </div>
    )
  }
  return <LocalFiles key={folder} folder={folder} onOpenFile={onOpenFile} />
}

function LocalFiles({
  folder,
  onOpenFile
}: {
  folder: string
  onOpenFile: (path: string) => Promise<OpenResult>
}): React.JSX.Element {
  useRefresh(folder)
  const { expanded, listings, status, changedOnly } = useFolderTree(folder)
  const changes = status?.ok ? status.changes : []
  const repository = status?.ok === true
  const onlyChanged = changedOnly && repository
  const rows = onlyChanged
    ? changedRows(folderName(folder), changes)
    : visibleRows(folderName(folder), listings, expanded, changes)
  const [selected, setSelected] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const shownSelected = rows.some((r) => r.path === selected) ? selected : null
  /** The last open's error line, or its note when the file opened with the default app (#70 D3). */
  const [openError, setOpenError] = useState<{ text: string; note: boolean } | null>(null)
  /** Only the latest open's result shows. */
  const opens = useRef(0)

  // A deleted file does nothing (D13); one still on disk opens, whatever its letter.
  const open = (path: string): void => {
    const row = rows.find((r) => r.path === path)
    if (row?.kind !== 'file' || !onDisk(row, listings)) return
    const at = ++opens.current
    setOpenError(null)
    void onOpenFile(path).then((result) => {
      if (at !== opens.current) return
      const text = openErrorLine(path, result)
      setOpenError(text === null ? null : { text, note: isOpenNote(result) })
    })
  }

  const activate = (row: TreeRow): void => {
    if (row.kind === 'file') open(row.path)
    // Changed only keeps every folder expanded (D11).
    else if ((row.kind === 'root' || row.kind === 'folder') && !onlyChanged) {
      toggleFolder(folder, row.path)
    }
  }
  const select = (path: string, focus: boolean): void => {
    setSelected(path)
    if (!focus) return
    const element = treeRef.current?.querySelector<HTMLElement>(
      `[data-testid=files-row][data-path="${CSS.escape(path)}"]`
    )
    element?.focus()
  }

  return (
    <div className="files-tab" data-testid="files-tab" data-folder={folder}>
      <div className="files-header">
        <button
          type="button"
          className="icon-btn files-changed-only"
          data-testid="files-changed-only"
          aria-label="Changed only"
          aria-pressed={onlyChanged}
          title={
            status && !status.ok && status.reason === 'not-repository'
              ? 'Not a git repository'
              : 'Changed only'
          }
          disabled={!repository}
          onClick={() => setChangedOnly(folder, !changedOnly)}
        >
          <FileDiff {...SMALL_ICON} />
        </button>
        <button
          type="button"
          className="icon-btn files-refresh"
          data-testid="files-refresh"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => void refreshTree(folder)}
        >
          <RotateCw {...SMALL_ICON} />
        </button>
      </div>
      {openError !== null && (
        <div
          className={openError.note ? 'files-error files-note' : 'files-error'}
          role={openError.note ? 'status' : 'alert'}
          data-testid="files-open-error"
        >
          <span className="files-error-text">{openError.text}</span>
          <button
            type="button"
            className="icon-btn"
            data-testid="files-open-error-dismiss"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setOpenError(null)}
          >
            <X {...SMALL_ICON} />
          </button>
        </div>
      )}
      <div
        ref={treeRef}
        className="files-tree"
        role="tree"
        aria-label="Files"
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
          const action = treeKey(rows, shownSelected, event.key)
          if (Object.keys(action).length === 0) return
          event.preventDefault()
          if (action.select !== undefined) select(action.select, true)
          if (action.toggle !== undefined && !onlyChanged) toggleFolder(folder, action.toggle)
          if (action.open !== undefined) open(action.open)
        }}
      >
        {onlyChanged && rows.length === 0 && (
          <div className="files-tab-message" data-testid="files-no-changes">
            No changes
          </div>
        )}
        {rows.map((row) => (
          <Row
            key={row.path}
            row={row}
            folder={folder}
            selected={row.path === shownSelected}
            focusable={row.path === (shownSelected ?? '')}
            onSelect={() => select(row.path, false)}
            onActivate={() => activate(row)}
          />
        ))}
      </div>
    </div>
  )
}

export default FilesTab
