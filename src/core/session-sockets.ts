/**
 * A `board` socket per SSH session (#25 D2, D3): main listens on `s-<16 hex>.sock` in the
 * private `board` directory before the session starts, and `ssh -R` forwards
 * `/tmp/bikube-<32 hex>.sock` on the host to it. Each socket serves only its own card: any other
 * card id is answered `board: invalid request` and never reaches the window. Each Orchestrator
 * session gets one the same way (#81 D16), `o-<16 hex>.sock`, given to its shell as
 * `BIKUBE_SOCKET` with a secret `token` of its own as `BIKUBE_ORCHESTRATOR_TOKEN`: it serves every
 * command, only for its Orchestrator and only with that token, since any card's shell can list the
 * `board` directory. The token is taken off before the request goes on. The shared `board.sock`
 * refuses what only the Orchestrator may do (`sharedSocketHandler`). Plain Node, no Electron:
 * main injects the handler that relays requests to the window.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ORCHESTRATOR_ONLY_COMMANDS } from './board-args'
import { ONLY_ORCHESTRATOR, servesRemoteCard } from './board-commands'
import { isOrchestratorId } from './orchestrator'
import { INVALID_REQUEST, type BoardRequest } from './board-protocol'
import { keepSignal, startBoardServer, type BoardHandler, type BoardServer } from './board-server'
import type { BoardForward } from './ssh-command'

export interface SessionSocketsOptions {
  /** Starts a board server; `startBoardServer` unless a test injects another. */
  start?: (path: string, handler: BoardHandler) => Promise<BoardServer>
  /** `bytes` random bytes as hex, from a cryptographic source. */
  randomHex?: (bytes: number) => string
}

interface SocketKind {
  /** The file name's prefix: `s` for SSH sessions, `o` for the Orchestrator's (#81 D16). */
  prefix: 's' | 'o'
  /** Whether each socket gets a secret token its requests must carry (#81 D16). */
  token: boolean
  /** Whether the socket opened for `cardId`, with `token` if it has one, serves `request`. */
  serves: (request: BoardRequest, cardId: string, token: string | undefined) => boolean
}

/** One SSH session's socket, before and after its session exists. */
export interface SessionSocket {
  /** What the SSH line needs; `localSocket` is null when main couldn't listen (D7). */
  readonly forward: BoardForward
  /** The secret its requests carry, for the Orchestrator's sockets only (#81 D16). */
  readonly token?: string
  /** Ties the socket to the session it serves: it closes when that session exits. */
  attach(sessionId: string): void
  /** Closes the socket now; for a session that never started. */
  discard(): void
}

/** A session socket's file name, leftovers included (`s-old.sock`, `o-old.sock`). */
const SESSION_SOCKET = /^[so]-.*[.]sock$/

/**
 * Removes the `s-*.sock` and `o-*.sock` files a previous run left in the `board` directory (D2), at startup;
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
 * that card (`.` or its id), and never a `describe`, `workspaces`, `create`, `rename` or a
 * `--workspace` (#69 D9).
 */
function servesOwnCard(request: BoardRequest, cardId: string): boolean {
  if (request.cardId !== cardId || !servesRemoteCard(request)) return false
  return request.command !== 'description' || request.card === '.' || request.card === cardId
}

const defaultRandomHex = (bytes: number): string => randomBytes(bytes).toString('hex')

const SSH_SOCKETS: SocketKind = { prefix: 's', token: false, serves: servesOwnCard }

/** Whether `given` is `expected`, compared in constant time. */
function sameSecret(given: string | undefined, expected: string | undefined): boolean {
  if (typeof given !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The Orchestrator's socket serves every command, from that Orchestrator only, with its session's
 * token (#81 D16).
 */
const ORCHESTRATOR_SOCKETS: SocketKind = {
  prefix: 'o',
  token: true,
  serves: (request, cardId, token) => request.cardId === cardId && sameSecret(request.token, token)
}

/** The request without its token, as the window gets it. */
function withoutToken(request: BoardRequest): BoardRequest {
  if (request.token === undefined) return request
  const rest = { ...request }
  delete rest.token
  return rest
}

/** Whether `request` names an Orchestrator, as its caller or its card. */
const namesOrchestrator = (request: BoardRequest): boolean =>
  isOrchestratorId(request.cardId) || ('card' in request && isOrchestratorId(request.card))

/**
 * `board.sock`'s handler (#81 D16): an Orchestrator's id, as the caller or the card, is
 * `board: invalid request` (only its own socket speaks for it), and an orchestrator-only command
 * is `ONLY_ORCHESTRATOR`; anything else goes to `handler`.
 */
export function sharedSocketHandler(handler: BoardHandler): BoardHandler {
  return (request) => {
    // Only an Orchestrator's own socket takes a token (D16).
    if (namesOrchestrator(request) || request.token !== undefined) {
      return Promise.resolve({ ok: false, error: INVALID_REQUEST })
    }
    if (ORCHESTRATOR_ONLY_COMMANDS.has(request.command)) {
      return Promise.resolve({ ok: false, error: ONLY_ORCHESTRATOR })
    }
    return handler(request)
  }
}

/** The Orchestrator sessions' sockets (#81 D16), in the same directory as the SSH ones. */
export function orchestratorSockets(
  dir: string,
  handler: BoardHandler,
  options: SessionSocketsOptions = {}
): SessionSockets {
  return new SessionSockets(dir, handler, options, ORCHESTRATOR_SOCKETS)
}

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
    { start = startBoardServer, randomHex = defaultRandomHex }: SessionSocketsOptions = {},
    private readonly kind: SocketKind = SSH_SOCKETS
  ) {
    this.start = start
    this.randomHex = randomHex
  }

  /** Listens on a new session socket for `cardId`; never rejects (D7). */
  async open(cardId: string): Promise<SessionSocket> {
    const localPath = join(this.dir, `${this.kind.prefix}-${this.randomHex(8)}.sock`)
    const remoteSocket = `/tmp/bikube-${this.randomHex(16)}.sock`
    const token = this.kind.token ? this.randomHex(32) : undefined
    const scoped: BoardHandler = (request) =>
      this.kind.serves(request, cardId, token)
        ? this.handler(keepSignal(request, withoutToken(request)))
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
      ...(token !== undefined && { token }),
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
