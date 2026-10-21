import { describe, expect, it } from 'vitest'
import {
  BOARD_PROTOCOL_VERSION,
  INVALID_REQUEST,
  MAX_REQUEST_LINE_BYTES,
  parseReplyLine,
  parseRequestLine,
  serializeReply,
  serializeRequest
} from './board-protocol'

const move = { v: 1, cardId: 'c1', command: 'move', card: '.', column: 'Done' }
const status = { v: 1, cardId: 'c1', command: 'status', card: 'api', text: 'running tests' }
const line = (value: unknown): string => JSON.stringify(value)

describe('serializeRequest / parseRequestLine', () => {
  it('round-trips a move and a status as one JSON line', () => {
    const m = serializeRequest('c1', { command: 'move', card: '.', column: 'Done' })
    expect(m).toBe(`${line(move)}\n`)
    expect(parseRequestLine(m.trimEnd())).toEqual({ ok: true, request: move })
    const s = serializeRequest('c1', { command: 'status', card: 'api', text: 'running tests' })
    expect(s).toBe(`${line(status)}\n`)
    expect(parseRequestLine(s)).toEqual({ ok: true, request: status })
  })

  it('round-trips a list, a create and a rename; a list takes only text or json', () => {
    for (const command of [
      { command: 'list', format: 'json' },
      { command: 'create', column: 'Backlog', title: 'Fix login' },
      { command: 'rename', card: '.', title: 'New' }
    ] as const) {
      const sent = serializeRequest('c1', command)
      expect(parseRequestLine(sent)).toEqual({
        ok: true,
        request: { v: 1, cardId: 'c1', ...command }
      })
    }
    expect(parseRequestLine(line({ v: 1, cardId: 'c1', command: 'list', format: 'xml' }))).toEqual({
      ok: false,
      error: INVALID_REQUEST
    })
    expect(
      parseRequestLine(line({ v: 1, cardId: 'c1', command: 'create', column: 'B', title: 1 }))
    ).toEqual({ ok: false, error: INVALID_REQUEST })
  })

  it('carries a reply output both ways', () => {
    const reply = serializeReply({ ok: true, output: 'c-new\n' })
    expect(parseReplyLine(reply.trimEnd())).toEqual({ ok: true, output: 'c-new\n' })
    expect(parseReplyLine(line({ ok: true, output: 3 }))).toBeNull()
  })

  it('round-trips a session, and rejects one that is not a UUID', () => {
    const s = serializeRequest('c1', {
      command: 'session',
      card: '.',
      session: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11'
    })
    const session = {
      v: 1,
      cardId: 'c1',
      command: 'session',
      card: '.',
      session: '6f1c1b1e-2f0e-4a59-9a43-0d6c4b0f1a11'
    }
    expect(s).toBe(`${line(session)}\n`)
    expect(parseRequestLine(s)).toEqual({ ok: true, request: session })
    expect(parseRequestLine(line({ ...session, session: 'x' })).ok).toBe(false)
  })

  it('round-trips a setup ok and failed, and rejects any other result (#39 D4)', () => {
    for (const result of ['ok', 'failed'] as const) {
      const s = serializeRequest('c1', { command: 'setup', card: '.', result })
      const setup = { v: 1, cardId: 'c1', command: 'setup', card: '.', result }
      expect(s).toBe(`${line(setup)}\n`)
      expect(parseRequestLine(s)).toEqual({ ok: true, request: setup })
    }
    const bad = { v: 1, cardId: 'c1', command: 'setup', card: '.', result: 'done' }
    expect(parseRequestLine(line(bad))).toEqual({ ok: false, error: INVALID_REQUEST })
  })

  describe('usage (#50 D5)', () => {
    const usage = {
      input: 1010,
      output: 700,
      cacheWrite: 2000,
      cacheRead: 3000,
      tokens: 6710,
      context: 3010,
      model: 'claude-sonnet-4-5'
    }
    const request = (u: unknown): Record<string, unknown> => ({
      v: 1,
      cardId: 'c1',
      command: 'usage',
      card: '.',
      usage: u
    })

    it('round-trips a usage, with or without a model', () => {
      const s = serializeRequest('c1', { command: 'usage', card: '.', usage })
      expect(s).toBe(`${line(request(usage))}\n`)
      expect(parseRequestLine(s)).toEqual({ ok: true, request: request(usage) })
      const unknown = { ...usage, model: null }
      expect(parseRequestLine(line(request(unknown)))).toEqual({
        ok: true,
        request: request(unknown)
      })
      const zero = { ...unknown, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0 }
      expect(parseRequestLine(line(request({ ...zero, context: 0 })))).toEqual({
        ok: true,
        request: request({ ...zero, context: 0 })
      })
    })

    it('rejects a negative, fractional, unsafe or mistyped count', () => {
      for (const key of ['input', 'output', 'cacheWrite', 'cacheRead', 'tokens', 'context']) {
        for (const bad of [-1, 1.5, 2 ** 53, '5', null, undefined]) {
          expect(parseRequestLine(line(request({ ...usage, [key]: bad })))).toEqual({
            ok: false,
            error: INVALID_REQUEST
          })
        }
      }
    })

    it('rejects a cost and a model that is not a short string or null', () => {
      for (const bad of [
        { ...usage, cost: 0.5 },
        { ...usage, model: 'm'.repeat(201) },
        { ...usage, model: 5 },
        { ...usage, extra: 1 },
        [],
        null,
        'usage'
      ]) {
        expect(parseRequestLine(line(request(bad)))).toEqual({ ok: false, error: INVALID_REQUEST })
      }
      const noModel: Record<string, unknown> = { ...usage }
      delete noModel.model
      expect(parseRequestLine(line(request(noModel)))).toEqual({
        ok: false,
        error: INVALID_REQUEST
      })
      expect(parseRequestLine(line({ ...request(usage), extra: 'x' }))).toEqual({
        ok: false,
        error: INVALID_REQUEST
      })
      expect(parseRequestLine(line(request({ ...usage, model: 'm'.repeat(200) })))).toMatchObject({
        ok: true
      })
    })
  })

  it('round-trips an activity, still version 1 (#31 D12)', () => {
    const a = serializeRequest('c1', { command: 'activity', card: '.', activity: 'working' })
    const activity = { v: 1, cardId: 'c1', command: 'activity', card: '.', activity: 'working' }
    expect(a).toBe(`${line(activity)}\n`)
    expect(parseRequestLine(a)).toEqual({ ok: true, request: activity })
    const none = { ...activity, activity: 'none' }
    expect(parseRequestLine(line(none))).toEqual({ ok: true, request: none })
  })

  it('rejects an activity request with another value or other fields (#31 D12)', () => {
    const activity = { v: 1, cardId: 'c1', command: 'activity', card: '.', activity: 'waiting' }
    const bad: unknown[] = [
      { ...activity, activity: 'busy' },
      { ...activity, activity: 'Waiting' },
      { ...activity, activity: 1 },
      { v: 1, cardId: 'c1', command: 'activity', card: '.' },
      { ...activity, text: 'x' },
      { ...status, command: 'activity' }
    ]
    for (const value of bad) {
      expect(parseRequestLine(line(value))).toEqual({ ok: false, error: INVALID_REQUEST })
    }
  })

  it('is version 1 with an 8 KB line limit', () => {
    expect(BOARD_PROTOCOL_VERSION).toBe(1)
    expect(MAX_REQUEST_LINE_BYTES).toBe(8192)
  })

  it('rejects invalid JSON and non-objects', () => {
    for (const bad of ['hello', '', '{', 'null', '[]', '1', '"move"']) {
      expect(parseRequestLine(bad)).toEqual({ ok: false, error: INVALID_REQUEST })
    }
  })

  it('rejects another version', () => {
    expect(parseRequestLine('{"v":2}')).toEqual({ ok: false, error: INVALID_REQUEST })
    expect(parseRequestLine(line({ ...move, v: 2 }))).toEqual({ ok: false, error: INVALID_REQUEST })
    expect(parseRequestLine(line({ ...move, v: '1' }))).toEqual({
      ok: false,
      error: INVALID_REQUEST
    })
  })

  it('rejects missing, mistyped and extra fields and unknown commands', () => {
    const bad: unknown[] = [
      { v: 1, cardId: 'c1', command: 'move', card: '.' },
      { v: 1, command: 'move', card: '.', column: 'Done' },
      { ...move, cardId: 7 },
      { ...move, card: null },
      { ...move, column: ['Done'] },
      { v: 1, cardId: 'c1', command: 'status', card: '.' },
      { ...status, text: 1 },
      { ...status, column: 'Done' },
      { ...move, text: 'x' },
      { ...move, command: 'frob' },
      { ...move, command: 'MOVE' }
    ]
    for (const value of bad) {
      expect(parseRequestLine(line(value))).toEqual({ ok: false, error: INVALID_REQUEST })
    }
  })

  it('rejects a line over 8 KB, counted in UTF-8 bytes', () => {
    const fits = { ...status, text: '' }
    const room = MAX_REQUEST_LINE_BYTES - line(fits).length
    expect(parseRequestLine(line({ ...status, text: 'a'.repeat(room) })).ok).toBe(true)
    expect(parseRequestLine(line({ ...status, text: 'a'.repeat(room + 1) }))).toEqual({
      ok: false,
      error: 'board: request too long'
    })
    // 'é' is two bytes: half as many characters already go over.
    expect(parseRequestLine(line({ ...status, text: 'é'.repeat(room / 2 + 1) })).ok).toBe(false)
    expect(parseRequestLine('x'.repeat(9 * 1024))).toEqual({
      ok: false,
      error: 'board: request too long'
    })
  })
})

describe('serializeReply / parseReplyLine', () => {
  it('writes and reads ok and error replies as one line', () => {
    expect(serializeReply({ ok: true })).toBe('{"ok":true}\n')
    expect(serializeReply({ ok: false, error: 'board: no card "x" in this workspace' })).toBe(
      '{"ok":false,"error":"board: no card \\"x\\" in this workspace"}\n'
    )
    expect(parseReplyLine('{"ok":true}')).toEqual({ ok: true })
    expect(parseReplyLine('{"ok":false,"error":"board: nope"}\n')).toEqual({
      ok: false,
      error: 'board: nope'
    })
  })

  it('returns null for anything that is not a reply', () => {
    for (const bad of [
      '',
      'hello',
      '{}',
      '{"ok":false}',
      '{"ok":false,"error":3}',
      '{"ok":"yes"}'
    ]) {
      expect(parseReplyLine(bad)).toBeNull()
    }
  })
})
