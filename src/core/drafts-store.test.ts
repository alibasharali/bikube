import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DraftsStore, draftFileName, type DraftsFs } from './drafts-store'
import type { EditorDraft } from './editor-files-types'

// Dirty tabs' drafts on this machine (#83 D11) on real temporary folders.

let root: string
let dir: string
let calls: string[]
let store: DraftsStore

/** Node's fs, recording the writing calls in order. */
const recordingFs = (): DraftsFs => ({
  mkdirSync: (path, options) => fs.mkdirSync(path, options),
  chmodSync: fs.chmodSync,
  openSync: (path, flags, mode) => {
    calls.push(`open ${path}`)
    return fs.openSync(path, flags, mode)
  },
  writeFileSync: (fd, data, encoding) => fs.writeFileSync(fd, data, encoding),
  fsyncSync: fs.fsyncSync,
  closeSync: fs.closeSync,
  renameSync: (from, to) => {
    calls.push(`rename ${from} ${to}`)
    fs.renameSync(from, to)
  },
  readFileSync: (path, encoding) => fs.readFileSync(path, encoding),
  rmSync: (path, options) => fs.rmSync(path, options),
  readdirSync: (path) => fs.readdirSync(path)
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bikube-drafts-'))
  dir = join(root, 'drafts')
  calls = []
  store = new DraftsStore({ dir, fs: recordingFs(), log: () => {} })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const draft = (over: Partial<EditorDraft> = {}): EditorDraft => ({
  workspaceId: 'w1',
  ref: { kind: 'folder', folder: '/repo', path: 'src/a.ts' },
  realPath: '/repo/src/a.ts',
  text: 'draft\n',
  eol: 'crlf',
  bom: true,
  base: { size: 3, mtimeMs: 1234.5, sha256: 'a'.repeat(64) },
  ...over
})

const mode = (path: string): number => statSync(path).mode & 0o777

describe('DraftsStore (#83 D11)', () => {
  it('saves to the sha256 of workspace id and real path through a .tmp, 0700 and 0600', () => {
    expect(store.save(draft())).toBe(true)
    const name = createHash('sha256').update('w1\n/repo/src/a.ts').digest('hex')
    expect(draftFileName('w1', '/repo/src/a.ts')).toBe(name)
    const file = join(dir, name)
    expect(calls).toEqual([`open ${file}.tmp`, `rename ${file}.tmp ${file}`])
    expect(readdirSync(dir)).toEqual([name])
    expect(mode(dir)).toBe(0o700)
    expect(mode(file)).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(draft())
  })

  it('lists every draft, a second save of a tab replacing its first', () => {
    store.save(draft({ text: 'one' }))
    store.save(draft({ text: 'two' }))
    store.save(
      draft({
        workspaceId: 'w2',
        ref: { kind: 'listed', folder: '/r', path: '/h/s.json' },
        realPath: '/h/s.json'
      })
    )
    const listed = store.list()
    expect(listed).toHaveLength(2)
    expect(listed).toContainEqual(draft({ text: 'two' }))
    expect(listed.map((d) => d.workspaceId).sort()).toEqual(['w1', 'w2'])
  })

  it('refuses malformed drafts, writing nothing', () => {
    const bad: unknown[] = [
      null,
      { ...draft(), workspaceId: '' },
      { ...draft(), workspaceId: 'x'.repeat(201) },
      { ...draft(), realPath: 'relative' },
      { ...draft(), ref: { kind: 'folder', folder: '/repo', path: '/abs' } },
      { ...draft(), text: 3 },
      { ...draft(), text: 'x'.repeat(5 * 1024 * 1024 + 1) },
      { ...draft(), eol: 'cr' },
      { ...draft(), bom: 'yes' },
      { ...draft(), base: { size: 1, mtimeMs: 1, sha256: 'nope' } }
    ]
    for (const value of bad) expect(store.save(value)).toBe(false)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('deletes a tab’s draft; none is nothing', () => {
    store.save(draft())
    store.delete('w1', '/repo/src/a.ts')
    store.delete('w1', '/repo/src/a.ts')
    store.delete(3, null)
    expect(readdirSync(dir)).toEqual([])
  })

  it('lists no unreadable, malformed or misnamed file, and removes them', () => {
    store.save(draft())
    writeFileSync(join(dir, 'f'.repeat(64)), 'not json')
    writeFileSync(join(dir, 'e'.repeat(64)), JSON.stringify(draft({ workspaceId: 'other' })))
    writeFileSync(join(dir, `${'d'.repeat(64)}.tmp`), 'partial')
    expect(store.list()).toEqual([draft()])
    expect(readdirSync(dir).sort()).toEqual(
      [draftFileName('w1', '/repo/src/a.ts'), `${'d'.repeat(64)}.tmp`].sort()
    )
  })

  it('a missing folder lists nothing', () => {
    expect(store.list()).toEqual([])
    store.prune(['w1'])
  })

  it('prunes drafts of other workspaces, malformed files and .tmp files at launch', () => {
    store.save(draft())
    store.save(draft({ workspaceId: 'gone' }))
    writeFileSync(join(dir, `${'d'.repeat(64)}.tmp`), 'partial')
    writeFileSync(join(dir, 'f'.repeat(64)), 'not json')
    store.prune(['w1'])
    expect(readdirSync(dir)).toEqual([draftFileName('w1', '/repo/src/a.ts')])
  })
})
