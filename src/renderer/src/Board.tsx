import type { Workspace } from '../../core/workspace-store'
import AddColumn from './AddColumn'
import ShellStrip from './ShellStrip'
import BoardColumn from './BoardColumn'

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
      {/* The name and folder are in the title bar; the heading stays for screen readers. */}
      <h1 className="visually-hidden">{workspace.name}</h1>
      <ShellStrip workspace={workspace} onOpen={onOpenCard} />
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
