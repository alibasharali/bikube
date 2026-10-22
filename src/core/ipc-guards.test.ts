import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MAX_WRITE_BYTES,
  SPAWN_REFUSAL,
  isCardId,
  isClipboardText,
  isAckChars,
  isCurrentMainFrame,
  isSessionId,
  isValidSize,
  isWriteData,
  workingDirectoryProblem
} from './ipc-guards'

describe('isValidSize', () => {
  it('accepts integers from 1 to 1000', () => {
    expect(isValidSize(1, 1)).toBe(true)
    expect(isValidSize(80, 24)).toBe(true)
    expect(isValidSize(1000, 1000)).toBe(true)
  })

  it('rejects out-of-range values', () => {
    expect(isValidSize(0, 24)).toBe(false)
    expect(isValidSize(80, 0)).toBe(false)
    expect(isValidSize(1001, 24)).toBe(false)
    expect(isValidSize(80, 1001)).toBe(false)
    expect(isValidSize(-1, 24)).toBe(false)
  })

  it('rejects non-integers and non-numbers', () => {
    expect(isValidSize(80.5, 24)).toBe(false)
    expect(isValidSize(NaN, 24)).toBe(false)
    expect(isValidSize(Infinity, 24)).toBe(false)
    expect(isValidSize('80', 24)).toBe(false)
    expect(isValidSize(80, null)).toBe(false)
    expect(isValidSize(undefined, undefined)).toBe(false)
  })
})

describe('isSessionId', () => {
  it('accepts non-empty strings only', () => {
    expect(isSessionId('abc')).toBe(true)
    expect(isSessionId('')).toBe(false)
    expect(isSessionId(1)).toBe(false)
    expect(isSessionId(null)).toBe(false)
    expect(isSessionId({})).toBe(false)
  })
})

describe('isAckChars (#16 D3)', () => {
  it('accepts positive safe integers', () => {
    expect(isAckChars(1)).toBe(true)
    expect(isAckChars(5_000)).toBe(true)
    expect(isAckChars(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('rejects zero, negatives, fractions, non-finite numbers and non-numbers', () => {
    for (const chars of [0, -5, 1.5, '100', NaN, Infinity, -Infinity, 2 ** 53, null, undefined]) {
      expect(isAckChars(chars)).toBe(false)
    }
  })
})

describe('isWriteData', () => {
  it('accepts strings up to the cap', () => {
    expect(isWriteData('')).toBe(true)
    expect(isWriteData('ls\r')).toBe(true)
    expect(isWriteData('a'.repeat(MAX_WRITE_BYTES))).toBe(true)
  })

  it('rejects strings over the cap', () => {
    expect(isWriteData('a'.repeat(MAX_WRITE_BYTES + 1))).toBe(false)
  })

  it('counts bytes, not characters', () => {
    expect(isWriteData('é'.repeat(MAX_WRITE_BYTES / 2))).toBe(true)
    expect(isWriteData('é'.repeat(MAX_WRITE_BYTES / 2 + 1))).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isWriteData(42)).toBe(false)
    expect(isWriteData(undefined)).toBe(false)
    expect(isWriteData(new Uint8Array(1))).toBe(false)
  })
})

describe('isClipboardText', () => {
  it('accepts strings up to the cap, including empty and multi-line', () => {
    expect(isClipboardText('')).toBe(true)
    expect(isClipboardText('a\nb')).toBe(true)
    expect(isClipboardText('x'.repeat(MAX_WRITE_BYTES))).toBe(true)
  })

  it('rejects non-strings and oversized text', () => {
    expect(isClipboardText(42)).toBe(false)
    expect(isClipboardText(null)).toBe(false)
    expect(isClipboardText('x'.repeat(MAX_WRITE_BYTES + 1))).toBe(false)
    expect(isClipboardText('€'.repeat(MAX_WRITE_BYTES / 2))).toBe(false)
  })
})

describe('workingDirectoryProblem', () => {
  let dir: string
  let file: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bikube-cwd-'))
    file = join(dir, 'file.txt')
    await writeFile(file, 'x')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('accepts an existing absolute directory', async () => {
    expect(await workingDirectoryProblem(dir)).toBeNull()
  })

  it('reports a missing directory as not found', async () => {
    expect(await workingDirectoryProblem(join(dir, 'gone'))).toBe('working directory not found')
    expect(SPAWN_REFUSAL.directoryNotFound).toBe('working directory not found')
  })

  it('reports a file in place of the directory as not found', async () => {
    expect(await workingDirectoryProblem(file)).toBe(SPAWN_REFUSAL.directoryNotFound)
  })

  it('reports non-strings, relative and malformed paths as invalid', async () => {
    for (const cwd of [undefined, null, 42, '', 'relative/dir', '~', '/tmp/a\0b']) {
      expect(await workingDirectoryProblem(cwd)).toBe(SPAWN_REFUSAL.invalidDirectory)
    }
  })
})

describe('isCurrentMainFrame', () => {
  const main = { processId: 4, routingId: 1, detached: false }

  it('accepts the live main frame, by identity or by process and routing id', () => {
    expect(isCurrentMainFrame(main, main)).toBe(true)
    expect(isCurrentMainFrame({ processId: 4, routingId: 1, detached: false }, main)).toBe(true)
  })

  it('refuses a missing, detached or other frame', () => {
    expect(isCurrentMainFrame(null, main)).toBe(false)
    expect(isCurrentMainFrame({ ...main, detached: true }, main)).toBe(false)
    expect(isCurrentMainFrame({ processId: 5, routingId: 1, detached: false }, main)).toBe(false)
    expect(isCurrentMainFrame({ processId: 4, routingId: 2, detached: false }, main)).toBe(false)
  })
})

describe('isCardId', () => {
  it('accepts a non-empty string of at most 100 chars (#9 D3)', () => {
    expect(isCardId('c1')).toBe(true)
    expect(isCardId('x'.repeat(100))).toBe(true)
  })

  it('rejects empty, too long and non-string ids', () => {
    expect(isCardId('')).toBe(false)
    expect(isCardId('x'.repeat(101))).toBe(false)
    expect(isCardId(undefined)).toBe(false)
    expect(isCardId(42)).toBe(false)
  })
})
