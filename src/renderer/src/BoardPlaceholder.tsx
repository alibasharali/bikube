import type { Workspace } from '../../core/workspace-store'

/** Stand-in for the board (S5): shows the workspace name and its column names. */
function BoardPlaceholder({ workspace }: { workspace: Workspace }): React.JSX.Element {
  return (
    <section className="board" data-testid="board" aria-label={`Board for ${workspace.name}`}>
      <header className="board-header">
        <h1 data-testid="board-title">{workspace.name}</h1>
        <span className="board-dir">{workspace.directory}</span>
      </header>
      <ol className="board-columns">
        {workspace.columns.map((c) => (
          <li key={c.id} className="board-column" data-testid="column">
            <span data-testid="column-name">{c.name}</span>
            <span className="count">0</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default BoardPlaceholder
