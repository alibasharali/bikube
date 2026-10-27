import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendBoardRequest } from './board-client'
import { INVALID_REQUEST, serializeRequest, type BoardReply } from './board-protocol'
import { removeLeftoverSessionSockets, SessionSockets } from './session-sockets'

let dir: string
let boardDir: string
let sockets: SessionSockets | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bikube-ss-'))
  boardDir = join(dir, 'board')
})

afterEach(async () => {
  sockets?.closeAll()
  sockets = undefined
  await rm(dir, { recursive: true, force: true })
})

const status = (cardId: string, text: string): string =>
  serializeRequest(cardId, { command: 'status', card: '.', text })

describe('SessionSockets (#25 D2, D3)', () => {
  it('answers another card id with invalid request, without calling the window', async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    sockets = new SessionSockets(boardDir, handler)
    const session = await sockets.open('card-1')
    expect(session.forward.localSocket).not.toBeNull()
    expect(await sendBoardRequest(session.forward.localSocket!, status('card-2', 'x'))).toEqual({
      ok: false,
      error: INVALID_REQUEST
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("relays only its own card's description, and no describe (#69 D9)", async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    sockets = new SessionSockets(boardDir, handler)
    const local = (await sockets.open('card-1')).forward.localSocket!
    for (const card of ['.', 'card-1']) {
      const line = serializeRequest('card-1', { command: 'description', card })
      expect(await sendBoardRequest(local, line)).toEqual({ ok: true })
    }
    expect(handler).toHaveBeenCalledTimes(2)
    for (const line of [
      serializeRequest('card-1', { command: 'description', card: 'web' }),
      serializeRequest('card-1', { command: 'describe', card: '.', description: 'x' })
    ]) {
      expect(await sendBoardRequest(local, line)).toEqual({ ok: false, error: INVALID_REQUEST })
    }
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('relays no workspaces, create, rename or --workspace (#69 D9)', async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    sockets = new SessionSockets(boardDir, handler)
    const local = (await sockets.open('card-1')).forward.localSocket!
    for (const line of [
      serializeRequest('card-1', { command: 'workspaces', format: 'text' }),
      serializeRequest('card-1', { command: 'create', column: 'Todo', title: 'x' }),
      serializeRequest('card-1', { command: 'rename', card: '.', title: 'x' }),
      serializeRequest('card-1', { command: 'list', format: 'text', workspace: 'Beta' }),
      serializeRequest('card-1', { command: 'move', card: 'x', column: 'Done', workspace: 'b' }),
      serializeRequest('card-1', { command: 'description', card: '.', workspace: 'b' })
    ]) {
      expect(await sendBoardRequest(local, line)).toEqual({ ok: false, error: INVALID_REQUEST })
    }
    expect(handler).not.toHaveBeenCalled()
    const move = serializeRequest('card-1', { command: 'move', card: 'web', column: 'Done' })
    expect(await sendBoardRequest(local, move)).toEqual({ ok: true })
  })

  it("relays its own card's requests, on random paths in the board directory and /tmp", async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: false, error: 'board: nope' }))
    sockets = new SessionSockets(boardDir, handler)
    const one = await sockets.open('card-1')
    const two = await sockets.open('card-1')
    const local = one.forward.localSocket!
    expect(local).toMatch(new RegExp(`^${boardDir}/s-[0-9a-f]{16}\\.sock$`))
    expect(one.forward.remoteSocket).toMatch(/^\/tmp\/bikube-[0-9a-f]{32}\.sock$/)
    expect(two.forward.localSocket).not.toBe(local)
    expect(two.forward.remoteSocket).not.toBe(one.forward.remoteSocket)
    expect(await sendBoardRequest(local, status('card-1', 'hi'))).toEqual({
      ok: false,
      error: 'board: nope'
    })
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'card-1',
      command: 'status',
      card: '.',
      text: 'hi'
    })
  })

  it('is closed and its file removed when its session exits, and only then', async () => {
    sockets = new SessionSockets(boardDir, async () => ({ ok: true }))
    const one = await sockets.open('card-1')
    const two = await sockets.open('card-2')
    one.attach('7')
    two.attach('8')
    sockets.sessionExited('7')
    expect(existsSync(one.forward.localSocket!)).toBe(false)
    expect(existsSync(two.forward.localSocket!)).toBe(true)
    expect(await sendBoardRequest(one.forward.localSocket!, status('card-1', 'x'))).toMatchObject({
      ok: false
    })
  })

  it('closes a socket whose session never started', async () => {
    sockets = new SessionSockets(boardDir, async () => ({ ok: true }))
    const session = await sockets.open('card-1')
    session.discard()
    expect(existsSync(session.forward.localSocket!)).toBe(false)
  })

  it('gives no local socket when it cannot listen (D7)', async () => {
    writeFileSync(boardDir, 'not a directory')
    sockets = new SessionSockets(boardDir, async () => ({ ok: true }))
    const session = await sockets.open('card-1')
    expect(session.forward).toMatchObject({ cardId: 'card-1', localSocket: null })
    expect(session.forward.remoteSocket).toMatch(/^\/tmp\/bikube-[0-9a-f]{32}\.sock$/)
  })

  it('closes every socket on quit, and one still starting as soon as it listens', async () => {
    sockets = new SessionSockets(boardDir, async () => ({ ok: true }))
    const one = await sockets.open('card-1')
    one.attach('7')
    await sockets.open('card-2')
    const starting = sockets.open('card-3')
    sockets.closeAll()
    const late = await starting
    expect(late.forward.localSocket).toBeNull()
    expect(readdirSync(boardDir).filter((name) => name.startsWith('s-'))).toEqual([])
  })
})

describe('removeLeftoverSessionSockets (#25 D2)', () => {
  it('removes every s-*.sock in the board directory and nothing else', () => {
    mkdirSync(boardDir)
    for (const name of [
      's-old.sock',
      's-0123456789abcdef.sock',
      'board.sock',
      'other',
      's-x.txt'
    ]) {
      writeFileSync(join(boardDir, name), '')
    }
    removeLeftoverSessionSockets(boardDir)
    expect(readdirSync(boardDir).sort()).toEqual(['board.sock', 'other', 's-x.txt'])
  })

  it('does nothing without a board directory', () => {
    expect(() => removeLeftoverSessionSockets(boardDir)).not.toThrow()
  })
})
