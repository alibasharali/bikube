import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeRequest, type BoardReply, type BoardRequest } from './board-protocol'
import { DRAIN_MS, MAX_CONNECTIONS, startBoardServer, type BoardServer } from './board-server'

let dir: string
let boardDir: string
let socketPath: string
const servers: BoardServer[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bikube-sock-'))
  boardDir = join(dir, 'board')
  socketPath = join(boardDir, 'board.sock')
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()))
  await rm(dir, { recursive: true, force: true })
})

async function serve(
  handler: (request: BoardRequest) => Promise<BoardReply> = async () => ({ ok: true }),
  options?: { lineTimeoutMs?: number; drainMs?: number }
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

  it('creates the socket as mode 0600 in a private 0700 directory (#9 D5, AC9)', async () => {
    await serve()
    const stat = statSync(socketPath)
    expect(stat.isSocket()).toBe(true)
    expect(stat.mode & 0o777).toBe(0o600)
    const dirStat = lstatSync(boardDir)
    expect(dirStat.isDirectory()).toBe(true)
    expect(dirStat.mode & 0o777).toBe(0o700)
  })

  it('never changes the process umask (#9 D5)', async () => {
    const umask = vi.spyOn(process, 'umask')
    try {
      await serve()
      expect(umask.mock.calls.filter((args) => args.length > 0)).toEqual([])
    } finally {
      umask.mockRestore()
    }
  })

  it('makes an existing directory of ours private again (#9 D5)', async () => {
    mkdirSync(boardDir)
    chmodSync(boardDir, 0o755)
    await serve()
    expect(lstatSync(boardDir).mode & 0o777).toBe(0o700)
  })

  it('refuses to listen when the directory is a symlink (#9 D5)', async () => {
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(elsewhere, { mode: 0o700 })
    symlinkSync(elsewhere, boardDir)
    await expect(startBoardServer(socketPath, async () => ({ ok: true }))).rejects.toThrow()
    expect(existsSync(join(elsewhere, 'board.sock'))).toBe(false)
  })

  it('refuses to listen when the directory is a file (#9 D5)', async () => {
    writeFileSync(boardDir, 'not a directory')
    await expect(startBoardServer(socketPath, async () => ({ ok: true }))).rejects.toThrow()
  })

  it('replaces a leftover file at its path (#9 D5)', async () => {
    mkdirSync(boardDir, { mode: 0o700 })
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
      startBoardServer(join(dir, 'missing', 'board', 'board.sock'), async () => ({ ok: true }))
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
    expect(reply).toBe('{"ok":false,"error":"board: no answer from Bikube"}\n')
  })

  it(`serves at most ${MAX_CONNECTIONS} connections at once (#9 D5)`, async () => {
    expect(MAX_CONNECTIONS).toBe(32)
    await serve(undefined, { lineTimeoutMs: 10_000 })
    const idle: Socket[] = []
    try {
      for (let i = 0; i < MAX_CONNECTIONS; i++) {
        const socket = createConnection(socketPath)
        socket.on('error', () => {})
        idle.push(socket)
        await new Promise((resolve) => socket.once('connect', resolve))
      }
      // Let the server accept them all before the next one arrives.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(
        await exchange(serializeRequest('c1', { command: 'move', card: '.', column: 'x' }))
      ).toBe('')
      const freed = idle.pop() as Socket
      await new Promise((resolve) => {
        freed.once('close', resolve)
        freed.destroy()
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(
        await exchange(serializeRequest('c1', { command: 'move', card: '.', column: 'x' }))
      ).toBe('{"ok":true}\n')
    } finally {
      idle.forEach((socket) => socket.destroy())
    }
  })

  it('closes a connection that keeps it open after the reply within the drain time (#9 D5)', async () => {
    expect(DRAIN_MS).toBe(1000)
    await serve(undefined, { drainMs: 100 })
    const started = Date.now()
    const received = await new Promise<string>((resolve) => {
      // Half-open: the client never ends its side and keeps writing, so only the server's drain
      // limit closes the connection; the next write then fails.
      const socket = createConnection({ path: socketPath, allowHalfOpen: true })
      let data = ''
      let writer: ReturnType<typeof setInterval> | undefined
      const done = (): void => {
        clearInterval(writer)
        socket.destroy()
        resolve(data)
      }
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => (data += chunk))
      socket.on('end', () => {
        writer = setInterval(() => socket.write('more\n'), 20)
      })
      socket.on('error', done)
      socket.on('close', done)
      socket.write(serializeRequest('c1', { command: 'move', card: '.', column: 'x' }))
    })
    expect(received).toBe('{"ok":true}\n')
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
