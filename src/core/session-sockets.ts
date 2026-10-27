/**
 * A `board` socket per SSH session (#25 D2, D3): main listens on `s-<16 hex>.sock` in the
 * private `board` directory before the session starts, and `ssh -R` forwards
 * `/tmp/bikube-<32 hex>.sock` on the host to it. Each socket serves only its own card: any other
 * card id is answered `board: invalid request` and never reaches the window. Plain Node, no
 * Electron: main injects the handler that relays requests to the window.
 */
import { randomBytes } from 'node:crypto'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { INVALID_REQUEST, type BoardReply, type BoardRequest } from './board-protocol'
import { startBoardServer, type BoardHandler, type BoardServer } from './board-server'
import type { BoardForward } from './ssh-command'

export interface SessionSocketsOptions {
  /** Starts a board server; `startBoardServer` unless a test injects another. */
  start?: (path: string, handler: BoardHandler) => Promise<BoardServer>
  /** `bytes` random bytes as hex, from a cryptographic source. */
  randomHex?: (bytes: number) => string
}

/** One SSH session's socket, before and after its session exists. */
export interface SessionSocket {
  /** What the SSH line needs; `localSocket` is null when main couldn't listen (D7). */
  readonly forward: BoardForward
  /** Ties the socket to the session it serves: it closes when that session exits. */
  attach(sessionId: string): void
  /** Closes the socket now; for a session that never started. */
  discard(): void
}

/** A session socket's file name, leftovers included (`s-old.sock`). */
const SESSION_SOCKET = /^s-.*[.]sock$/

/**
 * Removes the `s-*.sock` files a previous run left in the `board` directory (D2), at startup;
 * never throws. Only a real directory is read, and `board.sock` is left to its server.
 */
export function removeLeftoverSessionSockets(dir: string): void {
  try {
    if (!lstatSync(dir).isDirectory()) return
    for (const name of readdirSync(dir)) {
      if (!SESSION_SOCKET.test(name)) continue
      try {
        rmSync(join(dir, name), { force: true })
      } catch {
        // Not a file (a directory by that name): left alone.
      }
    }
  } catch {
    // No directory yet, or one that isn't ours: nothing to remove.
  }
}

/**
 * Whether a session socket serves `request`: its own card's only (D3), its `description` only for
 * that card (`.` or its id) and never a `describe` (#69 D9).
 */
function servesOwnCard(request: BoardRequest, cardId: string): boolean {
  if (request.cardId !== cardId || request.command === 'describe') return false
  return request.command !== 'description' || request.card === '.' || request.card === cardId
}

const defaultRandomHex = (bytes: number): string => randomBytes(bytes).toString('hex')

export class SessionSockets {
  /** Every open socket, whether or not its session exists yet. */
  private readonly servers = new Set<BoardServer>()
  /** The socket of each live session. */
  private readonly bySession = new Map<string, BoardServer>()
  private closed = false
  private readonly start: (path: string, handler: BoardHandler) => Promise<BoardServer>
  private readonly randomHex: (bytes: number) => string

  constructor(
    private readonly dir: string,
    private readonly handler: BoardHandler,
    { start = startBoardServer, randomHex = defaultRandomHex }: SessionSocketsOptions = {}
  ) {
    this.start = start
    this.randomHex = randomHex
  }

  /** Listens on a new session socket for `cardId`; never rejects (D7). */
  async open(cardId: string): Promise<SessionSocket> {
    const localPath = join(this.dir, `s-${this.randomHex(8)}.sock`)
    const remoteSocket = `/tmp/bikube-${this.randomHex(16)}.sock`
    const scoped = (request: BoardRequest): Promise<BoardReply> =>
      servesOwnCard(request, cardId)
        ? this.handler(request)
        : Promise.resolve({ ok: false, error: INVALID_REQUEST })
    let server: BoardServer | null = null
    try {
      server = await this.start(localPath, scoped)
    } catch {
      server = null
    }
    // Everything was closed while it started (quit): it closes at once, and the session has none.
    if (server && this.closed) {
      void server.close()
      server = null
    }
    if (server) this.servers.add(server)
    const close = (): void => {
      if (server) this.close(server)
    }
    return {
      forward: { cardId, remoteSocket, localSocket: server ? localPath : null },
      attach: (sessionId) => {
        if (server && this.servers.has(server)) this.bySession.set(sessionId, server)
      },
      discard: close
    }
  }

  /** Closes the session's socket, if it has one, and removes its file. */
  sessionExited(sessionId: string): void {
    const server = this.bySession.get(sessionId)
    if (server) this.close(server)
  }

  /** Closes every session socket and removes its file, at once (quit); later ones close too. */
  closeAll(): void {
    this.closed = true
    ;[...this.servers].forEach((server) => this.close(server))
  }

  private close(server: BoardServer): void {
    if (!this.servers.delete(server)) return
    for (const [session, owned] of this.bySession) {
      if (owned === server) this.bySession.delete(session)
    }
    // The file is removed at once; the server stops listening right after.
    void server.close()
  }
}
