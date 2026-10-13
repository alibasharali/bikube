import { existsSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeRequest, type BoardReply, type BoardRequest } from './board-protocol'
import { startBoardServer, type BoardServer } from './board-server'

let dir: string
let socketPath: string
const servers: BoardServer[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'drovr-sock-'))
  socketPath = join(dir, 'board.sock')
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  await rm(dir, { recursive: true, force: true })
})

async function serve(
  handler: (request: BoardRequest) => Promise<BoardReply> = async () => ({ ok: true }),
  options?: { lineTimeoutMs?: number }
): Promise<BoardServer> {
  const server = await startBoardServer(socketPath, handler, options)
  servers.push(server)
  return server
}

/** Writes `data` on a fresh connection; resolves with everything read until the server closes. */
function exchange(data: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => (received += chunk))
    // A reset after the reply (the server closed with our data unread) still counts as closed.
    socket.on('error', (error: NodeJS.ErrnoException) =>
      error.code === 'ECONNRESET' || error.code === 'EPIPE' ? resolve(received) : reject(error)
    )
    socket.on('close', () => resolve(received))
    socket.write(data)
  })
}

describe('startBoardServer', () => {
  it('passes one request line to the handler and answers with its reply, then closes (#9 D6)', async () => {
    const handler = vi.fn(async () => ({ ok: false, error: 'board: nope' }) as BoardReply)
    await serve(handler)
    const reply = await exchange(
      serializeRequest('c1', { command: 'move', card: '.', column: 'Done' })
    )
    expect(reply).toBe('{"ok":false,"error":"board: nope"}\n')
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'c1',
      command: 'move',
      card: '.',
      column: 'Done'
    })
  })

  it('creates the socket as mode 0600, only its user can connect (#9 D5, AC9)', async () => {
    await serve()
    const stat = statSync(socketPath)
    expect(stat.isSocket()).toBe(true)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('leaves the process umask as it was', async () => {
    const before = process.umask()
    await serve()
    expect(process.umask()).toBe(before)
  })

  it('replaces a leftover file at its path (#9 D5)', async () => {
    writeFileSync(socketPath, 'stale')
    await serve()
    expect(statSync(socketPath).isSocket()).toBe(true)
    expect(
      await exchange(serializeRequest('c1', { command: 'status', card: '.', text: 'x' }))
    ).toBe('{"ok":true}\n')
  })

  it('removes the socket file when closed (#9 D5)', async () => {
    const server = await serve()
    servers.splice(servers.indexOf(server), 1)
    await server.close()
    expect(existsSync(socketPath)).toBe(false)
  })

  it('rejects when it cannot listen', async () => {
    await expect(
      startBoardServer(join(dir, 'missing', 'board.sock'), async () => ({ ok: true }))
    ).rejects.toThrow()
  })

  it.each([
    ['not JSON', 'hello\n', 'board: invalid request'],
    ['another version', '{"v":2}\n', 'board: invalid request'],
    ['a line over 8 KB', `${'x'.repeat(9 * 1024)}\n`, 'board: request too long']
  ])(
    'answers %s with an error and closes, without calling the handler (#9 D6, AC10)',
    async (_, line, error) => {
      const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
      await serve(handler)
      expect(await exchange(line)).toBe(`${JSON.stringify({ ok: false, error })}\n`)
      expect(handler).not.toHaveBeenCalled()
      // The server keeps serving afterwards.
      expect(
        await exchange(serializeRequest('c1', { command: 'move', card: '.', column: 'x' }))
      ).toBe('{"ok":true}\n')
    }
  )

  it('answers an over-long line before its newline arrives (#9 D6)', async () => {
    await serve()
    expect(await exchange('x'.repeat(20 * 1024))).toBe(
      '{"ok":false,"error":"board: request too long"}\n'
    )
  })

  it('closes a connection that sends no full line in time (#9 D6)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler, { lineTimeoutMs: 100 })
    const started = Date.now()
    expect(await exchange('{"v":1')).toBe('')
    expect(Date.now() - started).toBeLessThan(2000)
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers with an error when the handler fails', async () => {
    await serve(async () => {
      throw new Error('boom')
    })
    const reply = await exchange(
      serializeRequest('c1', { command: 'move', card: '.', column: 'x' })
    )
    expect(reply).toBe('{"ok":false,"error":"board: no answer from Drovr"}\n')
  })
})
