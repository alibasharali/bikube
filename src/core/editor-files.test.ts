import { createHash } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ListedPaths } from './agent-setup-open'
import { readEditorFile, statEditorFile, writeEditorFile, type EditorFs } from './editor-files'
import { formatSize, type EditorFileRef, type EditorReadResult } from './editor-files-types'

// The file editor's reads, stats and writes (#83 D6, D7, D12, D13) on real temporary folders.

let dir: string
let root: string
let listed: ListedPaths

const put = (path: string, data: string | Buffer = ''): string => {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  return file
}

const ref = (path: string): EditorFileRef => ({ kind: 'folder', folder: root, path })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bikube-editor-'))
  root = join(dir, 'repo')
  mkdirSync(root)
  listed = new ListedPaths()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

describe('readEditorFile', () => {
  it('reads a UTF-8 file as text with its base and real path', async () => {
    const file = put('src/a.ts', 'const a = 1\nconst b = 2\n')
    const read = await readEditorFile(ref('src/a.ts'), { listed })
    expect(read).toEqual({
      kind: 'text',
      text: 'const a = 1\nconst b = 2\n',
      eol: 'lf',
      bom: false,
      base: {
        size: 24,
        mtimeMs: statSync(file).mtimeMs,
        sha256: sha('const a = 1\nconst b = 2\n')
      },
      realPath: file
    })
  })

  it('takes off a BOM and CRLF line endings, noting both', async () => {
    put('win.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')]))
    const read = await readEditorFile(ref('win.txt'), { listed })
    expect(read).toMatchObject({ kind: 'text', text: 'one\ntwo\n', eol: 'crlf', bom: true })
  })

  it('reads LF when the first line break is LF, and a file with no line break as LF', async () => {
    put('mixed.txt', 'one\ntwo\r\n')
    put('one.txt', 'one')
    expect(await readEditorFile(ref('mixed.txt'), { listed })).toMatchObject({ eol: 'lf' })
    expect(await readEditorFile(ref('one.txt'), { listed })).toMatchObject({ eol: 'lf' })
  })

  it('shows a picture as a data: URL by its extension', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2])
    const file = put('pic.png', png)
    put('logo.SVG', '<svg/>')
    expect(await readEditorFile(ref('pic.png'), { listed })).toEqual({
      kind: 'image',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      base: { size: 7, mtimeMs: statSync(file).mtimeMs, sha256: sha(png) },
      realPath: file
    })
    expect(await readEditorFile(ref('logo.SVG'), { listed })).toMatchObject({
      dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
    })
  })

  it('reads a file with a NUL byte or invalid UTF-8 as binary', async () => {
    const nul = put('a.bin', Buffer.from('ab\0cd'))
    const bad = put('latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9]))
    expect(await readEditorFile(ref('a.bin'), { listed })).toEqual({
      kind: 'binary',
      realPath: nul
    })
    expect(await readEditorFile(ref('latin.txt'), { listed })).toEqual({
      kind: 'binary',
      realPath: bad
    })
  })

  it('reads a file over 5 MB as too large, and a picture over 20 MB', async () => {
    const big = put('big.log', Buffer.alloc(6 * 1024 * 1024, 0x61))
    const fit = put('fit.log', Buffer.alloc(5 * 1024 * 1024, 0x61))
    const huge = put('huge.png', Buffer.alloc(20 * 1024 * 1024 + 1))
    expect(await readEditorFile(ref('big.log'), { listed })).toEqual({
      kind: 'too-large',
      size: 6 * 1024 * 1024,
      realPath: big
    })
    expect(formatSize(6 * 1024 * 1024)).toBe('6.0 MB')
    expect(await readEditorFile(ref('fit.log'), { listed })).toMatchObject({
      kind: 'text',
      realPath: fit
    })
    expect(await readEditorFile(ref('huge.png'), { listed })).toMatchObject({
      kind: 'too-large',
      realPath: huge
    })
  })

  it('reads a missing file as missing', async () => {
    expect(await readEditorFile(ref('gone.txt'), { listed })).toEqual({ kind: 'missing' })
  })

  it('reads a symlink inside the folder through to its target inside', async () => {
    const target = put('real.txt', 'hi\n')
    symlinkSync('real.txt', join(root, 'link.txt'))
    expect(await readEditorFile(ref('link.txt'), { listed })).toMatchObject({
      kind: 'text',
      text: 'hi\n',
      realPath: target
    })
  })

  it('refuses ../, a symlink out of the folder, a folder and the folder itself', async () => {
    writeFileSync(join(dir, 'outside.txt'), 'secret')
    symlinkSync(join(dir, 'outside.txt'), join(root, 'out.txt'))
    put('sub/a.txt', 'a')
    for (const path of ['../outside.txt', 'out.txt', 'sub', '', '.', 'sub/../../outside.txt']) {
      expect(await readEditorFile(ref(path), { listed }), path).toEqual({ kind: 'refused' })
      expect(await statEditorFile(ref(path), { listed }), path).toEqual({ kind: 'refused' })
    }
  })

  it('refuses a malformed reference', async () => {
    put('a.txt', 'a')
    for (const bad of [
      null,
      'a.txt',
      { kind: 'folder', folder: 'repo', path: 'a.txt' },
      { kind: 'folder', folder: root, path: join(root, 'a.txt') },
      { kind: 'folder', folder: root, path: 'a\0.txt' },
      { kind: 'other', folder: root, path: 'a.txt' },
      { kind: 'listed', folder: root, path: 'a.txt' }
    ]) {
      expect(await readEditorFile(bad, { listed })).toEqual({ kind: 'refused' })
    }
  })

  it("reads a listed file only while the folder's last Agent setup read listed it", async () => {
    const home = join(dir, 'home')
    mkdirSync(join(home, '.claude'), { recursive: true })
    const settings = join(home, '.claude', 'settings.json')
    writeFileSync(settings, '{}\n')
    const listedRef: EditorFileRef = { kind: 'listed', folder: root, path: settings }
    expect(await readEditorFile(listedRef, { listed })).toEqual({ kind: 'refused' })
    listed.set(root, [settings])
    expect(await readEditorFile(listedRef, { listed })).toMatchObject({
      kind: 'text',
      text: '{}\n'
    })
    expect(
      await readEditorFile(
        { kind: 'listed', folder: join(dir, 'other'), path: settings },
        { listed }
      )
    ).toEqual({ kind: 'refused' })
    rmSync(settings)
    expect(await readEditorFile(listedRef, { listed })).toEqual({ kind: 'missing' })
  })

  it("reads a folder's setup first when it has no listing yet (a draft after a restart)", async () => {
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, '{}\n')
    const loads: string[] = []
    const loadListing = async (folder: string): Promise<void> => {
      loads.push(folder)
      listed.set(folder, [settings])
    }
    const listedRef: EditorFileRef = { kind: 'listed', folder: `${root}/`, path: settings }
    expect(await readEditorFile(listedRef, { listed, loadListing })).toMatchObject({
      kind: 'text'
    })
    expect(await statEditorFile(listedRef, { listed, loadListing })).toMatchObject({
      kind: 'file'
    })
    // Read once: the folder's listing then stands until its next read, even when it lists nothing.
    expect(loads).toEqual([root])
    listed.set(root, [])
    expect(await readEditorFile(listedRef, { listed, loadListing })).toEqual({ kind: 'refused' })
    expect(loads).toEqual([root])
  })

  it('refuses a listed file whose first read failed, and loads nothing for a malformed one', async () => {
    const settings = join(dir, 'settings.json')
    writeFileSync(settings, '{}\n')
    const loads: string[] = []
    const failing = async (folder: string): Promise<void> => {
      loads.push(folder)
      throw new Error('not a directory')
    }
    expect(
      await readEditorFile(
        { kind: 'listed', folder: root, path: settings },
        { listed, loadListing: failing }
      )
    ).toEqual({ kind: 'refused' })
    expect(
      await readEditorFile(
        { kind: 'listed', folder: root, path: `${root}/../settings.json` },
        { listed, loadListing: failing }
      )
    ).toEqual({ kind: 'refused' })
    expect(loads).toEqual([root])
  })
})

describe('statEditorFile', () => {
  it('gives the size and mtime, and missing once the file is gone', async () => {
    const file = put('a.txt', 'abc')
    expect(await statEditorFile(ref('a.txt'), { listed })).toEqual({
      kind: 'file',
      size: 3,
      mtimeMs: statSync(file).mtimeMs
    })
    rmSync(file)
    expect(await statEditorFile(ref('a.txt'), { listed })).toEqual({ kind: 'missing' })
  })
})

describe('writeEditorFile', () => {
  const readText = async (path: string): Promise<Extract<EditorReadResult, { kind: 'text' }>> => {
    const read = await readEditorFile(ref(path), { listed })
    if (read.kind !== 'text') throw new Error(`not text: ${read.kind}`)
    return read
  }

  it('writes the text back with its CRLF line endings and BOM, and gives the new base', async () => {
    const file = put(
      'win.txt',
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\n')])
    )
    const read = await readText('win.txt')
    const result = await writeEditorFile(
      ref('win.txt'),
      { text: 'one\ntwo\n', eol: read.eol, bom: read.bom, base: read.base },
      { listed }
    )
    const bytes = readFileSync(file)
    expect(bytes).toEqual(
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo\r\n')])
    )
    expect(result).toEqual({
      ok: true,
      base: { size: bytes.length, mtimeMs: statSync(file).mtimeMs, sha256: sha(bytes) }
    })
  })

  it('writes LF without a BOM as it read them', async () => {
    const file = put('a.txt', 'a\n')
    const read = await readText('a.txt')
    await writeEditorFile(
      ref('a.txt'),
      { text: 'b\n', eol: 'lf', bom: false, base: read.base },
      { listed }
    )
    expect(readFileSync(file, 'utf8')).toBe('b\n')
  })

  it('keeps the mode and leaves no .tmp behind', async () => {
    const file = put('run.sh', 'echo a\n')
    chmodSync(file, 0o750)
    const read = await readText('run.sh')
    await writeEditorFile(
      ref('run.sh'),
      { text: 'echo b\n', eol: 'lf', bom: false, base: read.base },
      { listed }
    )
    expect(statSync(file).mode & 0o777).toBe(0o750)
    expect(readdirSync(root)).toEqual(['run.sh'])
  })

  it.skipIf(process.getuid?.() === 0)(
    "writes nothing to a file the user can't write, and says why",
    async () => {
      const file = put('locked.txt', 'a\n')
      chmodSync(file, 0o444)
      const read = await readText('locked.txt')
      const result = await writeEditorFile(
        ref('locked.txt'),
        { text: 'b\n', eol: 'lf', bom: false, base: read.base },
        { listed }
      )
      expect(result).toEqual({ ok: false, reason: 'failed', message: 'permission denied' })
      expect(readFileSync(file, 'utf8')).toBe('a\n')
      expect(statSync(file).mode & 0o777).toBe(0o444)
      expect(readdirSync(root)).toEqual(['locked.txt'])
    }
  )

  it('checks write access on the real file before anything else', async () => {
    const file = put('locked.txt', 'a\n')
    const read = await readText('locked.txt')
    const real = await import('node:fs/promises')
    const asked: string[] = []
    const fs: EditorFs = {
      ...real,
      access: async (path) => {
        asked.push(path)
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
    }
    const result = await writeEditorFile(
      ref('locked.txt'),
      { text: 'b\n', eol: 'lf', bom: false, base: read.base },
      { listed, fs }
    )
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'permission denied' })
    expect(asked).toEqual([file])
    expect(readFileSync(file, 'utf8')).toBe('a\n')
  })

  it('writes nothing when the file no longer matches the base', async () => {
    const file = put('a.txt', 'one\n')
    const read = await readText('a.txt')
    writeFileSync(file, 'two\n')
    const result = await writeEditorFile(
      ref('a.txt'),
      { text: 'mine\n', eol: 'lf', bom: false, base: read.base },
      { listed }
    )
    expect(result).toEqual({ ok: false, reason: 'conflict' })
    expect(readFileSync(file, 'utf8')).toBe('two\n')
  })

  it('writes nothing when only the hash differs from the base', async () => {
    const file = put('a.txt', 'one\n')
    const read = await readText('a.txt')
    const base = { ...read.base, sha256: sha('other') }
    expect(
      await writeEditorFile(ref('a.txt'), { text: 'x\n', eol: 'lf', bom: false, base }, { listed })
    ).toEqual({ ok: false, reason: 'conflict' })
    expect(readFileSync(file, 'utf8')).toBe('one\n')
  })

  it('writes through a symlink inside to its target, keeping the link', async () => {
    const target = put('real.txt', 'a\n')
    symlinkSync('real.txt', join(root, 'link.txt'))
    const read = await readText('link.txt')
    const result = await writeEditorFile(
      ref('link.txt'),
      { text: 'b\n', eol: 'lf', bom: false, base: read.base },
      { listed }
    )
    expect(result.ok).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('b\n')
    expect(lstatSync(join(root, 'link.txt')).isSymbolicLink()).toBe(true)
  })

  it('refuses ../, a symlink out of the folder and a folder, writing nothing', async () => {
    const outside = join(dir, 'outside.txt')
    writeFileSync(outside, 'secret')
    symlinkSync(outside, join(root, 'out.txt'))
    mkdirSync(join(root, 'sub'))
    const base = { size: 6, mtimeMs: statSync(outside).mtimeMs, sha256: sha('secret') }
    for (const path of ['../outside.txt', 'out.txt', 'sub']) {
      expect(
        await writeEditorFile(ref(path), { text: 'x', eol: 'lf', bom: false, base }, { listed }),
        path
      ).toEqual({ ok: false, reason: 'refused' })
    }
    expect(readFileSync(outside, 'utf8')).toBe('secret')
    expect(readdirSync(root).sort()).toEqual(['out.txt', 'sub'])
  })

  it('refuses a malformed save and gives missing for a file that is gone', async () => {
    const file = put('a.txt', 'a')
    const read = await readText('a.txt')
    for (const bad of [
      null,
      { text: 1, eol: 'lf', bom: false, base: read.base },
      { text: 'x', eol: 'cr', bom: false, base: read.base },
      { text: 'x', eol: 'lf', bom: false, base: { ...read.base, sha256: 'nope' } },
      { text: 'x'.repeat(5 * 1024 * 1024 + 1), eol: 'lf', bom: false, base: read.base }
    ]) {
      expect(await writeEditorFile(ref('a.txt'), bad, { listed })).toEqual({
        ok: false,
        reason: 'refused'
      })
    }
    rmSync(file)
    expect(
      await writeEditorFile(
        ref('a.txt'),
        { text: 'x', eol: 'lf', bom: false, base: read.base },
        { listed }
      )
    ).toEqual({ ok: false, reason: 'missing' })
  })

  it('recreates a deleted file only when asked and its folder still exists (D11)', async () => {
    const file = put('src/a.ts', 'a\n')
    const read = await readText('src/a.ts')
    rmSync(file)
    const write = { text: 'mine\n', eol: 'crlf' as const, bom: false, base: read.base }
    expect(await writeEditorFile(ref('src/a.ts'), write, { listed })).toEqual({
      ok: false,
      reason: 'missing'
    })
    const result = await writeEditorFile(ref('src/a.ts'), { ...write, recreate: true }, { listed })
    expect(readFileSync(file, 'utf8')).toBe('mine\r\n')
    expect(result).toEqual({
      ok: true,
      base: { size: 6, mtimeMs: statSync(file).mtimeMs, sha256: sha('mine\r\n') }
    })
    // No .tmp is left.
    expect(readdirSync(join(root, 'src'))).toEqual(['a.ts'])
    // A file that came back is checked against the base as ever.
    expect(
      await writeEditorFile(ref('src/a.ts'), { ...write, recreate: true }, { listed })
    ).toEqual({ ok: false, reason: 'conflict' })
    // Its folder gone: nothing is written.
    rmSync(join(root, 'src'), { recursive: true })
    expect(
      await writeEditorFile(ref('src/a.ts'), { ...write, recreate: true }, { listed })
    ).toEqual({ ok: false, reason: 'failed', message: 'folder not found' })
    expect(readdirSync(root)).toEqual([])
  })

  it('recreates nothing outside the folder or for an unlisted file', async () => {
    const base = { size: 1, mtimeMs: 1, sha256: sha('a') }
    const write = { text: 'x', eol: 'lf' as const, bom: false, base, recreate: true as const }
    mkdirSync(join(dir, 'elsewhere'))
    symlinkSync(join(dir, 'elsewhere'), join(root, 'out'))
    for (const path of ['../new.txt', 'out/new.txt']) {
      expect(await writeEditorFile(ref(path), write, { listed }), path).toEqual({
        ok: false,
        reason: 'refused'
      })
    }
    expect(readdirSync(join(dir, 'elsewhere'))).toEqual([])
    const listedRef: EditorFileRef = { kind: 'listed', folder: root, path: join(dir, 'gone.json') }
    expect(await writeEditorFile(listedRef, write, { listed })).toEqual({
      ok: false,
      reason: 'refused'
    })
    listed.set(root, [join(dir, 'gone.json')])
    expect(await writeEditorFile(listedRef, write, { listed })).toMatchObject({ ok: true })
    expect(readFileSync(join(dir, 'gone.json'), 'utf8')).toBe('x')
  })

  it('gives a failed write its reason and removes its .tmp', async () => {
    const file = put('a.txt', 'a')
    const read = await readText('a.txt')
    const { realpath, stat, readFile, writeFile, chmod, unlink, access } =
      await import('node:fs/promises')
    const fs: EditorFs = {
      access,
      realpath,
      stat,
      readFile,
      writeFile,
      chmod,
      unlink,
      rename: async () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
    }
    const result = await writeEditorFile(
      ref('a.txt'),
      { text: 'b', eol: 'lf', bom: false, base: read.base },
      { listed, fs }
    )
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'permission denied' })
    expect(readFileSync(file, 'utf8')).toBe('a')
    expect(readdirSync(root)).toEqual(['a.txt'])
  })
})
