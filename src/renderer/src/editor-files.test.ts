import { describe, expect, it, vi } from 'vitest'
import type { EditorFileRef, EditorReadResult } from '../../core/editor-files-types'
import { activeTab, workspaceTabs } from '../../core/editor-tabs'
import { createEditorFiles } from './editor-files'

const base = { size: 2, mtimeMs: 1, sha256: 'x' }
const ref = (path: string): EditorFileRef => ({ kind: 'folder', folder: '/repo', path })
const text = (realPath: string, body = 'a\n'): EditorReadResult => ({
  kind: 'text',
  text: body,
  eol: 'lf',
  bom: false,
  base,
  realPath
})

describe('the editor files store (#83 D3)', () => {
  it('opens a tab by real path and shows the editor; the same file again focuses its one tab', async () => {
    const reads = new Map<string, EditorReadResult>([
      ['a.ts', text('/real/a.ts')],
      ['link.ts', text('/real/a.ts', 'again\n')],
      ['b.md', text('/real/b.md')]
    ])
    const files = createEditorFiles(async (r) => reads.get(r.path)!)
    const shown = vi.fn()
    files.onShow(shown)
    expect(await files.open('w', ref('a.ts'))).toBe('opened')
    await files.open('w', ref('b.md'))
    await files.open('w', ref('link.ts'))
    const memory = files.get()
    expect(workspaceTabs(memory, 'w').tabs.map((t) => t.id)).toEqual(['/real/a.ts', '/real/b.md'])
    expect(activeTab(memory, 'w')?.ref).toEqual(ref('a.ts'))
    // The open tab keeps what it read (and its edits): a second open reads nothing into it.
    expect(files.doc('w', '/real/a.ts')).toEqual({ read: text('/real/a.ts'), state: null })
    expect(shown).toHaveBeenCalledTimes(3)
    expect(shown).toHaveBeenLastCalledWith('w')
  })

  it('a refused file opens nothing; a missing one opens a tab by its path', async () => {
    const files = createEditorFiles(async (r) =>
      r.path === 'gone.ts' ? { kind: 'missing' } : { kind: 'refused' }
    )
    expect(await files.open('w', ref('../x'))).toBe('refused')
    expect(workspaceTabs(files.get(), 'w').tabs).toEqual([])
    await files.open('w', ref('gone.ts'))
    expect(activeTab(files.get(), 'w')?.id).toBe('/repo/gone.ts')
  })

  it('closing tabs forgets what they held', async () => {
    const files = createEditorFiles(async (r) => text(`/real/${r.path}`))
    await files.open('w', ref('a'))
    await files.open('w', ref('b'))
    await files.open('v', ref('c'))
    files.close('w', '/real/a')
    expect(files.doc('w', '/real/a')).toBeNull()
    files.closeAll('w')
    expect(files.doc('w', '/real/b')).toBeNull()
    files.keep(['w'])
    expect(files.doc('v', '/real/c')).toBeNull()
    expect(files.get()).toEqual({})
  })

  it('a file reopened in front after it read missing shows its new read', async () => {
    let result: EditorReadResult = { kind: 'missing' }
    const files = createEditorFiles(async () => result)
    await files.open('w', ref('new.ts'))
    const changed = vi.fn()
    files.subscribe(changed)
    result = text('/repo/new.ts')
    await files.open('w', ref('new.ts'))
    expect(files.doc('w', '/repo/new.ts')?.read).toEqual(text('/repo/new.ts'))
    expect(changed).toHaveBeenCalled()
  })

  it('a tab whose real path holds a newline keeps its document', async () => {
    const files = createEditorFiles(async (r) =>
      text(r.path === 'x' ? '/real/a\nb' : '/real/other')
    )
    await files.open('w', ref('x'))
    // Another tab opened: the tab list changes, and open tabs' documents stay.
    await files.open('w', ref('y'))
    expect(files.doc('w', '/real/a\nb')).not.toBeNull()
  })
})
