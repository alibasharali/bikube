import {
  GitBranch,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Server,
  Settings,
  Trash2
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { hoverHalf } from '../../core/card-drops'
import {
  keyMoveIndex,
  nearestWorkspaceHover,
  workspaceDropIndex,
  workspaceMoveKey,
  type WorkspaceHover
} from '../../core/workspace-drops'
import { waitingCounts, waitingTooltip } from '../../core/waiting'
import type { Workspace } from '../../core/workspace-store'
import { useWaitingQueue } from './attention'
import { useBranch } from './branches'
import type { HeldNumbers } from './held-numbers'
import { useOpenTerminals } from './open-terminals'
import { workspaceStore } from './store'
import UpdateButton from './UpdateButton'
import { ICON, SMALL_ICON } from './icons'
import {
  WORKSPACE_DRAG_TYPE,
  draggedWorkspace,
  endWorkspaceDrag,
  startWorkspaceDrag
} from './workspace-drag'
import WorkspaceBadge from './WorkspaceBadge'
import WorkspaceTerminals from './WorkspaceTerminals'

interface SidebarProps {
  workspaces: Workspace[]
  activeId: string | null
  collapsed: boolean
  onToggle: () => void
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  /** Opens the Settings dialog (#10 D5). */
  onSettings: () => void
  /** The sync status line (#13 D13), or null when sync is off. */
  syncStatus: string | null
  /** The card or shell open at full size in the active workspace, or null. */
  openId: string | null
  /** Opens a running card or shell from its workspace's tree. */
  onOpenTerminal: (workspaceId: string, cardId: string) => void
  /** The workspaces whose view is their Agent setup page, each with its row (#68 D3). */
  agentSetupIds: readonly string[]
  /** Shows workspace `id`'s Agent setup page, from its row. */
  onOpenAgentSetup: (id: string) => void
  /** The numbers a held modifier would pick with a digit, shown on the rows. */
  heldNumbers: HeldNumbers
}

/**
 * The workspace list as a tree: under each workspace its running cards and shells
 * (`WorkspaceTerminals`). A workspace row's click or Enter shows its board; dragging it, or Alt+Up/Down while it has focus, moves it to
 * another place, with a line showing where it would land (#32 D4, D5).
 */
function Sidebar({
  workspaces,
  activeId,
  collapsed,
  onToggle,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  onSettings,
  syncStatus,
  openId,
  onOpenTerminal,
  agentSetupIds,
  onOpenAgentSetup,
  heldNumbers
}: SidebarProps): React.JSX.Element {
  // Where a workspace dragged over the list would land (#32 D4), or null.
  const [dropAt, setDropAt] = useState<{ workspaceId: string; index: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const dragActive = useRef<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // The row a keyboard move just moved: it takes focus back once it has re-rendered (D5).
  const focusAfterMove = useRef<string | null>(null)
  const ids = workspaces.map((w) => w.id)
  const queue = useWaitingQueue()
  const waiting = useMemo(() => waitingCounts(queue, workspaces), [queue, workspaces])
  const terminals = useOpenTerminals(workspaces)

  useLayoutEffect(() => {
    const id = focusAfterMove.current
    if (id === null) return
    focusAfterMove.current = null
    listRef.current
      ?.querySelector<HTMLElement>(`[data-workspace-id="${CSS.escape(id)}"] .workspace-item`)
      ?.focus()
  })

  // A drag that ends anywhere (dropped, cancelled with Esc or outside) clears the line.
  useEffect(() => {
    const clear = (): void => setDropAt(null)
    document.addEventListener('dragend', clear)
    document.addEventListener('drop', clear)
    return () => {
      document.removeEventListener('dragend', clear)
      document.removeEventListener('drop', clear)
    }
  }, [])

  /** Alt+Up/Down moves the focused row one place; at an end nothing happens (#32 D5). */
  const onKeyDown = (e: React.KeyboardEvent, workspaceId: string): void => {
    const direction = workspaceMoveKey(e)
    if (!direction) return
    e.preventDefault()
    const index = keyMoveIndex(ids, workspaceId, direction)
    if (index === null) return
    focusAfterMove.current = workspaceId
    if (!workspaceStore.moveWorkspace(workspaceId, index).ok) focusAfterMove.current = null
  }

  const onDragStart = (e: React.DragEvent, workspaceId: string): void => {
    e.dataTransfer.setData(WORKSPACE_DRAG_TYPE, workspaceId)
    e.dataTransfer.effectAllowed = 'move'
    startWorkspaceDrag(workspaceId)
    dragActive.current = workspaceId
    // Dim after the browser has taken the drag image from the undimmed row.
    setTimeout(() => setDragging(dragActive.current), 0)
  }

  const onDragEnd = (): void => {
    dragActive.current = null
    endWorkspaceDrag()
    setDragging(null)
  }

  /** The drop position for a workspace dragged over the list, or null for any other drag. */
  const dropTarget = (e: React.DragEvent): { workspaceId: string; index: number } | null => {
    const dragged = draggedWorkspace(e.dataTransfer)
    if (!dragged) return null
    const row = (e.target as Element).closest<HTMLElement>('[data-workspace-id]')
    const hovered = row?.dataset.workspaceId
    let over: WorkspaceHover | 'bottom'
    if (row && hovered && ids.includes(hovered)) {
      const box = row.getBoundingClientRect()
      over = { workspaceId: hovered, half: hoverHalf(e.clientY, box.top, box.height) }
    } else {
      // In a gap between rows: the nearest row decides; below the last, the bottom.
      const rows = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>('[data-workspace-id]')
      ).map((r) => {
        const box = r.getBoundingClientRect()
        return { workspaceId: r.dataset.workspaceId ?? '', top: box.top, height: box.height }
      })
      over = nearestWorkspaceHover(rows, e.clientY)
    }
    return { workspaceId: dragged, index: workspaceDropIndex(ids, dragged, over) }
  }

  const onDragOver = (e: React.DragEvent): void => {
    const target = dropTarget(e)
    if (!target) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (target.workspaceId !== dropAt?.workspaceId || target.index !== dropAt.index) {
      setDropAt(target)
    }
  }

  const onDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
  }

  const onDrop = (e: React.DragEvent): void => {
    const target = dropTarget(e)
    if (!target) return
    e.preventDefault()
    setDropAt(null)
    endWorkspaceDrag()
    workspaceStore.moveWorkspace(target.workspaceId, target.index)
  }

  // The line goes above the row at the drop position, counted without the dragged row, or
  // below the last row.
  const others = dropAt ? workspaces.filter((w) => w.id !== dropAt.workspaceId) : workspaces
  const lineBefore = dropAt && others[dropAt.index]?.id
  const lineAfter = dropAt && !lineBefore ? workspaces[workspaces.length - 1]?.id : undefined

  return (
    <nav
      className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'}
      data-testid="sidebar"
      data-collapsed={collapsed}
      aria-label="Workspaces"
    >
      <div className="sidebar-header">
        <button
          type="button"
          className="icon-btn"
          data-testid="sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? <PanelLeftOpen {...ICON} /> : <PanelLeftClose {...ICON} />}
        </button>
        {!collapsed && <span className="sidebar-title">Workspaces</span>}
        <button
          type="button"
          className="icon-btn"
          data-testid="workspace-add"
          aria-label="Create workspace"
          title="Create workspace"
          onClick={onAdd}
        >
          <Plus {...ICON} />
        </button>
      </div>
      <ul
        ref={listRef}
        className="workspace-list"
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {workspaces.map((w, index) => {
          const active = w.id === activeId
          const count = waiting.get(w.id) ?? 0
          return (
            <li
              key={w.id}
              className={dragging === w.id ? 'workspace-row workspace-dragging' : 'workspace-row'}
              data-workspace-id={w.id}
              data-drop={w.id === lineBefore ? 'before' : w.id === lineAfter ? 'after' : undefined}
            >
              <div className="workspace-head">
                <button
                  type="button"
                  className={active ? 'workspace-item active' : 'workspace-item'}
                  data-testid="workspace-item"
                  aria-current={active ? 'true' : undefined}
                  aria-label={
                    collapsed
                      ? count > 0
                        ? `${w.name}, ${waitingTooltip(count)}`
                        : w.name
                      : undefined
                  }
                  title={
                    collapsed
                      ? w.name
                      : w.host === undefined
                        ? w.directory
                        : `${w.host}:${w.directory}`
                  }
                  draggable
                  onDragStart={(e) => onDragStart(e, w.id)}
                  onDragEnd={onDragEnd}
                  onClick={() => onSelect(w.id)}
                  onKeyDown={(e) => onKeyDown(e, w.id)}
                >
                  {/* Collapsed, the tree is hidden: the badge's dot counts what waits. */}
                  <WorkspaceBadge
                    workspace={w}
                    waiting={collapsed ? count : 0}
                    number={heldNumbers === 'workspace' && index < 9 ? index + 1 : null}
                  />
                  {!collapsed && <WorkspaceName workspace={w} />}
                  {!collapsed && w.host !== undefined && (
                    <Server className="workspace-ssh" {...SMALL_ICON} />
                  )}
                </button>
                {!collapsed && (
                  <span className="workspace-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      data-testid="workspace-edit"
                      aria-label={`Edit ${w.name}`}
                      title="Edit workspace"
                      onClick={() => onEdit(w.id)}
                    >
                      <Pencil {...SMALL_ICON} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      data-testid="workspace-delete"
                      aria-label={`Delete ${w.name}`}
                      title="Delete workspace"
                      onClick={() => onDelete(w.id)}
                    >
                      <Trash2 {...SMALL_ICON} />
                    </button>
                  </span>
                )}
              </div>
              {!collapsed && (
                <WorkspaceTerminals
                  terminals={terminals.get(w.id) ?? []}
                  currentId={active ? openId : null}
                  onOpen={onOpenTerminal}
                  agentSetup={
                    agentSetupIds.includes(w.id)
                      ? { current: active, onOpen: () => onOpenAgentSetup(w.id) }
                      : null
                  }
                  showNumbers={active && heldNumbers === 'terminal'}
                />
              )}
            </li>
          )
        })}
      </ul>
      <div className="sidebar-footer">
        <UpdateButton collapsed={collapsed} />
        {!collapsed && syncStatus !== null && (
          <p className="sidebar-sync" data-testid="sync-status">
            {syncStatus}
          </p>
        )}
        <button
          type="button"
          className="sidebar-settings"
          data-testid="settings-open"
          aria-label={collapsed ? 'Settings' : undefined}
          title={collapsed ? 'Settings' : undefined}
          onClick={onSettings}
        >
          <Settings className="sidebar-settings-icon" {...ICON} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>
    </nav>
  )
}

/** A workspace's name, and under it the branch its folder is on (local git repositories only). */
function WorkspaceName({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const branch = useBranch(workspace.host === undefined ? workspace.directory : null)
  return (
    <span className="workspace-text">
      <span className="workspace-name">{workspace.name}</span>
      {branch && (
        <span className="workspace-branch" data-testid="workspace-branch">
          <GitBranch {...SMALL_ICON} />
          <span>{branch}</span>
        </span>
      )}
    </span>
  )
}

export default Sidebar
