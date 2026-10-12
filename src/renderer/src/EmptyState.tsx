interface EmptyStateProps {
  onCreateWorkspace: () => void
}

function EmptyState({ onCreateWorkspace }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-state" data-testid="empty-state">
      <h1>No workspaces yet</h1>
      <p>
        A workspace is a project folder with its own board. Create one to start organising your
        coding agents.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        data-testid="create-workspace"
        onClick={onCreateWorkspace}
      >
        Create workspace
      </button>
    </div>
  )
}

export default EmptyState
