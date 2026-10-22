/**
 * The workspace being dragged in the sidebar (#32 D4). The data transfer carries only its id
 * under its own type, never the card type, so the workspace list takes no card and a column
 * takes no workspace.
 */
export const WORKSPACE_DRAG_TYPE = 'application/x-bikube-workspace'

let current: string | null = null

export function startWorkspaceDrag(workspaceId: string): void {
  current = workspaceId
}

export function endWorkspaceDrag(): void {
  current = null
}

/** The id of the workspace being dragged if the event carries one, else null. */
export function draggedWorkspace(transfer: DataTransfer | null): string | null {
  if (!current || !transfer?.types.includes(WORKSPACE_DRAG_TYPE)) return null
  return current
}
