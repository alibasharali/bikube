import { useState } from 'react'
import InlineInput from './InlineInput'
import { workspaceStore } from './store'

function AddColumn({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  if (!adding) {
    return (
      <button
        type="button"
        className="add-column"
        data-testid="add-column"
        onClick={() => setAdding(true)}
      >
        + Add column
      </button>
    )
  }
  return (
    <div className="add-column-form">
      <InlineInput
        initial=""
        label="Column name"
        inputTestId="add-column-input"
        errorTestId="column-error"
        onCommit={(name) => workspaceStore.addColumn(workspaceId, name)}
        onDone={() => setAdding(false)}
      >
        Add
      </InlineInput>
    </div>
  )
}

export default AddColumn
