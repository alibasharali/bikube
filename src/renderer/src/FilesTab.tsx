import { ChevronDown, ChevronRight, CornerDownRight, RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { treeKey, visibleRows, type TreeRow } from '../../core/tree-rows'
import { refreshTree, toggleFolder, useFolderTree } from './file-tree'
import { SMALL_ICON } from './icons'

/** How often the shown folder is read again while the tab shows and the window is focused (D12). */
const REFRESH_MS = 3000

/** The folder's name: its path's last segment (D5). */
const folderName = (folder: string): string =>
  folder
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() || folder

/**
 * Reads `folder`'s tree at once, every 3 seconds while the window is focused, and when the window
 * gains the focus (D12); nothing once the tab is gone (panel hidden, card or shell closed).
 */
function useRefresh(folder: string): void {
  useEffect(() => {
    void refreshTree(folder)
    const timer = setInterval(() => {
      if (document.hasFocus()) void refreshTree(folder)
    }, REFRESH_MS)
    const onFocus = (): void => void refreshTree(folder)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [folder])
}

/** One row of the tree (D7, D8, D9). */
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
      <span className="files-name">{row.name}</span>
      {row.entry?.symlink && (
        <span className="files-link" aria-label="Symbolic link" title="Symbolic link">
          <CornerDownRight {...SMALL_ICON} />
        </span>
      )}
    </div>
  )
}

/**
 * The side panel's Files tab (#55 D5–D9, D12): the open card's folder (`folder`, its directory,
 * or the workspace's folder for a shell) as a `tree`, read lazily one expanded folder at a time,
 * ignored entries dimmed, kept up to date while it shows. Over SSH it only says files aren't
 * available (D6): nothing is listed and no git runs. `onOpenFile` gets a file's path (relative to
 * `folder`) on double-click or Enter.
 */
function FilesTab({
  folder,
  ssh,
  onOpenFile = () => {}
}: {
  folder: string
  ssh: boolean
  onOpenFile?: (path: string) => void
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
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  useRefresh(folder)
  const { expanded, listings } = useFolderTree(folder)
  const rows = visibleRows(folderName(folder), listings, expanded)
  const [selected, setSelected] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const shownSelected = rows.some((r) => r.path === selected) ? selected : null

  const activate = (row: TreeRow): void => {
    if (row.kind === 'file') onOpenFile(row.path)
    else if (row.kind === 'root' || row.kind === 'folder') toggleFolder(folder, row.path)
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
          className="icon-btn files-refresh"
          data-testid="files-refresh"
          aria-label="Refresh"
          title="Refresh"
          onClick={() => void refreshTree(folder)}
        >
          <RotateCw {...SMALL_ICON} />
        </button>
      </div>
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
          if (action.toggle !== undefined) toggleFolder(folder, action.toggle)
          if (action.open !== undefined) onOpenFile(action.open)
        }}
      >
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
