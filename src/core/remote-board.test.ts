import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOARD_USAGE } from './board-args'
import { NOT_IN_A_CARD } from './board-commands'
import { NO_ANSWER, type BoardReply, type BoardRequest } from './board-protocol'
import { startBoardServer, type BoardServer } from './board-server'
import {
  CANT_REACH,
  NEEDS_PERL_OR_PYTHON,
  perlClient,
  pythonClient,
  remoteBoardScript
} from './remote-board'

/** Where `name` is on this machine's PATH, or null. */
function which(name: string): string | null {
  try {
    return execFileSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

const PERL = which('perl')
const PYTHON = which('python3')

let dir: string
let socketPath: string
let script: string
let server: BoardServer | undefined
let raw: Server | undefined
const rawSockets: Socket[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'drovr-rb-'))
  socketPath = join(dir, 'board.sock')
  script = join(dir, 'board')
  writeFileSync(script, remoteBoardScript())
  chmodSync(script, 0o700)
})

afterEach(async () => {
  await server?.close()
  server = undefined
  rawSockets.splice(0).forEach((socket) => socket.destroy())
  await new Promise<void>((done) => (raw ? raw.close(() => done()) : done()))
  raw = undefined
  await rm(dir, { recursive: true, force: true })
})

/** A directory holding only symlinks to `tools`, for a PATH with nothing else on it. */
function binWith(name: string, tools: Record<string, string>): string {
  const bin = join(dir, name)
  mkdirSync(bin)
  for (const [tool, target] of Object.entries(tools)) symlinkSync(target, join(bin, tool))
  return bin
}

interface Run {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs the generated script with `sh` under `env` (asynchronously, so the server can answer). */
function run(args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', [script, ...args], { env })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (text: string) => (stdout += text))
    child.stderr.setEncoding('utf8').on('data', (text: string) => (stderr += text))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

async function serve(handler: (request: BoardRequest) => Promise<BoardReply>): Promise<void> {
  server = await startBoardServer(socketPath, handler)
}

const languages = [
  { name: 'perl', path: PERL },
  { name: 'python3', path: PYTHON }
]

describe.each(languages)('the remote board script with only $name (#25 D5, D6)', (language) => {
  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    PATH: binWith(`bin-${Math.random().toString(16).slice(2)}`, {
      [language.name]: language.path ?? ''
    }),
    DROVR_CARD_ID: 'card-1',
    DROVR_SOCKET: socketPath,
    ...extra
  })

  it.skipIf(!language.path)('sends a status for the calling card and exits 0', async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    await serve(handler)
    expect(await run(['status', '.', 'hi'], env())).toEqual({ code: 0, stdout: '', stderr: '' })
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'card-1',
      command: 'status',
      card: '.',
      text: 'hi'
    })
  })

  it.skipIf(!language.path)('sends a move with its column', async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    await serve(handler)
    expect((await run(['move', 'web', 'Needs me'], env())).code).toBe(0)
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'card-1',
      command: 'move',
      card: 'web',
      column: 'Needs me'
    })
  })

  it.skipIf(!language.path)('sends a quote, a backslash, a newline and é unchanged', async () => {
    const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
    await serve(handler)
    const text = 'say "hi" \\ back\nnext é\t🙂'
    expect((await run(['status', '.', text], env({ DROVR_CARD_ID: 'id "\\é' }))).code).toBe(0)
    expect(handler).toHaveBeenCalledWith({
      v: 1,
      cardId: 'id "\\é',
      command: 'status',
      card: '.',
      text
    })
  })

  it.skipIf(!language.path)("prints an error reply's reason and exits 1", async () => {
    await serve(async () => ({ ok: false, error: 'board: no card "x\\y" in this workspace é' }))
    expect(await run(['move', 'x', 'Done'], env())).toEqual({
      code: 1,
      stdout: '',
      stderr: 'board: no card "x\\y" in this workspace é\n'
    })
  })

  it.skipIf(!language.path)('prints the usage for help, exit 0', async () => {
    for (const args of [[], ['help'], ['--help']]) {
      expect(await run(args, env())).toEqual({ code: 0, stdout: BOARD_USAGE, stderr: '' })
    }
  })

  it.skipIf(!language.path)('prints the usage to stderr for a wrong shape, exit 2', async () => {
    for (const args of [['move'], ['move', '.'], ['jump', '.', 'x'], ['status', '.', 'a', 'b']]) {
      expect(await run(args, env())).toEqual({ code: 2, stdout: '', stderr: BOARD_USAGE })
    }
  })

  it.skipIf(!language.path)(
    "says no answer when the socket doesn't answer",
    async () => {
      raw = createServer((socket) => rawSockets.push(socket))
      await new Promise<void>((done) => raw!.listen(socketPath, done))
      const started = Date.now()
      expect(await run(['status', '.', 'x'], env())).toEqual({
        code: 1,
        stdout: '',
        stderr: `${NO_ANSWER}\n`
      })
      expect(Date.now() - started).toBeGreaterThanOrEqual(4500)
    },
    15000
  )

  it.skipIf(!language.path || !PYTHON)(
    "says can't reach, within the timeout, when connecting blocks",
    async () => {
      // A listener with a full backlog that never accepts: a blocking connect waits on it.
      const holder = spawn(PYTHON!, [
        '-c',
        [
          'import socket, sys, time',
          's = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
          's.bind(sys.argv[1])',
          's.listen(0)',
          'held = []',
          'for _ in range(4):',
          '    c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)',
          '    c.setblocking(False)',
          '    try:',
          '        c.connect(sys.argv[1])',
          '    except OSError:',
          '        pass',
          '    held.append(c)',
          'print("ready", flush=True)',
          'time.sleep(60)'
        ].join('\n'),
        socketPath
      ])
      try {
        await new Promise<void>((done) => holder.stdout.once('data', () => done()))
        const started = Date.now()
        expect(await run(['status', '.', 'x'], env())).toEqual({
          code: 1,
          stdout: '',
          stderr: `${CANT_REACH}\n`
        })
        expect(Date.now() - started).toBeLessThan(8000)
      } finally {
        holder.kill('SIGKILL')
      }
    },
    15000
  )

  it.skipIf(!language.path)('says no answer on an invalid reply', async () => {
    raw = createServer((socket) => {
      rawSockets.push(socket)
      socket.end('{"ok":"yes"}\n')
    })
    await new Promise<void>((done) => raw!.listen(socketPath, done))
    expect((await run(['status', '.', 'x'], env())).stderr).toBe(`${NO_ANSWER}\n`)
  })

  it.skipIf(!language.path)(
    "says can't reach for a missing path or one that isn't a socket",
    async () => {
      expect(await run(['status', '.', 'x'], env())).toEqual({
        code: 1,
        stdout: '',
        stderr: `${CANT_REACH}\n`
      })
      writeFileSync(socketPath, '')
      expect((await run(['status', '.', 'x'], env())).stderr).toBe(`${CANT_REACH}\n`)
    }
  )

  it.skipIf(!language.path)(
    "says can't reach for a symlink to a listening socket the user owns (D3)",
    async () => {
      const handler = vi.fn(async (): Promise<BoardReply> => ({ ok: true }))
      await serve(handler)
      const link = join(dir, 'link.sock')
      symlinkSync(socketPath, link)
      expect(await run(['status', '.', 'x'], env({ DROVR_SOCKET: link }))).toEqual({
        code: 1,
        stdout: '',
        stderr: `${CANT_REACH}\n`
      })
      expect(handler).not.toHaveBeenCalled()
    }
  )

  it.skipIf(!language.path)('says not running inside a card without its variables', async () => {
    await serve(async () => ({ ok: true }))
    for (const missing of [{ DROVR_CARD_ID: '' }, { DROVR_SOCKET: '' }] as Record<
      string,
      string
    >[]) {
      expect(await run(['status', '.', 'x'], env(missing))).toEqual({
        code: 1,
        stdout: '',
        stderr: `${NOT_IN_A_CARD}\n`
      })
    }
  })
})

describe('the remote board script with neither perl nor python3 (#25 D5)', () => {
  it('says it needs one, exit 1', async () => {
    const bin = binWith('bin-empty', {})
    expect(
      await run(['status', '.', 'x'], { PATH: bin, DROVR_CARD_ID: 'c', DROVR_SOCKET: socketPath })
    ).toEqual({ code: 1, stdout: '', stderr: `${NEEDS_PERL_OR_PYTHON}\n` })
  })
})

describe('the embedded clients (#25 D5, #12 D3)', () => {
  it('contain no backslash at all, nor does the script', () => {
    expect(perlClient()).not.toContain('\\')
    expect(pythonClient()).not.toContain('\\')
    expect(remoteBoardScript()).not.toContain('\\')
  })
})
