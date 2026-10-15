import { Server } from 'lucide-react'
import type { Workspace } from '../../core/workspace-store'
import AddColumn from './AddColumn'
import BoardColumn from './BoardColumn'
import { SMALL_ICON } from './icons'

/** The workspace's board: columns as vertical lanes, scrolling horizontally. */
function Board({
  workspace,
  onOpenCard
}: {
  workspace: Workspace
  onOpenCard: (cardId: string) => void
}): React.JSX.Element {
  return (
    <section className="board" data-testid="board" aria-label={`Board for ${workspace.name}`}>
      <header className="board-header">
        <h1 data-testid="board-title">{workspace.name}</h1>
        {workspace.host === undefined ? (
          <span className="board-dir">{workspace.directory}</span>
        ) : (
          // An SSH workspace is marked with lucide `Server` (#31 D17) and shows its host.
          <span className="board-dir" title={`SSH: ${workspace.host}`}>
            <Server {...SMALL_ICON} />
            {workspace.host}:{workspace.directory}
          </span>
        )}
      </header>
      <ol className="board-columns">
        {workspace.columns.map((c, i) => (
          <BoardColumn
            key={c.id}
            workspace={workspace}
            column={c}
            index={i}
            total={workspace.columns.length}
            onOpenCard={onOpenCard}
          />
        ))}
        <li className="board-add">
          <AddColumn workspaceId={workspace.id} />
        </li>
      </ol>
    </section>
  )
}

export default Board
