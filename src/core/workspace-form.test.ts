import { describe, expect, it } from 'vitest'
import {
  applyDirectory,
  applyHost,
  applyLocation,
  applyName,
  emptyDraft,
  validateDraft,
  type WorkspaceDraft
} from './workspace-form'

const dirs = new Set(['/tmp/alpha', '/tmp/beta'])
const isDirectory = async (p: string): Promise<boolean> => dirs.has(p)

describe('draft editing', () => {
  it('defaults name to the folder basename while untouched', () => {
    const d = applyDirectory(emptyDraft(), '/tmp/alpha')
    expect(d.name).toBe('alpha')
    expect(applyDirectory(d, '/tmp/beta').name).toBe('beta')
  })

  it('stops defaulting once the user typed a name', () => {
    const d = applyDirectory(applyName(emptyDraft(), 'Mine'), '/tmp/alpha')
    expect(d.name).toBe('Mine')
  })

  it('resumes defaulting when the user clears the name', () => {
    const d = applyDirectory(applyName(applyName(emptyDraft(), 'Mine'), ''), '/tmp/alpha')
    expect(d.name).toBe('alpha')
  })

  it('does not default for an edit draft that starts touched', () => {
    const start: WorkspaceDraft = { name: 'gamma', directory: '/tmp/alpha', nameTouched: true }
    expect(applyDirectory(start, '/tmp/beta').name).toBe('gamma')
  })
})

describe('validateDraft', () => {
  const base = { existingNames: ['alpha'], isDirectory }

  it('accepts a valid draft and trims', async () => {
    const r = await validateDraft({ name: ' gamma ', directory: ' /tmp/beta ' }, base)
    expect(r).toEqual({ ok: true, value: { name: 'gamma', directory: '/tmp/beta' } })
  })

  it('rejects a duplicate name differing by case', async () => {
    const r = await validateDraft({ name: 'Alpha', directory: '/tmp/beta' }, base)
    expect(r).toMatchObject({ ok: false, errors: { name: expect.any(String) } })
  })

  it('rejects empty and whitespace names', async () => {
    for (const name of ['', '   ']) {
      const r = await validateDraft({ name, directory: '/tmp/beta' }, base)
      expect(r).toMatchObject({ ok: false, errors: { name: expect.any(String) } })
    }
  })

  it('rejects empty, missing or non-directory paths', async () => {
    for (const directory of ['', '  ', '/nope', '/tmp/file.txt']) {
      const r = await validateDraft({ name: 'x', directory }, base)
      expect(r).toMatchObject({ ok: false, errors: { directory: expect.any(String) } })
    }
  })

  it('reports both errors together and skips the fs check for an empty path', async () => {
    let calls = 0
    const r = await validateDraft(
      { name: '', directory: '' },
      {
        existingNames: [],
        isDirectory: async () => {
          calls++
          return true
        }
      }
    )
    expect(r).toMatchObject({
      ok: false,
      errors: { name: expect.any(String), directory: expect.any(String) }
    })
    expect(calls).toBe(0)
  })

  it('treats a throwing isDirectory as invalid', async () => {
    const r = await validateDraft(
      { name: 'x', directory: '/tmp/alpha' },
      {
        existingNames: [],
        isDirectory: async () => {
          throw new Error('boom')
        }
      }
    )
    expect(r).toMatchObject({ ok: false, errors: { directory: expect.any(String) } })
  })
})

describe('SSH drafts (#12 D4)', () => {
  const ssh = (draft: WorkspaceDraft): WorkspaceDraft => applyLocation(draft, 'ssh')

  it('starts on This computer', () => {
    expect(emptyDraft()).toMatchObject({ location: 'local', host: '' })
  })

  it('defaults the name to the host while the directory is ~, else the last segment', () => {
    let d = applyHost(ssh(emptyDraft()), 'me@devbox')
    d = applyDirectory(d, '~')
    expect(d.name).toBe('me@devbox')
    expect(applyHost(d, 'other').name).toBe('other')
    d = applyDirectory(d, '/tmp/bikube-remote')
    expect(d.name).toBe('bikube-remote')
    expect(applyHost(d, 'third').name).toBe('bikube-remote')
  })

  it('keeps a typed name when the host changes', () => {
    const d = applyDirectory(applyName(ssh(emptyDraft()), 'Mine'), '~')
    expect(applyHost(d, 'devbox').name).toBe('Mine')
  })

  it('validates an SSH draft by the host and remote rules, never checking the path locally', async () => {
    let calls = 0
    const ctx = {
      existingNames: [],
      isDirectory: async (): Promise<boolean> => {
        calls++
        return false
      }
    }
    expect(
      await validateDraft(
        { name: 'r', directory: ' /nope/remote ', location: 'ssh', host: ' me@devbox ' },
        ctx
      )
    ).toEqual({ ok: true, value: { name: 'r', directory: '/nope/remote', host: 'me@devbox' } })
    expect(
      await validateDraft(
        { name: 'r', directory: 'relative/dir', location: 'ssh', host: '-oProxyCommand=x' },
        ctx
      )
    ).toEqual({
      ok: false,
      errors: {
        host: 'Enter a host as ssh takes it, e.g. me@devbox',
        directory: 'Enter an absolute path or one starting with ~'
      }
    })
    expect(
      await validateDraft({ name: 'r', directory: '~', location: 'ssh', host: '' }, ctx)
    ).toEqual({ ok: false, errors: { host: 'Host is required' } })
    expect(calls).toBe(0)
  })

  it('ignores the host of a local draft', async () => {
    const r = await validateDraft(
      { name: 'b', directory: '/tmp/beta', location: 'local', host: '-x' },
      { existingNames: [], isDirectory }
    )
    expect(r).toEqual({ ok: true, value: { name: 'b', directory: '/tmp/beta' } })
  })
})
