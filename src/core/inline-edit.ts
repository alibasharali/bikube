/** Pure state for inline text edits (rename a column, add a column): Enter submits, Esc cancels. */
import type { Result } from './workspace-store'

export interface InlineEdit {
  value: string
  error: string | null
}

export type SubmitOutcome = { done: true } | { done: false; edit: InlineEdit }

export const startEdit = (value = ''): InlineEdit => ({ value, error: null })

/** Typing clears any previous error. */
export const typeInto = (edit: InlineEdit, value: string): InlineEdit => ({
  ...edit,
  value,
  error: null
})

/** Runs the commit; a rejection keeps the edit open and shows the message inline. */
export function submitEdit<T>(
  edit: InlineEdit,
  commit: (value: string) => Result<T>
): SubmitOutcome {
  const result = commit(edit.value)
  return result.ok
    ? { done: true }
    : { done: false, edit: { ...edit, error: result.error.message } }
}

export function editKeyAction(key: string): 'submit' | 'cancel' | null {
  if (key === 'Enter') return 'submit'
  if (key === 'Escape') return 'cancel'
  return null
}
