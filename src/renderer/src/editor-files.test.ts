import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type {
  EditorFileRef,
  EditorReadResult,
  EditorWrite,
  EditorWriteResult
} from '../../core/editor-files-types'
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

describe('saving, closing and changes on disk (#83 D12, D13)', () => {
  const sha = (c: string): string => c.repeat(64)
  const textRead = (body: string, s: string, mtimeMs = 1): EditorReadResult => ({
    kind: 'text',
    text: body,
    eol: 'crlf',
    bom: false,
    base: { size: body.length, mtimeMs, sha256: sha(s) },
    realPath: '/real/a.ts'
  })
  /** A store over one file whose disk state the test sets; writes are recorded. */
  const setup = (): {
    files: ReturnType<typeof createEditorFiles>
    disk: { read: EditorReadResult; writeResult: EditorWriteResult | null }
    writes: EditorWrite[]
    type: (text: string) => void
  } => {
    const disk = {
      read: textRead('a\n', 'a') as EditorReadResult,
      writeResult: null as EditorWriteResult | null
    }
    const writes: EditorWrite[] = []
    const files = createEditorFiles(async () => disk.read, {
      stat: async () =>
        disk.read.kind === 'text'
          ? { kind: 'file', size: disk.read.base.size, mtimeMs: disk.read.base.mtimeMs }
          : { kind: 'missing' },
      write: async (_ref, write) => {
        writes.push(write)
        const result = disk.writeResult ?? {
          ok: true as const,
          base: { size: write.text.length, mtimeMs: 9, sha256: sha('s') }
        }
        if (result.ok) disk.read = { ...textRead(write.text, 's', 9) }
        return result
      }
    })
    const type = (text: string): void => {
      const doc = files.doc('w', '/real/a.ts')!
      const state =
        doc.state ?? EditorState.create({ doc: doc.read.kind === 'text' ? doc.read.text : '' })
      files.edited(
        'w',
        '/real/a.ts',
        state.update({ changes: { from: 0, to: state.doc.length, insert: text } }).state
      )
    }
    return { files, disk, writes, type }
  }

  it('is dirty while the text differs from what it read, and clean once saved', async () => {
    const { files, writes, type } = setup()
    await files.open('w', ref('a.ts'))
    type('ax\n')
    expect(files.status('w', '/real/a.ts').dirty).toBe(true)
    expect(files.dirtyCount('w')).toBe(1)
    type('a\n')
    expect(files.status('w', '/real/a.ts').dirty).toBe(false)
    type('ax\n')
    expect(await files.save('w', '/real/a.ts')).toBe(true)
    expect(writes).toEqual([
      { text: 'ax\n', eol: 'crlf', bom: false, base: { size: 2, mtimeMs: 1, sha256: sha('a') } }
    ])
    expect(files.status('w', '/real/a.ts')).toEqual({ dirty: false, notice: null, saveError: null })
  })

  it('a save after an outside write writes nothing and shows the bar', async () => {
    const { files, disk, writes, type } = setup()
    await files.open('w', ref('a.ts'))
    type('mine\n')
    disk.read = textRead('changed\n', 'c', 2)
    expect(await files.save('w', '/real/a.ts')).toBe(false)
    expect(writes).toEqual([])
    expect(files.status('w', '/real/a.ts').notice).toBe('changed')
    // Keep mine: the disk version is the base, and the next save writes over it.
    await files.keepMine('w', '/real/a.ts')
    expect(files.status('w', '/real/a.ts')).toMatchObject({ dirty: true, notice: null })
    expect(await files.save('w', '/real/a.ts')).toBe(true)
    expect(writes.map((w) => [w.text, w.base.sha256])).toEqual([['mine\n', sha('c')]])
  })

  it('a check reloads a clean tab and shows a dirty one the bar; Reload drops the edits', async () => {
    const { files, disk, type } = setup()
    await files.open('w', ref('a.ts'))
    type('a\n')
    disk.read = textRead('changed\n', 'c', 2)
    await files.check()
    expect(files.doc('w', '/real/a.ts')!.state!.doc.toString()).toBe('changed\n')
    expect(files.status('w', '/real/a.ts')).toEqual({ dirty: false, notice: null, saveError: null })

    type('mine\n')
    disk.read = textRead('again\n', 'd', 3)
    await files.check()
    expect(files.status('w', '/real/a.ts')).toMatchObject({ dirty: true, notice: 'changed' })
    expect(files.doc('w', '/real/a.ts')!.state!.doc.toString()).toBe('mine\n')
    await files.reload('w', '/real/a.ts')
    expect(files.doc('w', '/real/a.ts')!.state!.doc.toString()).toBe('again\n')
    expect(files.status('w', '/real/a.ts')).toEqual({ dirty: false, notice: null, saveError: null })

    disk.read = { kind: 'missing' }
    await files.check()
    expect(files.status('w', '/real/a.ts').notice).toBe('deleted')
  })

  it('a failed save keeps the tab dirty with the reason', async () => {
    const { files, disk, type } = setup()
    await files.open('w', ref('a.ts'))
    type('x\n')
    disk.writeResult = { ok: false, reason: 'failed', message: 'permission denied' }
    expect(await files.save('w', '/real/a.ts')).toBe(false)
    expect(files.status('w', '/real/a.ts')).toEqual({
      dirty: true,
      notice: null,
      saveError: 'permission denied'
    })
  })

  it('closing asks for each dirty tab in turn, stopping at Cancel', async () => {
    const files = createEditorFiles(async (r) => text(`/real/${r.path}`), {
      stat: async () => ({ kind: 'file', size: 2, mtimeMs: 1 }),
      write: async () => ({ ok: true, base })
    })
    for (const p of ['a', 'b', 'c']) await files.open('w', ref(p))
    const dirty = (id: string): void => {
      const state = EditorState.create({ doc: 'a\n' })
      files.edited('w', id, state.update({ changes: { from: 0, insert: 'x' } }).state)
    }
    dirty('/real/a')
    dirty('/real/c')
    files.askClose('w', ['/real/a', '/real/b', '/real/c'])
    expect(files.closeQuestion()).toMatchObject({ id: '/real/a', name: 'a' })
    await files.answerClose('discard')
    // b was clean: closed at once; c asks.
    expect(workspaceTabs(files.get(), 'w').tabs.map((t) => t.id)).toEqual(['/real/c'])
    expect(files.closeQuestion()).toMatchObject({ id: '/real/c' })
    await files.answerClose('cancel')
    expect(files.closeQuestion()).toBeNull()
    expect(workspaceTabs(files.get(), 'w').tabs.map((t) => t.id)).toEqual(['/real/c'])
    files.askClose('w', ['/real/c'])
    await files.answerClose('save')
    expect(workspaceTabs(files.get(), 'w').tabs).toEqual([])
  })
})

describe('Markdown Preview / Edit and the text it renders (#83 D10)', () => {
  const md = (realPath: string, body = '# a\n'): EditorReadResult => text(realPath, body)

  it('a Markdown tab opens in Preview, kept per tab while it is open; others have no mode', async () => {
    const files = createEditorFiles(async (r) => md(`/real/${r.path}`))
    await files.open('w', ref('README.md'))
    await files.open('w', ref('x.MARKDOWN'))
    await files.open('w', ref('a.ts'))
    expect(files.mode('w', '/real/README.md')).toBe('preview')
    expect(files.mode('w', '/real/x.MARKDOWN')).toBe('preview')
    expect(files.mode('w', '/real/a.ts')).toBeNull()
    const changed = vi.fn()
    files.subscribe(changed)
    files.setMode('w', '/real/README.md', 'edit')
    expect(changed).toHaveBeenCalledTimes(1)
    files.setMode('w', '/real/README.md', 'edit')
    files.setMode('w', '/real/a.ts', 'edit')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(files.mode('w', '/real/README.md')).toBe('edit')
    expect(files.mode('w', '/real/x.MARKDOWN')).toBe('preview')
    // Opened again while open, it keeps its mode; closed and opened, Preview again.
    await files.open('w', ref('README.md'))
    expect(files.mode('w', '/real/README.md')).toBe('edit')
    files.close('w', '/real/README.md')
    expect(files.mode('w', '/real/README.md')).toBeNull()
    await files.open('w', ref('README.md'))
    expect(files.mode('w', '/real/README.md')).toBe('preview')
  })

  it('gives the tab’s current text, dirty or not, and tells when a reload changes it', async () => {
    let body = '# a\n'
    const read = (r: EditorFileRef): EditorReadResult => ({
      kind: 'text',
      text: body,
      eol: 'lf',
      bom: false,
      base: { size: body.length, mtimeMs: body.length, sha256: body },
      realPath: `/real/${r.path}`
    })
    const files = createEditorFiles(async (r) => read(r), {
      stat: async () => ({ kind: 'file', size: body.length, mtimeMs: body.length }),
      write: async () => ({ ok: false, reason: 'refused' })
    })
    await files.open('w', ref('README.md'))
    expect(files.text('w', '/real/README.md')).toBe('# a\n')
    expect(files.text('w', '/nope')).toBeNull()
    // A silent reload of a tab never shown in the editor: the preview hears of it.
    const changed = vi.fn()
    files.subscribe(changed)
    body = '# changed\n'
    await files.check()
    expect(files.text('w', '/real/README.md')).toBe('# changed\n')
    expect(changed).toHaveBeenCalled()
    const state = EditorState.create({ doc: '# changed\n' })
    files.edited('w', '/real/README.md', state.update({ changes: { from: 0, insert: 'x' } }).state)
    expect(files.text('w', '/real/README.md')).toBe('x# changed\n')
  })
})
