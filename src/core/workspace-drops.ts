/**
 * Where a dragged or keyboard-moved workspace lands in the sidebar (#32 D4, D5), as
 * `moveWorkspace` takes it. Plain TS, no DOM imports. The same rules as cards in a column
 * (#6 D5, D6, D7), so this reuses `card-drops`.
 */
import { dropIndex, nearestCardHover } from './card-drops'
import type { KeyLike } from './clipboard'

/** The pointer over one of the sidebar's workspace rows, in its top or bottom half. */
export interface WorkspaceHover {
  workspaceId: string
  half: 'top' | 'bottom'
}

/** A workspace row's vertical box on screen, for `nearestWorkspaceHover`. */
export interface WorkspaceBox {
  workspaceId: string
  top: number
  height: number
}

/**
 * The drop position, counted among the workspaces without the dragged one: above a row in its
 * top half, below it in its bottom half; over the dragged row itself, its own place. `'bottom'`
 * (below the last row) or an unknown row means the bottom.
 */
export function workspaceDropIndex(
  workspaceIds: readonly string[],
  draggedId: string,
  over: WorkspaceHover | 'bottom'
): number {
  return dropIndex(
    workspaceIds,
    draggedId,
    over === 'bottom' ? over : { cardId: over.workspaceId, half: over.half }
  )
}

/**
 * The hover for a pointer over the workspace list, given its rows' boxes in order: over a row
 * or in the gap between two, the nearest row and the half the pointer is on; at or below the
 * last row's bottom edge, or with no rows, `'bottom'`.
 */
export function nearestWorkspaceHover(
  boxes: readonly WorkspaceBox[],
  pointerY: number
): WorkspaceHover | 'bottom' {
  const hover = nearestCardHover(
    boxes.map((b) => ({ cardId: b.workspaceId, top: b.top, height: b.height })),
    pointerY
  )
  return hover === 'bottom' ? hover : { workspaceId: hover.cardId, half: hover.half }
}

export type WorkspaceMoveDirection = 'up' | 'down'

/** The move an Alt+Up or Alt+Down asks for; plain arrows and other modifiers are not moves. */
export function workspaceMoveKey(event: KeyLike): WorkspaceMoveDirection | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (event.key === 'ArrowUp') return 'up'
  if (event.key === 'ArrowDown') return 'down'
  return null
}

/** Where a keyboard move puts the workspace: one place up or down; null at an end or unknown. */
export function keyMoveIndex(
  workspaceIds: readonly string[],
  workspaceId: string,
  direction: WorkspaceMoveDirection
): number | null {
  const at = workspaceIds.indexOf(workspaceId)
  if (at < 0) return null
  const index = direction === 'up' ? at - 1 : at + 1
  return index < 0 || index >= workspaceIds.length ? null : index
}
