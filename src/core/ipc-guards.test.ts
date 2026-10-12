import { describe, expect, it } from 'vitest'
import { MAX_WRITE_BYTES, isSessionId, isValidSize, isWriteData } from './ipc-guards'

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
