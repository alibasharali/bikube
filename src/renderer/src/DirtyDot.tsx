import { useEditorStatus } from './editor-files'

/** A tab's dot while it holds unsaved edits (#83 D9, D4). */
function DirtyDot({
  workspaceId,
  id,
  testId
}: {
  workspaceId: string
  id: string
  testId: string
}): React.JSX.Element | null {
  const { dirty } = useEditorStatus(workspaceId, id)
  if (!dirty) return null
  return (
    <span
      className="file-dirty-dot"
      data-testid={testId}
      role="img"
      aria-label="Unsaved changes"
      title="Unsaved changes"
    />
  )
}

export default DirtyDot
