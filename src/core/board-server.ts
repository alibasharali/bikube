/**
 * Main's `board` socket (#9 D5, D6): a Unix domain socket in a private directory, so only its
 * user can reach it, one request
 * line in and one reply line out per connection. Plain Node (`net`), no Electron: main injects
 * the handler that forwards requests to the renderer.
 */
import { chmodSync, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'
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

/** Connections served at once; more are closed at once (#9 D5). */
export const MAX_CONNECTIONS = 32
/** How long a connection may stay open after its reply (#9 D5). */
export const DRAIN_MS = 1000

export type BoardHandler = (request: BoardRequest) => Promise<BoardReply>

export interface BoardServerOptions {
  lineTimeoutMs?: number
  drainMs?: number
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
 * Makes `dir` the socket's private directory (#9 D5): created as mode 0700 if missing, else it
 * must be a real directory (not a symlink) owned by this user, whose mode is set back to 0700.
 * Throws when it can't be trusted.
 */
function preparePrivateDir(dir: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = lstatSync(dir)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${dir} is not a directory`)
  }
  if (process.getuid && stat.uid !== process.getuid()) {
    throw new Error(`${dir} is not owned by this user`)
  }
  if ((stat.mode & 0o777) !== 0o700) chmodSync(dir, 0o700)
}

/**
 * Listens on `path` inside its private directory, replacing a leftover file there, and sets the
 * socket to mode 0600 (#9 D5); the private directory keeps other users out until then. Rejects
 * when it can't listen, e.g. an untrusted directory or a path too long for a socket.
 */
export function startBoardServer(
  path: string,
  handler: BoardHandler,
  { lineTimeoutMs = LINE_TIMEOUT_MS, drainMs = DRAIN_MS }: BoardServerOptions = {}
): Promise<BoardServer> {
  const server = createServer((socket) => serveConnection(socket, handler, lineTimeoutMs, drainMs))
  server.maxConnections = MAX_CONNECTIONS
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => {
      server.close()
      reject(error)
    }
    server.once('error', failed)
    try {
      preparePrivateDir(dirname(path))
      removeFile(path)
    } catch (error) {
      failed(error as Error)
      return
    }
    server.listen(path, () => {
      server.off('error', failed)
      try {
        chmodSync(path, 0o600)
      } catch (error) {
        failed(error as Error)
        removeQuietly(path)
        return
      }
      // A listening server's later errors must not crash the app.
      server.on('error', () => {})
      resolve({
        path,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            removeQuietly(path)
          })
      })
    })
  })
}

function removeQuietly(path: string): void {
  try {
    removeFile(path)
  } catch {
    // Already gone or not ours to remove: nothing else to do.
  }
}

/** Reads one line, answers it once, and closes; anything after the line is ignored. */
function serveConnection(
  socket: Socket,
  handler: BoardHandler,
  lineTimeoutMs: number,
  drainMs: number
): void {
  let buffered = ''
  let answered = false
  socket.setEncoding('utf8')
  socket.on('error', () => socket.destroy())
  const timer = setTimeout(() => socket.destroy(), lineTimeoutMs)
  socket.once('close', () => clearTimeout(timer))

  // After the reply, unread input is drained (closing on it could reset the reply away) until
  // the client closes, or for `drainMs` at most (#9 D5).
  const reply = (answer: BoardReply): void => {
    if (socket.destroyed || !socket.writable) return
    socket.end(serializeReply(answer))
    setTimeout(() => socket.destroy(), drainMs).unref()
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
