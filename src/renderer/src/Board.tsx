import { useEffect } from 'react'
import type { Workspace } from '../../core/workspace-store'
import AddColumn from './AddColumn'
import ShellStrip from './ShellStrip'
import BoardColumn from './BoardColumn'
import { takeNewCardRequest, useNewCardRequest } from './new-card-request'

/** The workspace's board: columns as vertical lanes, scrolling horizontally. */
function Board({
  workspace,
  onOpenCard
}: {
  workspace: Workspace
  onOpenCard: (cardId: string) => void
}): React.JSX.Element {
  // The command palette's New card opens the first column's form (#40 D9), once per request.
  const newCardRequest = useNewCardRequest(workspace.id)
  useEffect(() => {
    if (newCardRequest !== undefined) takeNewCardRequest(newCardRequest)
  }, [newCardRequest])
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
            openNewCard={i === 0 ? newCardRequest : undefined}
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
