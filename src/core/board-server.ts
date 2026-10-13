/**
 * Main's `board` socket (#9 D5, D6): a Unix domain socket only its user can reach, one request
 * line in and one reply line out per connection. Plain Node (`net`), no Electron: main injects
 * the handler that forwards requests to the renderer.
 */
import { rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import {
  isOverLineLimit,
  parseRequestLine,
  REQUEST_TOO_LONG,
  serializeReply,
  type BoardReply,
  type BoardRequest
} from './board-protocol'

/** A connection that sends no full line within this long is closed (#9 D6). */
export const LINE_TIMEOUT_MS = 5000

export type BoardHandler = (request: BoardRequest) => Promise<BoardReply>

export interface BoardServerOptions {
  lineTimeoutMs?: number
}

export interface BoardServer {
  readonly path: string
  /** Stops listening and removes the socket file. */
  close(): Promise<void>
}

const HANDLER_FAILED: BoardReply = { ok: false, error: 'board: no answer from Drovr' }

function removeFile(path: string): void {
  rmSync(path, { force: true })
}

/**
 * Listens on `path`, replacing a leftover file there, with the socket created as mode 0600
 * (#9 D5). Rejects when it can't listen, e.g. a path too long for a socket.
 */
export function startBoardServer(
  path: string,
  handler: BoardHandler,
  { lineTimeoutMs = LINE_TIMEOUT_MS }: BoardServerOptions = {}
): Promise<BoardServer> {
  const server = createServer((socket) => serveConnection(socket, handler, lineTimeoutMs))
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => {
      server.close()
      reject(error)
    }
    server.once('error', failed)
    try {
      removeFile(path)
    } catch (error) {
      failed(error as Error)
      return
    }
    // The socket file takes its mode from the umask at bind time, which happens inside
    // listen() for a pipe: no other user can connect between bind and a later chmod.
    const umask = process.umask(0o177)
    try {
      server.listen(path, () => {
        server.off('error', failed)
        // A listening server's later errors must not crash the app.
        server.on('error', () => {})
        resolve({
          path,
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done())
              try {
                removeFile(path)
              } catch {
                // Already gone or not ours to remove: nothing else to do on quit.
              }
            })
        })
      })
    } finally {
      process.umask(umask)
    }
  })
}

/** Reads one line, answers it once, and closes; anything after the line is ignored. */
function serveConnection(socket: Socket, handler: BoardHandler, lineTimeoutMs: number): void {
  let buffered = ''
  let answered = false
  socket.setEncoding('utf8')
  socket.on('error', () => socket.destroy())
  const timer = setTimeout(() => socket.destroy(), lineTimeoutMs)
  socket.once('close', () => clearTimeout(timer))

  // After the reply, unread input is drained (closing on it could reset the reply away) until
  // the client closes, or for one more timeout at most.
  const reply = (answer: BoardReply): void => {
    if (socket.destroyed || !socket.writable) return
    socket.end(serializeReply(answer))
    setTimeout(() => socket.destroy(), lineTimeoutMs).unref()
  }

  socket.on('data', (chunk: string) => {
    if (answered) return
    buffered += chunk
    const newline = buffered.indexOf('\n')
    if (newline < 0) {
      if (isOverLineLimit(buffered)) {
        answered = true
        clearTimeout(timer)
        reply({ ok: false, error: REQUEST_TOO_LONG })
      }
      return
    }
    answered = true
    clearTimeout(timer)
    const line = buffered.slice(0, newline)
    buffered = ''
    const parsed = parseRequestLine(line)
    if (!parsed.ok) {
      reply({ ok: false, error: parsed.error })
      return
    }
    handler(parsed.request).then(reply, () => reply(HANDLER_FAILED))
  })
}
