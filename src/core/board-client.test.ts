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
  dir = await mkdtemp(join(tmpdir(), 'bikube-cli-'))
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
  env: Record<string, string | undefined> = { BIKUBE_CARD_ID: 'c1', BIKUBE_SOCKET: socketPath },
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

  it("prints a reply's output to stdout (list, create)", async () => {
    const handler = vi.fn(async () => ({ ok: true, output: 'c-new\n' }) as BoardReply)
    await serve(handler)
    expect(await board(['create', 'Backlog', 'Fix login'])).toEqual({
      code: 0,
      stdout: 'c-new\n',
      stderr: ''
    })
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'c1',
      command: 'create',
      column: 'Backlog',
      title: 'Fix login'
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
    expect(await board(['usage', '.', '/nope.jsonl'], { BIKUBE_CARD_ID: 'c1' })).toEqual({
      code: 1,
      stdout: '',
      stderr: `${NOT_RUNNING}\n`
    })
  })

  it('refuses without a card id (#9 D3, AC8)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    expect(await board(['move', '.', 'Done'], { BIKUBE_SOCKET: socketPath })).toEqual({
      code: 1,
      stdout: '',
      stderr: `${NOT_IN_A_CARD}\n`
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('reports Bikube not running when nothing listens on the socket (#9 D9, AC8)', async () => {
    expect(await board(['move', '.', 'Done'])).toMatchObject({
      code: 1,
      stderr: `${NOT_RUNNING}\n`
    })
    expect(await board(['move', '.', 'Done'], { BIKUBE_CARD_ID: 'c1' })).toMatchObject({
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

describe('runBoard: description and describe (#69 D5)', () => {
  /** Runs `board <argv>` in card c1 with `stdin` as its standard input. */
  async function boardIn(
    argv: string[],
    stdin: Uint8Array = new Uint8Array()
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    let stdout = ''
    let stderr = ''
    const code = await runBoard(
      argv,
      { BIKUBE_CARD_ID: 'c1', BIKUBE_SOCKET: socketPath },
      { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text) },
      undefined,
      async () => stdin
    )
    return { code, stdout, stderr }
  }
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

  it("prints the card's description (AC4)", async () => {
    const handler = vi.fn(async () => ({ ok: true, output: 'Hello 69\n' }) as BoardReply)
    await serve(handler)
    expect(await boardIn(['description', '.'])).toEqual({
      code: 0,
      stdout: 'Hello 69\n',
      stderr: ''
    })
    expect(handler).toHaveBeenCalledWith({ v: 1, cardId: 'c1', command: 'description', card: '.' })
  })

  it("sends a file's text, and stdin's for -, trimmed (AC4)", async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    const file = join(dir, 'task.md')
    await writeFile(file, '# Goal\nFix it\n\n')
    expect(await boardIn(['describe', 'api', file])).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(handler).toHaveBeenLastCalledWith({
      v: 1,
      cardId: 'c1',
      command: 'describe',
      card: 'api',
      description: '# Goal\nFix it'
    })
    expect(await boardIn(['describe', '.', '-'], utf8('New text'))).toEqual({
      code: 0,
      stdout: '',
      stderr: ''
    })
    expect(handler).toHaveBeenLastCalledWith({
      v: 1,
      cardId: 'c1',
      command: 'describe',
      card: '.',
      description: 'New text'
    })
  })

  it('sends an empty file as no description (D5)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    expect(await boardIn(['describe', '.', '-'], utf8(' \n'))).toMatchObject({ code: 0 })
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ description: '' }))
  })

  it('refuses a file over 100,000 characters, unreadable or not UTF-8, sending nothing (AC4)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    const long = join(dir, 'long.md')
    await writeFile(long, 'a'.repeat(100_001))
    expect(await boardIn(['describe', '.', long])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'board: Description is longer than 100,000 characters\n'
    })
    expect(await boardIn(['describe', '.', join(dir, 'nope.md')])).toEqual({
      code: 1,
      stdout: '',
      stderr: `board: can't read ${join(dir, 'nope.md')}\n`
    })
    expect(await boardIn(['describe', '.', '-'], new Uint8Array([0x61, 0xff, 0xfe]))).toEqual({
      code: 1,
      stdout: '',
      stderr: 'board: stdin is not UTF-8 text\n'
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('sends a 100,000-character multi-byte description whole (AC14)', async () => {
    const handler = vi.fn(async () => ({ ok: true }) as BoardReply)
    await serve(handler)
    const text = '🎉é'.repeat(50_000)
    const file = join(dir, 'big.md')
    await writeFile(file, text)
    expect(await boardIn(['describe', '.', file])).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ description: text }))
  })
})
