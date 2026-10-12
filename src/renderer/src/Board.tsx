import type { Workspace } from '../../core/workspace-store'
import AddColumn from './AddColumn'
import BoardColumn from './BoardColumn'

/** The workspace's board: columns as vertical lanes, scrolling horizontally. */
function Board({ workspace }: { workspace: Workspace }): React.JSX.Element {
  return (
    <section className="board" data-testid="board" aria-label={`Board for ${workspace.name}`}>
      <header className="board-header">
        <h1 data-testid="board-title">{workspace.name}</h1>
        <span className="board-dir">{workspace.directory}</span>
      </header>
      <ol className="board-columns">
        {workspace.columns.map((c, i) => (
          <BoardColumn
            key={c.id}
            workspaceId={workspace.id}
            column={c}
            index={i}
            total={workspace.columns.length}
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
