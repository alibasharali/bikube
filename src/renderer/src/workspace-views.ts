import { LayoutGrid, SquareKanban, type LucideIcon } from 'lucide-react'
import type { WorkspaceView } from '../../core/workspace-store'

/** The View choice, in the workspace dialog, Settings and the first launch's prompt. */
export const VIEWS: [WorkspaceView, string, LucideIcon][] = [
  ['kanban', 'Kanban', SquareKanban],
  ['grid', 'Grid', LayoutGrid]
]
