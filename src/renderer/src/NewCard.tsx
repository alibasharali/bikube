import { useState } from 'react'
import InlineInput from './InlineInput'
import { workspaceStore } from './store'

/**
 * `+ New card` at the end of a column (#4 D4): an inline title; Enter creates the card at the
 * bottom and opens it, which starts its shell (D3, D6, #5 D7). Esc, or blur with nothing typed,
 * cancels.
 */
function NewCard({
  workspaceId,
  columnId,
  onCreated
}: {
  workspaceId: string
  columnId: string
  onCreated: (cardId: string) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  if (!adding) {
    return (
      <button
        type="button"
        className="new-card"
        data-testid="new-card"
        onClick={() => setAdding(true)}
      >
        + New card
      </button>
    )
  }
  return (
    <InlineInput
      className="new-card-form"
      initial=""
      label="Card title"
      inputTestId="new-card-input"
      errorTestId="card-error"
      cancelOnBlur={(value) => value.trim() === ''}
      onCommit={(title) => {
        const created = workspaceStore.createCard(workspaceId, columnId, title)
        if (created.ok) onCreated(created.value.id)
        return created
      }}
      onDone={() => setAdding(false)}
    />
  )
}

export default NewCard
