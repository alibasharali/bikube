/**
 * The `board` command's client side (#9 D1, D6, D9): parse the arguments, send one request line
 * to main's socket, print the outcome. Plain Node; the CLI entry wires it to the process.
 */
import { createConnection } from 'node:net'
import { parseBoardArgs, type BoardCommand } from './board-args'
import { NOT_IN_A_CARD } from './board-commands'
import { readClaudeUsage } from './claude-usage'
import { readDescriptionFile, readProcessStdin } from './description-file'
import {
  ANSWER_TIMEOUT_MS,
  NO_ANSWER,
  parseReplyLine,
  serializeRequest,
  type BoardReply
} from './board-protocol'

export { ANSWER_TIMEOUT_MS, NO_ANSWER }
export const NOT_RUNNING = 'board: Bikube is not running'

export interface BoardOutput {
  stdout(text: string): void
  stderr(text: string): void
}

/**
 * Sends one request line to the socket at `path` and resolves with main's reply: never rejects.
 * No listener is `NOT_RUNNING`; a missing, invalid or late reply is `NO_ANSWER`.
 */
export function sendBoardRequest(
  path: string,
  line: string,
  timeoutMs = ANSWER_TIMEOUT_MS
): Promise<BoardReply> {
  return new Promise((resolve) => {
    let connected = false
    let received = ''
    let settled = false
    const socket = createConnection(path)
    const finish = (reply: BoardReply): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(reply)
    }
    const timer = setTimeout(() => finish({ ok: false, error: NO_ANSWER }), timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      connected = true
      socket.write(line)
    })
    socket.on('data', (chunk: string) => {
      received += chunk
      const newline = received.indexOf('\n')
      if (newline < 0) return
      finish(parseReplyLine(received.slice(0, newline)) ?? { ok: false, error: NO_ANSWER })
    })
    socket.on('error', () => finish({ ok: false, error: connected ? NO_ANSWER : NOT_RUNNING }))
    socket.on('close', () => finish({ ok: false, error: NO_ANSWER }))
  })
}

/**
 * Runs `board <argv>` with `env`'s `BIKUBE_CARD_ID` and `BIKUBE_SOCKET`; resolves with the exit code.
 * `board usage` reads its transcript first (#50 D5): one that can't be read sends nothing.
 * `board describe` reads its file, `readStdin` for `-`, first (#69 D5): one refused sends nothing.
 */
export async function runBoard(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  out: BoardOutput,
  timeoutMs = ANSWER_TIMEOUT_MS,
  readStdin: () => Promise<Uint8Array> = readProcessStdin
): Promise<number> {
  const args = parseBoardArgs(argv)
  if (args.kind === 'help') {
    out.stdout(args.stdout)
    return args.exitCode
  }
  if (args.kind === 'usage') {
    out.stderr(args.stderr)
    return args.exitCode
  }
  const cardId = env.BIKUBE_CARD_ID
  const socketPath = env.BIKUBE_SOCKET
  // Checked before a transcript is read: outside a card, `board usage` reads nothing.
  if (!cardId || !socketPath) {
    out.stderr(`${cardId ? NOT_RUNNING : NOT_IN_A_CARD}\n`)
    return 1
  }
  let command: BoardCommand
  if (args.kind === 'transcript') {
    try {
      command = { command: 'usage', card: args.card, usage: await readClaudeUsage(args.path) }
    } catch {
      out.stderr(`board: can't read ${args.path}\n`)
      return 1
    }
  } else if (args.kind === 'descriptionFile') {
    const read = await readDescriptionFile(args.path, readStdin)
    if (!read.ok) {
      out.stderr(`${read.error}\n`)
      return 1
    }
    command = { command: 'describe', card: args.card, description: read.description }
  } else {
    command = args.command
  }
  const reply = await sendBoardRequest(socketPath, serializeRequest(cardId, command), timeoutMs)
  if (reply.ok) {
    if (reply.output !== undefined) out.stdout(reply.output)
    return 0
  }
  out.stderr(`${reply.error}\n`)
  return 1
}
