import { describe, expect, it } from 'vitest'
import { changesView, limitChanges, viewOptions } from './agent-changes'
import type { AgentSummary, FileChange } from './agent-summary'

const T0 = Date.parse('2026-10-29T14:32:00.000Z')

/** AC10's session: prompt 1 writes a.ts and edits b.ts, prompt 2 renames b to c and edits x.md. */
const SUMMARY: AgentSummary = {
  model: null,
  todos: [],
  commands: [],
  prompts: [
    { number: 1, text: 'Add the panel', startedAt: T0 },
    { number: 2, text: 'Rename b', startedAt: T0 + 1000 }
  ],
  changes: [
    { prompt: 1, kind: 'new', path: '/repo/src/a.ts', added: 10, removed: 0 },
    { prompt: 1, kind: 'edit', path: '/repo/src/b.ts', added: 2, removed: 1 },
    { prompt: 2, kind: 'rename', path: 'src/b.ts', to: 'src/c.ts', added: 0, removed: 0 },
    { prompt: 2, kind: 'edit', path: '/repo/docs/x.md', added: 1, removed: 0 }
  ]
}

const shown = (view: ReturnType<typeof changesView>): string[][] =>
  view.groups.flatMap((g) =>
    g.files.map((f) => [g.folder, f.name, f.badge, f.sized ? `+${f.added} −${f.removed}` : ''])
  )

describe("What changed's views (#75 D9, AC10, AC11)", () => {
  it('shows the last prompt: grouped by folder, a rename without a size', () => {
    const view = changesView(SUMMARY, '/repo', { kind: 'last' })
    expect(shown(view)).toEqual([
      ['docs', 'x.md', 'Edited', '+1 −0'],
      ['src', 'b.ts → c.ts', 'Renamed', '']
    ])
    expect(view.heading).toBe('2 files · +1 −0')
    expect(view.empty).toBeNull()
    expect(view.groups[0].files[0].open).toBe('docs/x.md')
    expect(view.groups[1].files[0].open).toBe('src/c.ts')
  })

  it('merges the whole session: New, an edit then a rename Renamed', () => {
    const view = changesView(SUMMARY, '/repo', { kind: 'session' })
    expect(shown(view)).toEqual([
      ['docs', 'x.md', 'Edited', '+1 −0'],
      ['src', 'a.ts', 'New', '+10 −0'],
      ['src', 'b.ts → c.ts', 'Renamed', '']
    ])
    expect(view.heading).toBe('3 files · +11 −0')
  })

  it('shows one earlier prompt', () => {
    const view = changesView(SUMMARY, '/repo', { kind: 'prompt', number: 1 })
    expect(shown(view)).toEqual([
      ['src', 'a.ts', 'New', '+10 −0'],
      ['src', 'b.ts', 'Edited', '+2 −1']
    ])
    expect(view.largest).toBe(10)
  })

  it('merges New then Edited to New, New then Deleted out, Edited then Deleted to Deleted', () => {
    const changes: FileChange[] = [
      { prompt: 1, kind: 'new', path: '/r/a', added: 3, removed: 0 },
      { prompt: 1, kind: 'edit', path: '/r/a', added: 1, removed: 1 },
      { prompt: 1, kind: 'new', path: '/r/gone', added: 3, removed: 0 },
      { prompt: 1, kind: 'delete', path: '/r/gone', added: 0, removed: 0 },
      { prompt: 1, kind: 'edit', path: '/r/b', added: 1, removed: 0 },
      { prompt: 1, kind: 'delete', path: '/r/b', added: 0, removed: 0 },
      { prompt: 1, kind: 'new', path: '/r/n', added: 1, removed: 0 },
      { prompt: 1, kind: 'rename', path: '/r/n', to: '/r/m', added: 0, removed: 0 }
    ]
    const view = changesView({ ...SUMMARY, changes }, '/r', { kind: 'session' })
    expect(shown(view)).toEqual([
      ['./', 'a', 'New', '+4 −1'],
      ['./', 'b', 'Deleted', ''],
      ['./', 'm', 'New', '+1 −0']
    ])
    expect(view.groups[0].files[1].open).toBeNull()
  })

  it('puts files outside the folder under their absolute folder, last, and never opens them', () => {
    const changes: FileChange[] = [
      { prompt: 1, kind: 'edit', path: '/etc/hosts', added: 1, removed: 0 },
      { prompt: 1, kind: 'edit', path: '/r/z.ts', added: 1, removed: 0 },
      { prompt: 1, kind: 'edit', path: '/r/lib/a.ts', added: 1, removed: 0 }
    ]
    const view = changesView({ ...SUMMARY, changes }, '/r', { kind: 'session' })
    expect(view.groups.map((g) => g.folder)).toEqual(['./', 'lib', '/etc'])
    expect(view.groups[2].files[0].open).toBeNull()
  })

  it('reads empty for a prompt or session without changes', () => {
    const none = { ...SUMMARY, changes: undefined }
    expect(changesView(none, '/r', { kind: 'last' }).empty).toBe('No file changes in this prompt.')
    expect(changesView(none, '/r', { kind: 'session' }).empty).toBe(
      'No file changes in this session.'
    )
  })
})

describe("What changed's select (#75 D9)", () => {
  it('offers Last prompt, Whole session, then earlier prompts newest first by 50 characters', () => {
    const prompts = [
      { number: 1, text: 'Add the panel', startedAt: null },
      { number: 2, text: `${'a'.repeat(60)}\nmore`, startedAt: null },
      { number: 3, text: 'Last', startedAt: null }
    ]
    expect(viewOptions({ ...SUMMARY, prompts })).toEqual([
      { value: 'last', label: 'Last prompt' },
      { value: 'session', label: 'Whole session' },
      { value: '2', label: `#2 ${'a'.repeat(50)}` },
      { value: '1', label: '#1 Add the panel' }
    ])
  })
})

describe("What changed's cut (#77 C1)", () => {
  const session = changesView(SUMMARY, '/repo', { kind: 'session' })

  it('keeps the first files in order, drops emptied folders and counts the rest', () => {
    const cut = limitChanges(session, 2)
    expect(cut.groups.flatMap((g) => g.files.map((f) => `${g.folder}${f.name}`))).toEqual(
      session.groups.flatMap((g) => g.files.map((f) => `${g.folder}${f.name}`)).slice(0, 2)
    )
    expect(cut.groups.every((g) => g.files.length > 0)).toBe(true)
    expect(cut.more).toBe(session.count - 2)
  })

  it('cuts nothing at exactly the limit', () => {
    expect(limitChanges(session, session.count).more).toBe(0)
    expect(limitChanges(session, session.count).groups).toEqual(session.groups)
  })

  it('leaves a view within the limit as it is', () => {
    const cut = limitChanges(session, 10)
    expect(cut.groups).toEqual(session.groups)
    expect(cut.more).toBe(0)
  })
})
