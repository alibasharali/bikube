import { describe, expect, it } from 'vitest'
import { editKeyAction, startEdit, typeInto, submitEdit } from './inline-edit'
import type { Result } from './workspace-store'

const ok: Result<string> = { ok: true, value: 'x' }
const bad: Result<string> = { ok: false, error: { field: 'column', message: 'Nope' } }

describe('inline edit', () => {
  it('starts with the initial value and no error', () => {
    expect(startEdit('Running')).toEqual({ value: 'Running', error: null })
  })

  it('typing updates the value and clears the error', () => {
    const e = { value: 'a', error: 'Nope' }
    expect(typeInto(e, 'ab')).toEqual({ value: 'ab', error: null })
  })

  it('a successful submit finishes the edit', () => {
    expect(submitEdit(startEdit('A'), () => ok)).toEqual({ done: true })
  })

  it('a rejected submit keeps the edit open with the error', () => {
    expect(submitEdit(startEdit(' '), () => bad)).toEqual({
      done: false,
      edit: { value: ' ', error: 'Nope' }
    })
  })

  it('passes the typed value to the commit', () => {
    let seen = ''
    submitEdit(startEdit('Review'), (v) => ((seen = v), ok))
    expect(seen).toBe('Review')
  })

  it('maps Enter to submit and Escape to cancel', () => {
    expect(editKeyAction('Enter')).toBe('submit')
    expect(editKeyAction('Escape')).toBe('cancel')
    expect(editKeyAction('a')).toBeNull()
  })
})
