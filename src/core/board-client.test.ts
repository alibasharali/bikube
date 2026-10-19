import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOARD_USAGE } from './board-args'
import { NOT_IN_A_CARD } from './board-commands'
import { NO_ANSWER, NOT_RUNNING, runBoard } from './board-client'
import type { BoardReply, BoardRequest } from './board-protocol'
import { startBoardServer, type BoardServer } from './board-server'

let dir: string
let socketPath: string
let server: BoardServer | undefined
let raw: Server | undefined
const rawSockets: Socket[] = []

/** A bare listener that runs `onConnection` instead of answering like main. */
async function listenRaw(onConnection: (socket: Socket) => void): Promise<void> {
  raw = createServer((socket) => {
    rawSockets.push(socket)
    onConnection(socket)
  })
  await new Promise<void>((done) => raw!.listen(socketPath, done))
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'drovr-cli-'))
  socketPath = join(dir, 'board.sock')
})

afterEach(async () => {
  await server?.close()
  server = undefined
  rawSockets.splice(0).forEach((socket) => socket.destroy())
  await new Promise<void>((done) => (raw ? raw.close(() => done()) : done()))
  raw = undefined
  await rm(dir, { recursive: true, force: true })
})

async function serve(handler: (request: BoardRequest) => Promise<BoardReply>): Promise<void> {
  server = await startBoardServer(socketPath, handler)
}

/** Runs `board <argv>` with the given environment; returns its exit code and output. */
async function board(
  argv: string[],
  env: Record<string, string | undefined> = { DROVR_CARD_ID: 'c1', DROVR_SOCKET: socketPath },
  timeoutMs?: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runBoard(
    argv,
    env,
    { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) },
    timeoutMs
  )
  return { code, stdout, stderr }
}

describe('runBoard', () => {
  it('sends the command for the calling card and exits 0 silently on success (#9 D9)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    expect(await board(['move', '.', 'done'])).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'c1',
      command: 'move',
      card: '.',
      column: 'done'
    })
  })

  it("prints a refusal's reason to stderr and exits 1 (#9 D9)", async () => {
    await serve(async () => ({ ok: false, error: 'board: no card "ghost" in this workspace' }))
    expect(await board(['move', 'ghost', 'Done'])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'board: no card "ghost" in this workspace\n'
    })
  })

  it('prints usage to stdout for help and exits 0, to stderr for a wrong shape and exits 2 (#9 D1)', async () => {
    expect(await board([], {})).toEqual({ code: 0, stdout: BOARD_USAGE, stderr: '' })
    expect(await board(['frob'], {})).toEqual({ code: 2, stdout: '', stderr: BOARD_USAGE })
  })

  it('reads the transcript and sends its usage for the card (#50 D5)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    const transcript = join(dir, 't.jsonl')
    await writeFile(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          model: 'gpt-x',
          usage: { input_tokens: 1000, output_tokens: 1000 }
        }
      })}\n`
    )
    expect(await board(['usage', '.', transcript])).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'c1',
      command: 'usage',
      card: '.',
      usage: {
        input: 1000,
        output: 1000,
        cacheWrite: 0,
        cacheRead: 0,
        tokens: 2000,
        context: 1000,
        model: 'gpt-x'
      }
    })
  })

  it("prints can't read for an unreadable transcript, exits 1 and sends nothing (#50 D5)", async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    expect(await board(['usage', '.', '/nope.jsonl'])).toEqual({
      code: 1,
      stdout: '',
      stderr: "board: can't read /nope.jsonl\n"
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('checks for a card before reading a transcript, so outside one it reads nothing (#50 D5)', async () => {
    expect(await board(['usage', '.', '/nope.jsonl'], {})).toEqual({
      code: 1,
      stdout: '',
      stderr: `${NOT_IN_A_CARD}\n`
    })
    expect(await board(['usage', '.', '/nope.jsonl'], { DROVR_CARD_ID: 'c1' })).toEqual({
      code: 1,
      stdout: '',
      stderr: `${NOT_RUNNING}\n`
    })
  })

  it('refuses without a card id (#9 D3, AC8)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    expect(await board(['move', '.', 'Done'], { DROVR_SOCKET: socketPath })).toEqual({
      code: 1,
      stdout: '',
      stderr: `${NOT_IN_A_CARD}\n`
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('reports Drovr not running when nothing listens on the socket (#9 D9, AC8)', async () => {
    expect(await board(['move', '.', 'Done'])).toMatchObject({
      code: 1,
      stderr: `${NOT_RUNNING}\n`
    })
    expect(await board(['move', '.', 'Done'], { DROVR_CARD_ID: 'c1' })).toMatchObject({
      code: 1,
      stderr: `${NOT_RUNNING}\n`
    })
  })

  it('gives up with no answer when the app does not reply in time (#9 D9)', async () => {
    await listenRaw(() => {})
    expect(await board(['move', '.', 'Done'], undefined, 100)).toMatchObject({
      code: 1,
      stderr: `${NO_ANSWER}\n`
    })
  })

  it('reports no answer when the app closes without a valid reply', async () => {
    await listenRaw((socket) => socket.end('garbage\n'))
    expect(await board(['move', '.', 'Done'])).toMatchObject({ code: 1, stderr: `${NO_ANSWER}\n` })
  })
})
