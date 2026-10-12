import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_PATH_LENGTH, isDirectory, isPathArg } from './directories'

describe('isPathArg', () => {
  it('accepts absolute paths', () => {
    expect(isPathArg('/home/user')).toBe(true)
  })

  it('rejects non-strings, empty and relative paths', () => {
    expect(isPathArg(undefined)).toBe(false)
    expect(isPathArg(null)).toBe(false)
    expect(isPathArg(42)).toBe(false)
    expect(isPathArg('')).toBe(false)
    expect(isPathArg('relative/dir')).toBe(false)
    expect(isPathArg('~')).toBe(false)
  })

  it('rejects NUL bytes and over-long paths', () => {
    expect(isPathArg('/tmp/a\0b')).toBe(false)
    expect(isPathArg('/' + 'a'.repeat(MAX_PATH_LENGTH))).toBe(false)
    expect(isPathArg('/' + 'a'.repeat(MAX_PATH_LENGTH - 1))).toBe(true)
  })
})

describe('isDirectory', () => {
  let dir: string
  let file: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drovr-dir-'))
    file = join(dir, 'f.txt')
    await writeFile(file, 'x')
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('is true for an existing directory', async () => {
    expect(await isDirectory(dir)).toBe(true)
  })

  it('is false for a file, a missing path and invalid arguments', async () => {
    expect(await isDirectory(file)).toBe(false)
    expect(await isDirectory(join(dir, 'missing'))).toBe(false)
    expect(await isDirectory('relative')).toBe(false)
    expect(await isDirectory(7 as unknown as string)).toBe(false)
  })

  it('is false when stat throws', async () => {
    const failing = { stat: () => Promise.reject(new Error('EACCES')) }
    expect(await isDirectory(dir, failing)).toBe(false)
  })
})
