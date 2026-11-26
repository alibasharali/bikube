import { describe, expect, it } from 'vitest'
import { openInEditorLabel } from './open-in-editor'

describe('Open in <editor> (#83 D5)', () => {
  it('names Settings > Editor', () => {
    expect(openInEditorLabel('vscode')).toBe('Open in VS Code')
    expect(openInEditorLabel('cursor')).toBe('Open in Cursor')
    expect(openInEditorLabel('zed')).toBe('Open in Zed')
    expect(openInEditorLabel('system')).toBe('Open with default app')
    expect(openInEditorLabel('custom')).toBe('Open with custom command')
  })
})
